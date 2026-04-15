import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { AlertTriangle, Check, GitFork, RotateCcw } from "lucide-react-native";
import { AdaptiveModalSheet, AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { getProviderIcon } from "@/components/provider-icons";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { AgentProvider, AgentSessionConfig } from "@server/server/agent/agent-sdk-types";
import type { StreamItem } from "@/types/stream";
import {
  buildRewindCommand,
  extractBranchableUserMessages,
  supportsNativeRewind,
} from "@/utils/conversation-branch";

export interface HandoffSheetProps {
  visible: boolean;
  onClose: () => void;
  serverId: string;
  sourceAgentId: string;
  currentProvider: AgentProvider;
  streamItems: StreamItem[];
  onForked: (newAgentId: string) => void;
  variant?: "fork" | "edit";
  initialTargetProvider?: AgentProvider | null;
  initialFromMessageId?: string | null;
  initialPrompt?: string;
}

function formatProviderLabel(provider: string): string {
  return provider
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function HandoffSheet({
  visible,
  onClose,
  serverId,
  sourceAgentId,
  currentProvider,
  streamItems,
  onForked,
  variant = "fork",
  initialTargetProvider = null,
  initialFromMessageId = null,
  initialPrompt = "",
}: HandoffSheetProps) {
  const { theme } = useUnistyles();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { entries: providerEntries } = useProvidersSnapshot(serverId);

  const isEditVariant = variant === "edit";
  const [selectedProvider, setSelectedProvider] = useState<AgentProvider | null>(
    initialTargetProvider ?? currentProvider,
  );
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(initialFromMessageId);
  const [draftPrompt, setDraftPrompt] = useState(initialPrompt);
  const [isForking, setIsForking] = useState(false);
  const [forkError, setForkError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setSelectedProvider(initialTargetProvider ?? currentProvider);
    setSelectedMessageId(initialFromMessageId);
    setDraftPrompt(initialPrompt);
    setForkError(null);
  }, [currentProvider, initialFromMessageId, initialPrompt, initialTargetProvider, visible]);

  const targetProviders = useMemo(() => {
    const readyProviders = new Map<
      AgentProvider,
      { provider: AgentProvider; label?: string | null }
    >();
    readyProviders.set(currentProvider, {
      provider: currentProvider,
      label: formatProviderLabel(currentProvider),
    });

    for (const entry of providerEntries ?? []) {
      if (entry.status !== "ready") {
        continue;
      }
      readyProviders.set(entry.provider as AgentProvider, {
        provider: entry.provider as AgentProvider,
        label: entry.label,
      });
    }

    return [...readyProviders.values()].sort((left, right) => {
      if (left.provider === currentProvider && right.provider !== currentProvider) {
        return -1;
      }
      if (right.provider === currentProvider && left.provider !== currentProvider) {
        return 1;
      }
      return left.provider.localeCompare(right.provider);
    });
  }, [currentProvider, providerEntries]);

  const userMessages = useMemo(() => extractBranchableUserMessages(streamItems), [streamItems]);
  const latestUserMessageId = userMessages.at(-1)?.id ?? null;
  const isProviderSwitch = selectedProvider !== null && selectedProvider !== currentProvider;
  const rewindCommand = useMemo(
    () =>
      buildRewindCommand({
        provider: currentProvider,
        selectedMessageId,
        latestUserMessageId,
      }),
    [currentProvider, latestUserMessageId, selectedMessageId],
  );
  const canNativeRewind =
    isEditVariant &&
    !isProviderSwitch &&
    supportsNativeRewind(currentProvider) &&
    rewindCommand !== null;
  const title = isEditVariant
    ? isProviderSwitch
      ? "Hand off edited prompt"
      : canNativeRewind
        ? "Rewind and rerun"
        : "Native rewind unavailable"
    : isProviderSwitch
      ? "Hand off conversation"
      : "Fork conversation";
  const submitLabel = isEditVariant
    ? isProviderSwitch
      ? "Hand off"
      : "Rewind and rerun"
    : isProviderSwitch
      ? "Hand off"
      : "Fork";
  const contextHint = isEditVariant
    ? isProviderSwitch
      ? "Changing providers creates a handoff. The new agent keeps earlier context and starts from your edited prompt."
      : canNativeRewind
        ? "This uses the provider's native rewind support, restores tracked files, and reruns from your edited prompt."
        : "This provider session cannot natively rewind this selected turn. Switch providers to hand off instead."
    : isProviderSwitch
      ? "Switching providers creates a handoff that carries over the selected conversation context."
      : "Keep the conversation up to the selected user message and drop later turns in the new branch.";

  const handleClose = useCallback(() => {
    if (isForking) {
      return;
    }
    setForkError(null);
    onClose();
  }, [isForking, onClose]);

  const handleSubmit = useCallback(async () => {
    if (!client || !selectedProvider || isForking) {
      return;
    }

    const trimmedPrompt = draftPrompt.trim();
    if (isEditVariant && (!selectedMessageId || trimmedPrompt.length === 0)) {
      return;
    }

    setIsForking(true);
    setForkError(null);

    try {
      if (isEditVariant && !isProviderSwitch) {
        if (!rewindCommand) {
          throw new Error("Native rewind is not available for this selected message.");
        }
        await client.sendAgentMessage(sourceAgentId, rewindCommand);
        await client.waitForFinish(sourceAgentId, 120000);
        await client.sendAgentMessage(sourceAgentId, trimmedPrompt);
        onForked(sourceAgentId);
        handleClose();
        return;
      }

      const targetConfig: Partial<AgentSessionConfig> = {};
      const result = await client.forkAgent({
        sourceAgentId,
        targetProvider: selectedProvider,
        ...(selectedMessageId ? { fromMessageId: selectedMessageId } : {}),
        ...(selectedMessageId ? { transcriptMode: isEditVariant ? "before" : "through" } : {}),
        targetConfig,
        ...(trimmedPrompt ? { initialPrompt: trimmedPrompt } : {}),
      });

      onForked(result.newAgentId);
      handleClose();
    } catch (error) {
      setForkError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsForking(false);
    }
  }, [
    canNativeRewind,
    client,
    draftPrompt,
    handleClose,
    isEditVariant,
    isForking,
    isProviderSwitch,
    onForked,
    rewindCommand,
    selectedMessageId,
    selectedProvider,
    sourceAgentId,
  ]);

  return (
    <AdaptiveModalSheet
      title={title}
      visible={visible}
      onClose={handleClose}
      snapPoints={["70%", "90%"]}
    >
      <View style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Target provider</Text>
          <Text style={styles.sectionHint}>
            {isEditVariant
              ? "Stay on the current provider to use native rewind when available, or switch providers to hand off the conversation."
              : `Create the new conversation on ${formatProviderLabel(currentProvider)} or switch providers to hand off.`}
          </Text>
          {targetProviders.length === 0 ? (
            <Text style={styles.emptyText}>No providers are available on this host right now.</Text>
          ) : (
            <View style={styles.optionList}>
              {targetProviders.map((entry) => {
                const isSelected = selectedProvider === entry.provider;
                const ProviderIcon = getProviderIcon(entry.provider);
                return (
                  <Pressable
                    key={entry.provider}
                    style={[styles.optionRow, isSelected && styles.optionRowSelected]}
                    onPress={() => setSelectedProvider(entry.provider)}
                  >
                    <View style={styles.optionLeft}>
                      <ProviderIcon
                        color={
                          isSelected ? theme.colors.primaryForeground : theme.colors.foreground
                        }
                        size={18}
                      />
                      <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>
                        {entry.label ?? formatProviderLabel(entry.provider)}
                      </Text>
                    </View>
                    {isSelected ? <Check color={theme.colors.primaryForeground} size={16} /> : null}
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {userMessages.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {isEditVariant && !isProviderSwitch ? "Rewind point" : "Conversation point"}
            </Text>
            <Text style={styles.sectionHint}>{contextHint}</Text>
            <View style={styles.optionList}>
              {!isEditVariant ? (
                <Pressable
                  style={[styles.optionRow, selectedMessageId === null && styles.optionRowSelected]}
                  onPress={() => setSelectedMessageId(null)}
                >
                  <Text
                    style={[
                      styles.optionLabel,
                      selectedMessageId === null && styles.optionLabelSelected,
                    ]}
                  >
                    Entire conversation
                  </Text>
                  {selectedMessageId === null ? (
                    <Check color={theme.colors.primaryForeground} size={16} />
                  ) : null}
                </Pressable>
              ) : null}

              {userMessages.map((message) => (
                <Pressable
                  key={message.id}
                  style={[
                    styles.optionRow,
                    selectedMessageId === message.id && styles.optionRowSelected,
                  ]}
                  onPress={() => {
                    setSelectedMessageId(message.id);
                    if (isEditVariant) {
                      setDraftPrompt(message.text);
                    }
                  }}
                >
                  <Text
                    style={[
                      styles.optionLabel,
                      styles.optionMessageLabel,
                      selectedMessageId === message.id && styles.optionLabelSelected,
                    ]}
                    numberOfLines={2}
                  >
                    {message.text}
                  </Text>
                  {selectedMessageId === message.id ? (
                    <Check color={theme.colors.primaryForeground} size={16} />
                  ) : null}
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {isEditVariant ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Edited prompt</Text>
            <Text style={styles.sectionHint}>
              {isProviderSwitch
                ? "The new provider receives this edited prompt after rebuilding context from the earlier conversation."
                : "After rewinding, the current provider reruns the conversation from this edited prompt."}
            </Text>
            <AdaptiveTextInput
              style={styles.textarea}
              value={draftPrompt}
              onChangeText={setDraftPrompt}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              placeholder="Update the message to rerun"
              placeholderTextColor={theme.colors.foregroundMuted}
            />
          </View>
        ) : null}

        {isEditVariant && !isProviderSwitch && !canNativeRewind ? (
          <View style={styles.warningCard}>
            <AlertTriangle size={16} color={theme.colors.destructive} />
            <Text style={styles.warningText}>
              Native rewind is currently surfaced for Claude only when Paseo can address the
              selected message. For older local turns, switch providers to hand off instead.
            </Text>
          </View>
        ) : null}

        {forkError ? <Text style={styles.errorText}>{forkError}</Text> : null}

        <View style={styles.footer}>
          <Button variant="outline" size="md" onPress={handleClose} disabled={isForking}>
            Cancel
          </Button>
          <Button
            variant="default"
            size="md"
            leftIcon={isForking ? undefined : canNativeRewind ? RotateCcw : GitFork}
            onPress={handleSubmit}
            disabled={
              !selectedProvider ||
              !isConnected ||
              isForking ||
              (isEditVariant &&
                (!selectedMessageId ||
                  draftPrompt.trim().length === 0 ||
                  (!isProviderSwitch && !canNativeRewind)))
            }
          >
            {isForking ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={theme.colors.primaryForeground} />
                <Text style={styles.loadingText}>
                  {canNativeRewind && !isProviderSwitch ? "Rewinding…" : "Forking…"}
                </Text>
              </View>
            ) : (
              submitLabel
            )}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: {
    gap: 20,
  },
  section: {
    gap: theme.spacing[2],
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sectionHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  optionList: {
    gap: theme.spacing[2],
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[3],
  },
  optionRowSelected: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  optionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
  },
  optionLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    flex: 1,
  },
  optionLabelSelected: {
    color: theme.colors.primaryForeground,
  },
  optionMessageLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  textarea: {
    minHeight: 140,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface1,
    fontSize: theme.fontSize.base,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  warningCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  warningText: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[3],
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  loadingText: {
    color: theme.colors.primaryForeground,
    fontSize: theme.fontSize.sm,
  },
}));

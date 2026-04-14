import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Check, GitFork } from "lucide-react-native";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { getProviderIcon } from "@/components/provider-icons";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { AgentProvider, AgentSessionConfig } from "@server/server/agent/agent-sdk-types";
import type { StreamItem } from "@/types/stream";

export interface HandoffSheetProps {
  visible: boolean;
  onClose: () => void;
  serverId: string;
  sourceAgentId: string;
  /** Current provider of the source agent — excluded from target options. */
  currentProvider: AgentProvider;
  /** Stream items from the source agent, used to populate the cutoff picker. */
  streamItems: StreamItem[];
  /** Called with the new agent's ID after a successful fork. */
  onForked: (newAgentId: string) => void;
}

interface UserMessage {
  /** Client-side stream item ID (used only for React key). */
  id: string;
  text: string;
  /** 0-based index among user messages — used to pick cutoff. */
  userMessageIndex: number;
}

/** Wraps provider name for display. */
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
}: HandoffSheetProps) {
  const { theme } = useUnistyles();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { entries: providerEntries } = useProvidersSnapshot(serverId);

  const [selectedProvider, setSelectedProvider] = useState<AgentProvider | null>(null);
  const [selectedCutoffIndex, setSelectedCutoffIndex] = useState<number | null>(null);
  const [isForking, setIsForking] = useState(false);
  const [forkError, setForkError] = useState<string | null>(null);

  // Build list of available target providers (exclude current one, only show ready ones).
  const targetProviders = useMemo(() => {
    if (!providerEntries) return [];
    return providerEntries.filter(
      (entry) => entry.provider !== currentProvider && entry.status === "ready",
    );
  }, [providerEntries, currentProvider]);

  // Extract user messages from stream items for the cutoff picker.
  const userMessages = useMemo<UserMessage[]>(() => {
    let index = 0;
    const result: UserMessage[] = [];
    for (const item of streamItems) {
      if (item.kind === "user_message") {
        result.push({ id: item.id, text: item.text, userMessageIndex: index });
        index += 1;
      }
    }
    return result;
  }, [streamItems]);

  const handleClose = useCallback(() => {
    if (isForking) return;
    setForkError(null);
    onClose();
  }, [isForking, onClose]);

  const handleFork = useCallback(async () => {
    if (!client || !selectedProvider || isForking) return;

    setIsForking(true);
    setForkError(null);

    try {
      // Build targetConfig: only provider is required; rest inherits from source.
      const targetConfig: Partial<AgentSessionConfig> = {};

      // Resolve fromMessageId via the timeline if user selected a cutoff.
      // We pass nothing here and instead rely on the server to use the full
      // timeline when fromMessageId is undefined.  For cutoff support the
      // index-based approach: we fetch the timeline to get messageIds for the
      // selected user message index.
      let fromMessageId: string | undefined;

      if (selectedCutoffIndex !== null && selectedCutoffIndex > 0) {
        try {
          const timelineResult = await client.fetchAgentTimeline(sourceAgentId, {
            direction: "tail",
            limit: 0,
          });
          let uMsgCount = 0;
          for (const entry of timelineResult.entries) {
            const item = entry.item;
            if (item.type === "user_message") {
              if (uMsgCount === selectedCutoffIndex) {
                fromMessageId = item.messageId;
                break;
              }
              uMsgCount += 1;
            }
          }
        } catch {
          // If we can't fetch the timeline, just use the full context.
        }
      }

      const result = await client.forkAgent({
        sourceAgentId,
        targetProvider: selectedProvider,
        fromMessageId,
        targetConfig,
      });

      onForked(result.newAgentId);
      handleClose();
    } catch (error) {
      setForkError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsForking(false);
    }
  }, [
    client,
    selectedProvider,
    isForking,
    selectedCutoffIndex,
    sourceAgentId,
    onForked,
    handleClose,
  ]);

  return (
    <AdaptiveModalSheet
      title="Hand off to another provider"
      visible={visible}
      onClose={handleClose}
      snapPoints={["70%", "90%"]}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Target provider selection */}
        <Text style={styles.sectionTitle}>Target provider</Text>
        {targetProviders.length === 0 ? (
          <Text style={styles.emptyText}>
            No other providers are available on this host. Configure additional providers in your
            daemon settings.
          </Text>
        ) : (
          <View style={styles.providerList}>
            {targetProviders.map((entry) => {
              const isSelected = selectedProvider === entry.provider;
              const ProviderIcon = getProviderIcon(entry.provider as AgentProvider);
              return (
                <Pressable
                  key={entry.provider}
                  style={[styles.optionRow, isSelected && styles.optionRowSelected]}
                  onPress={() => setSelectedProvider(entry.provider as AgentProvider)}
                >
                  <View style={styles.optionLeft}>
                    <ProviderIcon
                      color={isSelected ? theme.colors.primaryForeground : theme.colors.foreground}
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

        {/* Context cutoff picker — only shown when there are multiple user messages */}
        {userMessages.length > 1 ? (
          <>
            <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>Context to include</Text>
            <Text style={styles.sectionHint}>
              Pick the first message to include in the handoff. Earlier messages are omitted.
            </Text>
            <View style={styles.cutoffList}>
              <Pressable
                style={[styles.optionRow, selectedCutoffIndex === null && styles.optionRowSelected]}
                onPress={() => setSelectedCutoffIndex(null)}
              >
                <Text
                  style={[
                    styles.optionLabel,
                    selectedCutoffIndex === null && styles.optionLabelSelected,
                  ]}
                >
                  All messages
                </Text>
                {selectedCutoffIndex === null ? (
                  <Check color={theme.colors.primaryForeground} size={16} />
                ) : null}
              </Pressable>

              {userMessages.map((msg) => (
                <Pressable
                  key={msg.id}
                  style={[
                    styles.optionRow,
                    selectedCutoffIndex === msg.userMessageIndex && styles.optionRowSelected,
                  ]}
                  onPress={() => setSelectedCutoffIndex(msg.userMessageIndex)}
                >
                  <Text
                    style={[
                      styles.optionLabel,
                      styles.cutoffMessageText,
                      selectedCutoffIndex === msg.userMessageIndex && styles.optionLabelSelected,
                    ]}
                    numberOfLines={2}
                  >
                    {msg.text}
                  </Text>
                  {selectedCutoffIndex === msg.userMessageIndex ? (
                    <Check color={theme.colors.primaryForeground} size={16} />
                  ) : null}
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {forkError ? <Text style={styles.errorText}>{forkError}</Text> : null}

        <View style={styles.footer}>
          <Button variant="outline" size="md" onPress={handleClose} disabled={isForking}>
            Cancel
          </Button>
          <Button
            variant="default"
            size="md"
            leftIcon={isForking ? undefined : GitFork}
            onPress={handleFork}
            disabled={!selectedProvider || !isConnected || isForking}
          >
            {isForking ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={theme.colors.primaryForeground} />
                <Text style={styles.loadingText}>Forking…</Text>
              </View>
            ) : (
              "Hand off"
            )}
          </Button>
        </View>
      </ScrollView>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: theme.spacing[6],
    gap: theme.spacing[4],
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sectionTitleSpaced: {
    marginTop: theme.spacing[4],
  },
  sectionHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: -theme.spacing[2],
    marginBottom: theme.spacing[2],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  providerList: {
    gap: theme.spacing[2],
  },
  cutoffList: {
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
  cutoffMessageText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[2],
  },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[3],
    marginTop: theme.spacing[4],
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

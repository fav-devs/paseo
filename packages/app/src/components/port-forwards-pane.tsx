import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Network, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import type { ListPortForwardsResponse } from "@server/shared/messages";
import { Button } from "@/components/ui/button";
import { useSessionStore } from "@/stores/session-store";
import { getIsElectron } from "@/constants/platform";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";

type ListPortForwardsPayload = ListPortForwardsResponse["payload"];
type PortForwardEntry = ListPortForwardsPayload["portForwards"][number];

function parsePort(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return null;
  }
  return parsed;
}

function trimNonEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function ForwardRow({
  entry,
  isClosing,
  onClose,
}: {
  entry: PortForwardEntry;
  isClosing: boolean;
  onClose: (id: string) => void;
}) {
  const { theme } = useUnistyles();
  const localLabel = entry.tunneled
    ? `localhost:${entry.localPort}`
    : `${entry.bindHost}:${entry.localPort}`;
  return (
    <View style={[styles.forwardRow, { borderColor: theme.colors.border }]}>
      <View style={styles.forwardMeta}>
        <View style={styles.forwardHeader}>
          <Text style={[styles.forwardName, { color: theme.colors.foreground }]} numberOfLines={1}>
            {entry.name}
          </Text>
          <View style={[styles.portBadge, { backgroundColor: theme.colors.surface2 }]}>
            <Text style={[styles.portBadgeText, { color: theme.colors.foreground }]}>
              {localLabel}
            </Text>
          </View>
        </View>
        <Text style={[styles.forwardTarget, { color: theme.colors.foregroundMuted }]}>
          → {entry.targetHost}:{entry.targetPort}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Close ${entry.name}`}
        disabled={isClosing}
        onPress={() => onClose(entry.id)}
        style={({ pressed, hovered = false }) => [
          styles.closeButton,
          {
            opacity: isClosing ? theme.opacity[50] : 1,
            backgroundColor: hovered || pressed ? theme.colors.surface2 : "transparent",
          },
        ]}
      >
        <X size={16} color={theme.colors.foregroundMuted} />
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Tunneled form (Electron — VS Code style)
// ---------------------------------------------------------------------------

function TunneledForm({ workspaceId, onCreated }: { workspaceId: string; onCreated: () => void }) {
  const { theme } = useUnistyles();
  const [port, setPort] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      const parsedPort = parsePort(port);
      if (parsedPort === null) {
        throw new Error("Enter a valid port between 1 and 65535.");
      }
      return await invokeDesktopCommand<{ portForwardId: string; localPort: number }>(
        "create_tunneled_port_forward",
        {
          cwd: workspaceId,
          targetHost: "localhost",
          targetPort: parsedPort,
        },
      );
    },
    onSuccess: () => {
      setFormError(null);
      setPort("");
      onCreated();
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : "Unable to create tunnel.");
    },
  });

  return (
    <View style={styles.fieldGrid}>
      <View style={styles.field}>
        <Text style={[styles.label, { color: theme.colors.foregroundMuted }]}>Port</Text>
        <TextInput
          value={port}
          onChangeText={setPort}
          keyboardType="number-pad"
          placeholder="3000"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={[
            styles.input,
            {
              backgroundColor: theme.colors.surface1,
              borderColor: theme.colors.border,
              color: theme.colors.foreground,
            },
          ]}
        />
      </View>
      {formError ? (
        <Text style={[styles.errorText, { color: theme.colors.destructive }]}>{formError}</Text>
      ) : null}
      <View style={styles.actionRow}>
        <Button
          size="sm"
          variant="default"
          disabled={createMutation.isPending}
          onPress={() => createMutation.mutate()}
        >
          Forward port
        </Button>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Local-bind form (non-Electron)
// ---------------------------------------------------------------------------

function LocalForm({ workspaceId, onCreated }: { workspaceId: string; onCreated: () => void }) {
  const { theme } = useUnistyles();
  const client = useSessionStore(
    (state) => Object.values(state.sessions).find((s) => s.client)?.client ?? null,
  );
  const [name, setName] = useState("");
  const [bindHost, setBindHost] = useState("127.0.0.1");
  const [localPort, setLocalPort] = useState("");
  const [targetHost, setTargetHost] = useState("127.0.0.1");
  const [targetPort, setTargetPort] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("Host is not connected");
      const parsedLocalPort = Number.parseInt(localPort.trim(), 10);
      if (!Number.isInteger(parsedLocalPort) || parsedLocalPort < 0 || parsedLocalPort > 65535) {
        throw new Error("Enter a valid local port between 0 and 65535.");
      }
      const parsedTargetPort = parsePort(targetPort);
      if (parsedTargetPort === null) {
        throw new Error("Enter a valid target port between 1 and 65535.");
      }
      const resolvedTargetHost = trimNonEmpty(targetHost);
      if (!resolvedTargetHost) throw new Error("Target host is required.");
      const resolvedBindHost = trimNonEmpty(bindHost) ?? "127.0.0.1";
      return await client.createPortForward({
        cwd: workspaceId,
        name: trimNonEmpty(name) ?? undefined,
        bindHost: resolvedBindHost,
        localPort: parsedLocalPort,
        targetHost: resolvedTargetHost,
        targetPort: parsedTargetPort,
      });
    },
    onSuccess: (payload) => {
      if (payload.error) {
        setFormError(payload.error);
        return;
      }
      setFormError(null);
      setName("");
      setLocalPort("");
      setTargetPort("");
      onCreated();
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : "Unable to create port forward.");
    },
  });

  return (
    <View style={styles.fieldGrid}>
      <View style={styles.field}>
        <Text style={[styles.label, { color: theme.colors.foregroundMuted }]}>Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Optional label"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={[
            styles.input,
            {
              backgroundColor: theme.colors.surface1,
              borderColor: theme.colors.border,
              color: theme.colors.foreground,
            },
          ]}
        />
      </View>
      <View style={styles.field}>
        <Text style={[styles.label, { color: theme.colors.foregroundMuted }]}>Bind host</Text>
        <TextInput
          value={bindHost}
          onChangeText={setBindHost}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="127.0.0.1"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={[
            styles.input,
            {
              backgroundColor: theme.colors.surface1,
              borderColor: theme.colors.border,
              color: theme.colors.foreground,
            },
          ]}
        />
      </View>
      <View style={styles.field}>
        <Text style={[styles.label, { color: theme.colors.foregroundMuted }]}>Local port</Text>
        <TextInput
          value={localPort}
          onChangeText={setLocalPort}
          keyboardType="number-pad"
          placeholder="3000"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={[
            styles.input,
            {
              backgroundColor: theme.colors.surface1,
              borderColor: theme.colors.border,
              color: theme.colors.foreground,
            },
          ]}
        />
      </View>
      <View style={styles.field}>
        <Text style={[styles.label, { color: theme.colors.foregroundMuted }]}>Target host</Text>
        <TextInput
          value={targetHost}
          onChangeText={setTargetHost}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="127.0.0.1"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={[
            styles.input,
            {
              backgroundColor: theme.colors.surface1,
              borderColor: theme.colors.border,
              color: theme.colors.foreground,
            },
          ]}
        />
      </View>
      <View style={styles.field}>
        <Text style={[styles.label, { color: theme.colors.foregroundMuted }]}>Target port</Text>
        <TextInput
          value={targetPort}
          onChangeText={setTargetPort}
          keyboardType="number-pad"
          placeholder="3000"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={[
            styles.input,
            {
              backgroundColor: theme.colors.surface1,
              borderColor: theme.colors.border,
              color: theme.colors.foreground,
            },
          ]}
        />
      </View>
      {formError ? (
        <Text style={[styles.errorText, { color: theme.colors.destructive }]}>{formError}</Text>
      ) : null}
      <View style={styles.actionRow}>
        <Button
          size="sm"
          variant="default"
          disabled={createMutation.isPending}
          onPress={() => createMutation.mutate()}
        >
          Create forward
        </Button>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main pane
// ---------------------------------------------------------------------------

export function PortForwardsPane({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}) {
  const { theme } = useUnistyles();
  const queryClient = useQueryClient();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const isElectron = getIsElectron();

  const queryKey = useMemo(
    () => ["port-forwards", serverId, workspaceId] as const,
    [serverId, workspaceId],
  );

  const query = useQuery({
    queryKey,
    enabled: Boolean(client && workspaceId),
    queryFn: async (): Promise<ListPortForwardsPayload> => {
      if (!client) {
        throw new Error("Host is not connected");
      }
      return await client.listPortForwards(workspaceId);
    },
    staleTime: 5_000,
  });

  useEffect(() => {
    if (!client || !workspaceId) {
      return;
    }
    const unsubscribeChanged = client.on("port_forwards_changed", (message) => {
      if (message.type !== "port_forwards_changed") {
        return;
      }
      if (message.payload.cwd !== workspaceId) {
        return;
      }
      queryClient.setQueryData<ListPortForwardsPayload>(queryKey, (current) => ({
        cwd: message.payload.cwd,
        portForwards: message.payload.portForwards,
        requestId: current?.requestId ?? `port-forwards-changed-${Date.now()}`,
      }));
    });
    client.subscribePortForwards({ cwd: workspaceId });
    return () => {
      unsubscribeChanged();
      client.unsubscribePortForwards({ cwd: workspaceId });
    };
  }, [client, queryClient, queryKey, workspaceId]);

  const closeMutation = useMutation({
    mutationFn: async (entry: PortForwardEntry) => {
      if (entry.tunneled && isElectron) {
        await invokeDesktopCommand("close_tunneled_port_forward", { portForwardId: entry.id });
        return { success: true, portForwardId: entry.id };
      }
      if (!client) throw new Error("Host is not connected");
      return await client.closePortForward(entry.id);
    },
    onSuccess: (payload) => {
      if (!payload.success) {
        return;
      }
      queryClient.setQueryData<ListPortForwardsPayload>(queryKey, (current) => ({
        cwd: current?.cwd ?? workspaceId,
        portForwards: (current?.portForwards ?? []).filter((e) => e.id !== payload.portForwardId),
        requestId: current?.requestId ?? `port-forward-close-${payload.portForwardId}`,
      }));
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const portForwards = query.data?.portForwards ?? [];

  const handleCloseForward = useCallback(
    (entry: PortForwardEntry) => {
      closeMutation.mutate(entry);
    },
    [closeMutation],
  );

  const handleCreated = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  if (query.isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <Text style={{ color: theme.colors.foregroundMuted }}>Loading port forwards…</Text>
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <Text style={{ color: theme.colors.destructive }}>
          {query.error instanceof Error ? query.error.message : "Unable to load port forwards."}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.scrollContent}
    >
      <View style={[styles.section, { borderColor: theme.colors.border }]}>
        <View style={styles.sectionHeader}>
          <Network size={14} color={theme.colors.foregroundMuted} />
          <Text style={[styles.sectionTitle, { color: theme.colors.foreground }]}>
            {isElectron ? "Forward port" : "New port forward"}
          </Text>
        </View>
        {isElectron ? (
          <>
            <Text style={[styles.helperText, { color: theme.colors.foregroundMuted }]}>
              Enter a port running on the daemon machine. It will be available at the same port
              locally (or the next free port).
            </Text>
            <TunneledForm workspaceId={workspaceId} onCreated={handleCreated} />
          </>
        ) : (
          <>
            <Text style={[styles.helperText, { color: theme.colors.foregroundMuted }]}>
              Forward a daemon-side TCP port to a target host and port.
            </Text>
            <LocalForm workspaceId={workspaceId} onCreated={handleCreated} />
          </>
        )}
      </View>

      <View style={[styles.section, { borderColor: theme.colors.border }]}>
        <View style={styles.sectionHeader}>
          <Network size={14} color={theme.colors.foregroundMuted} />
          <Text style={[styles.sectionTitle, { color: theme.colors.foreground }]}>
            Active forwards
          </Text>
          <Text style={[styles.countText, { color: theme.colors.foregroundMuted }]}>
            {portForwards.length}
          </Text>
        </View>
        {portForwards.length === 0 ? (
          <Text style={[styles.helperText, { color: theme.colors.foregroundMuted }]}>
            No active port forwards for this workspace.
          </Text>
        ) : (
          <View style={styles.forwardList}>
            {portForwards.map((entry) => (
              <ForwardRow
                key={entry.id}
                entry={entry}
                isClosing={
                  closeMutation.isPending &&
                  (closeMutation.variables as PortForwardEntry | undefined)?.id === entry.id
                }
                onClose={() => handleCloseForward(entry)}
              />
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
  },
  scrollContent: {
    padding: theme.spacing[4],
    gap: theme.spacing[4],
  },
  section: {
    borderWidth: 1,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  sectionTitle: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  helperText: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  countText: {
    fontSize: theme.fontSize.sm,
  },
  fieldGrid: {
    gap: theme.spacing[3],
  },
  field: {
    gap: theme.spacing[2],
  },
  label: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  input: {
    borderWidth: 1,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    fontSize: theme.fontSize.sm,
  },
  actionRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
  },
  forwardList: {
    gap: theme.spacing[2],
  },
  forwardRow: {
    borderWidth: 1,
    borderRadius: theme.borderRadius.lg,
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  forwardMeta: {
    flex: 1,
    gap: theme.spacing[1],
  },
  forwardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  forwardName: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    flexShrink: 1,
  },
  portBadge: {
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  portBadgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  forwardTarget: {
    fontSize: theme.fontSize.sm,
  },
  closeButton: {
    borderRadius: theme.borderRadius.full,
    padding: theme.spacing[2],
  },
}));

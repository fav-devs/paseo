import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AudioLines, TerminalSquare } from "lucide-react-native";
import { Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import type { ListTerminalsResponse } from "@server/shared/messages";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { upsertTerminalListEntry } from "@/utils/terminal-list";
import { Button } from "@/components/ui/button";
import { TerminalPane } from "./terminal-pane";

const SPOTIFY_TERMINAL_NAME = "spotify-player";
const TERMINALS_QUERY_STALE_TIME = 5_000;
const SPOTIFY_LAUNCH_COMMAND = [
  "clear",
  "if command -v spotify_player >/dev/null 2>&1; then",
  "  spotify_player",
  "elif [ -f inspo/spotify-player/Cargo.toml ]; then",
  "  cargo run --manifest-path inspo/spotify-player/Cargo.toml --bin spotify_player",
  "else",
  '  echo "spotify_player was not found in PATH and inspo/spotify-player/Cargo.toml is missing relative to this workspace."',
  '  echo "Install spotify_player globally or open the Paseo repo root to launch the local inspiration build."',
  "fi",
].join("\n");

type ListTerminalsPayload = ListTerminalsResponse["payload"];

export function SpotifyPane({
  serverId,
  workspaceRoot,
}: {
  serverId: string;
  workspaceRoot: string;
}) {
  const { theme } = useUnistyles();
  const queryClient = useQueryClient();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const queryKey = useMemo(
    () => ["spotify-terminals", serverId, workspaceRoot] as const,
    [serverId, workspaceRoot],
  );

  const query = useQuery({
    queryKey,
    enabled: Boolean(client && isConnected && workspaceRoot),
    queryFn: async (): Promise<ListTerminalsPayload> => {
      if (!client) {
        throw new Error("Host is not connected");
      }
      return client.listTerminals(workspaceRoot);
    },
    staleTime: TERMINALS_QUERY_STALE_TIME,
  });

  const spotifyTerminal =
    query.data?.terminals.find((terminal) => terminal.name === SPOTIFY_TERMINAL_NAME) ?? null;

  const createTerminalMutation = useMutation({
    mutationFn: async () => {
      if (!client) {
        throw new Error("Host is not connected");
      }
      const payload = await client.createTerminal(workspaceRoot, SPOTIFY_TERMINAL_NAME);
      if (!payload.terminal) {
        throw new Error(payload.error ?? "Unable to create Spotify terminal.");
      }
      return payload.terminal;
    },
    onSuccess: (terminal) => {
      queryClient.setQueryData<ListTerminalsPayload>(queryKey, (current) => ({
        cwd: current?.cwd ?? workspaceRoot,
        terminals: upsertTerminalListEntry({
          terminals: current?.terminals ?? [],
          terminal,
        }),
        requestId: current?.requestId ?? `spotify-terminal-${terminal.id}`,
      }));
    },
  });

  const launchMutation = useMutation({
    mutationFn: async () => {
      if (!client) {
        throw new Error("Host is not connected");
      }
      const terminal = spotifyTerminal ?? (await createTerminalMutation.mutateAsync());
      await new Promise((resolve) => {
        setTimeout(resolve, 180);
      });
      client.sendTerminalInput(terminal.id, {
        type: "input",
        data: `${SPOTIFY_LAUNCH_COMMAND}\n`,
      });
      return terminal;
    },
    onMutate: () => {
      setLaunchError(null);
    },
    onError: (error) => {
      setLaunchError(error instanceof Error ? error.message : "Unable to launch spotify_player.");
    },
  });

  const handleLaunch = useCallback(() => {
    launchMutation.mutate();
  }, [launchMutation]);

  if (!client || !isConnected) {
    return (
      <View style={styles.centered}>
        <Text style={styles.messageTitle}>Spotify player unavailable</Text>
        <Text style={styles.messageBody}>
          Connect to a daemon to launch spotify_player from the workspace.
        </Text>
      </View>
    );
  }

  if (query.isLoading && !spotifyTerminal) {
    return (
      <View style={styles.centered}>
        <Text style={styles.messageTitle}>Loading Spotify terminal…</Text>
      </View>
    );
  }

  if (query.isError && !spotifyTerminal) {
    return (
      <View style={styles.centered}>
        <Text style={styles.messageTitle}>Unable to load terminals</Text>
        <Text style={styles.messageBody}>
          {query.error instanceof Error
            ? query.error.message
            : "Failed to inspect workspace terminals."}
        </Text>
      </View>
    );
  }

  if (!spotifyTerminal) {
    return (
      <View style={styles.emptyState}>
        <View style={styles.heroIcon}>
          <AudioLines size={18} color={theme.colors.foreground} />
        </View>
        <Text style={styles.messageTitle}>Spotify player</Text>
        <Text style={styles.messageBody}>
          Launch a dedicated terminal that runs spotify_player. If the binary is not installed, the
          pane will try to start the local inspiration app from inspo/spotify-player in this repo.
        </Text>
        <Button
          leftIcon={TerminalSquare}
          onPress={handleLaunch}
          disabled={launchMutation.isPending || createTerminalMutation.isPending}
        >
          {launchMutation.isPending || createTerminalMutation.isPending
            ? "Starting player…"
            : "Launch spotify_player"}
        </Button>
        {launchError ? <Text style={styles.errorText}>{launchError}</Text> : null}
        <Text style={styles.helperText}>
          Tip: the first run can take a while if Cargo needs to build the inspiration binary.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.terminalHeader}>
        <View style={styles.terminalHeaderInfo}>
          <AudioLines size={14} color={theme.colors.foregroundMuted} />
          <Text style={styles.terminalHeaderTitle}>/player</Text>
        </View>
        <Text style={styles.terminalHeaderMeta}>{SPOTIFY_TERMINAL_NAME}</Text>
      </View>
      <TerminalPane
        serverId={serverId}
        cwd={workspaceRoot}
        terminalId={spotifyTerminal.id}
        isPaneFocused
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
    backgroundColor: theme.colors.background,
    gap: theme.spacing[2],
  },
  emptyState: {
    flex: 1,
    alignItems: "flex-start",
    justifyContent: "center",
    padding: theme.spacing[4],
    backgroundColor: theme.colors.background,
    gap: theme.spacing[3],
  },
  heroIcon: {
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
  messageTitle: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  messageBody: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    lineHeight: Math.round(theme.fontSize.sm * 1.5),
  },
  helperText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    lineHeight: Math.round(theme.fontSize.xs * 1.5),
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
  terminalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  terminalHeaderInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  terminalHeaderTitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  terminalHeaderMeta: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
}));

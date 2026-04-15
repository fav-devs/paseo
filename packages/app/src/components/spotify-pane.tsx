import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ListTerminalsResponse } from "@server/shared/messages";
import { TerminalStreamController } from "@/terminal/runtime/terminal-stream-controller";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSpotifyPreviewStore } from "@/stores/spotify-preview-store";
import { useSessionStore } from "@/stores/session-store";
import { upsertTerminalListEntry } from "@/utils/terminal-list";
import { SpotifyMobileCliShell, type SpotifyRepeatMode } from "./spotify/spotify-mobile-cli-shell";
import {
  SPOTIFY_ACTION_KEYMAP,
  SPOTIFY_DEVICES_PROBE_COMMAND,
  SPOTIFY_LAUNCH_COMMAND,
  SPOTIFY_PLAYBACK_PROBE_COMMAND,
  SPOTIFY_PROBE_TERMINAL_NAME,
  SPOTIFY_TERMINAL_NAME,
  type SpotifyCliAction,
} from "./spotify/spotify-cli-controls";
import {
  parseSpotifyDevicesProbeFromCapture,
  parseSpotifyPlaybackProbeFromCapture,
  type ParsedSpotifyDevice,
  parseSpotifyTerminalSnapshot,
} from "./spotify/spotify-terminal-parser";

const TERMINALS_QUERY_STALE_TIME = 5_000;
const SNAPSHOT_REFRESH_INTERVAL_MS = 1_500;
const PROBE_POLL_INTERVAL_MS = 2_500;
const PROBE_CAPTURE_LINE_COUNT = 220;
const DEFAULT_DURATION_MS = 1000 * 3 * 60 + 25_000;

type ListTerminalsPayload = ListTerminalsResponse["payload"];

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function SpotifyPane({
  serverId,
  workspaceRoot,
}: {
  serverId: string;
  workspaceRoot: string;
}) {
  const queryClient = useQueryClient();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const setSpotifyPreview = useSpotifyPreviewStore((state) => state.setPreview);
  const streamControllerRef = useRef<TerminalStreamController | null>(null);

  const [launchError, setLaunchError] = useState<string | null>(null);
  const [title, setTitle] = useState("Unknown Track");
  const [artist, setArtist] = useState("spotify_player session");
  const [albumImageUrl, setAlbumImageUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState<SpotifyRepeatMode>("off");
  const [progressMs, setProgressMs] = useState(0);
  const [durationMs, setDurationMs] = useState(DEFAULT_DURATION_MS);
  const [noPlaybackDetected, setNoPlaybackDetected] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [devices, setDevices] = useState<ParsedSpotifyDevice[]>([]);
  const [isDevicesLoading, setIsDevicesLoading] = useState(false);

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
  const spotifyProbeTerminal =
    query.data?.terminals.find((terminal) => terminal.name === SPOTIFY_PROBE_TERMINAL_NAME) ?? null;

  const applySnapshot = useCallback(
    (stateText: ReturnType<typeof parseSpotifyTerminalSnapshot>) => {
      if (stateText.title && stateText.title.length > 0) {
        setTitle(stateText.title);
      }
      if (stateText.artist && stateText.artist.length > 0) {
        setArtist(stateText.artist);
      }
      if (stateText.isPlaying !== null) {
        setIsPlaying(stateText.isPlaying);
      }
      if (stateText.isLiked !== null) {
        setIsLiked(stateText.isLiked);
      }
      if (stateText.shuffleEnabled !== null) {
        setShuffleEnabled(stateText.shuffleEnabled);
      }
      if (stateText.repeatMode !== null) {
        setRepeatMode(stateText.repeatMode);
      }
      if (stateText.elapsedMs !== null) {
        setProgressMs(stateText.elapsedMs);
      }
      if (stateText.durationMs !== null && stateText.durationMs > 0) {
        setDurationMs(stateText.durationMs);
      }
      if (stateText.deviceName !== null) {
        setDeviceName(stateText.deviceName);
      }
      setNoPlaybackDetected(stateText.noPlayback);
    },
    [],
  );

  const applyPlaybackProbe = useCallback(
    (probeState: NonNullable<ReturnType<typeof parseSpotifyPlaybackProbeFromCapture>>) => {
      if (probeState.title && probeState.title.length > 0) {
        setTitle(probeState.title);
      }
      if (probeState.artist && probeState.artist.length > 0) {
        setArtist(probeState.artist);
      }
      if (probeState.albumImageUrl) {
        setAlbumImageUrl(probeState.albumImageUrl);
      }
      if (probeState.isPlaying !== null) {
        setIsPlaying(probeState.isPlaying);
      }
      if (probeState.shuffleEnabled !== null) {
        setShuffleEnabled(probeState.shuffleEnabled);
      }
      if (probeState.repeatMode !== null) {
        setRepeatMode(probeState.repeatMode);
      }
      if (probeState.elapsedMs !== null) {
        setProgressMs(probeState.elapsedMs);
      }
      if (probeState.durationMs !== null && probeState.durationMs > 0) {
        setDurationMs(probeState.durationMs);
      }
      if (probeState.deviceId !== null) {
        setActiveDeviceId(probeState.deviceId);
      }
      if (probeState.deviceName !== null) {
        setDeviceName(probeState.deviceName);
      }
      setNoPlaybackDetected(probeState.noPlayback);
    },
    [],
  );

  const createTerminalMutation = useMutation({
    mutationFn: async () => {
      if (!client) {
        throw new Error("Host is not connected");
      }
      const payload = await client.createTerminal(workspaceRoot, SPOTIFY_TERMINAL_NAME);
      if (!payload.terminal) {
        throw new Error(payload.error ?? "Unable to create spotify_player terminal.");
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

  const createProbeTerminalMutation = useMutation({
    mutationFn: async () => {
      if (!client) {
        throw new Error("Host is not connected");
      }
      const payload = await client.createTerminal(workspaceRoot, SPOTIFY_PROBE_TERMINAL_NAME);
      if (!payload.terminal) {
        throw new Error(payload.error ?? "Unable to create spotify_player probe terminal.");
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
        requestId: current?.requestId ?? `spotify-probe-terminal-${terminal.id}`,
      }));
    },
  });

  const sendInputMutation = useMutation({
    mutationFn: async ({ input, appendNewline }: { input: string; appendNewline?: boolean }) => {
      if (!client) {
        throw new Error("Host is not connected");
      }
      const terminal = spotifyTerminal ?? (await createTerminalMutation.mutateAsync());
      const data = appendNewline ? `${input}\n` : input;
      client.sendTerminalInput(terminal.id, { type: "input", data });
      return terminal;
    },
    onMutate: () => {
      setLaunchError(null);
    },
    onError: (error) => {
      setLaunchError(error instanceof Error ? error.message : "Unable to talk to spotify_player.");
    },
  });

  const launchMutation = useMutation({
    mutationFn: async () => {
      return sendInputMutation.mutateAsync({ input: SPOTIFY_LAUNCH_COMMAND, appendNewline: true });
    },
    onMutate: () => {
      setLaunchError(null);
      setNoPlaybackDetected(false);
    },
  });

  useEffect(() => {
    if (!serverId || !workspaceRoot) {
      return;
    }
    setSpotifyPreview({
      serverId,
      workspaceRoot,
      preview: {
        title,
        artist,
        albumImageUrl,
        isPlaying,
      },
    });
  }, [albumImageUrl, artist, isPlaying, serverId, setSpotifyPreview, title, workspaceRoot]);

  useEffect(() => {
    streamControllerRef.current?.dispose();
    streamControllerRef.current = null;

    if (!client || !isConnected || !spotifyTerminal) {
      return;
    }

    const controller = new TerminalStreamController({
      client,
      getPreferredSize: () => null,
      onOutput: ({ text }) => {
        const normalized = text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
        if (normalized.includes("spotify_player was not found in PATH")) {
          setLaunchError(
            "spotify_player binary was not found. Install spotify_player or use the local inspo build.",
          );
        }
      },
      onSnapshot: ({ state }) => {
        applySnapshot(parseSpotifyTerminalSnapshot(state));
      },
      onStatusChange: (status) => {
        if (status.error && status.error !== "Terminal exited") {
          setLaunchError(status.error);
        }
      },
    });

    streamControllerRef.current = controller;
    controller.setTerminal({ terminalId: spotifyTerminal.id });

    const refreshIntervalId = setInterval(() => {
      void client.subscribeTerminal(spotifyTerminal.id).catch(() => {});
    }, SNAPSHOT_REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(refreshIntervalId);
      controller.dispose();
      if (streamControllerRef.current === controller) {
        streamControllerRef.current = null;
      }
    };
  }, [applySnapshot, client, isConnected, spotifyTerminal]);

  useEffect(() => {
    if (!client || !isConnected) {
      return;
    }

    let cancelled = false;
    let pollInFlight = false;

    const pollPlayback = async () => {
      if (cancelled || pollInFlight) {
        return;
      }
      pollInFlight = true;
      setIsDevicesLoading(true);
      try {
        const probeTerminal =
          spotifyProbeTerminal ?? (await createProbeTerminalMutation.mutateAsync());
        client.sendTerminalInput(probeTerminal.id, {
          type: "input",
          data: `${SPOTIFY_PLAYBACK_PROBE_COMMAND}\n`,
        });
        await new Promise((resolve) => setTimeout(resolve, 250));
        const capture = await client.captureTerminal(probeTerminal.id, {
          start: -PROBE_CAPTURE_LINE_COUNT,
          end: -1,
          stripAnsi: true,
        });
        const parsedProbe = parseSpotifyPlaybackProbeFromCapture(capture.lines);
        if (parsedProbe) {
          applyPlaybackProbe(parsedProbe);
        }

        client.sendTerminalInput(probeTerminal.id, {
          type: "input",
          data: `${SPOTIFY_DEVICES_PROBE_COMMAND}\n`,
        });
        await new Promise((resolve) => setTimeout(resolve, 250));
        const devicesCapture = await client.captureTerminal(probeTerminal.id, {
          start: -PROBE_CAPTURE_LINE_COUNT,
          end: -1,
          stripAnsi: true,
        });
        const parsedDevices = parseSpotifyDevicesProbeFromCapture(devicesCapture.lines);
        if (parsedDevices) {
          setDevices(parsedDevices);
          const active = parsedDevices.find((device) => device.isActive);
          if (active) {
            setActiveDeviceId(active.id);
          }
        }
      } catch {
        // Probe updates are best-effort; main terminal snapshot parsing remains active.
      } finally {
        setIsDevicesLoading(false);
        pollInFlight = false;
      }
    };

    void pollPlayback();
    const intervalId = setInterval(() => {
      void pollPlayback();
    }, PROBE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [applyPlaybackProbe, client, createProbeTerminalMutation, isConnected, spotifyProbeTerminal]);

  const handleLaunch = useCallback(() => {
    launchMutation.mutate();
  }, [launchMutation]);

  const handleAction = useCallback(
    (action: SpotifyCliAction) => {
      sendInputMutation.mutate({ input: SPOTIFY_ACTION_KEYMAP[action] });

      if (action === "playPause") {
        setIsPlaying((current) => !current);
      } else if (action === "shuffle") {
        setShuffleEnabled((current) => !current);
      } else if (action === "repeat") {
        setRepeatMode((current) =>
          current === "off" ? "context" : current === "context" ? "track" : "off",
        );
      } else if (action === "volumeUp") {
        setNoPlaybackDetected(false);
      } else if (action === "volumeDown") {
        setNoPlaybackDetected(false);
      }
    },
    [sendInputMutation],
  );

  const handleConnectDevice = useCallback(
    (deviceId: string) => {
      if (!deviceId) {
        return;
      }
      sendInputMutation.mutate({
        input: `spotify_player connect --id ${deviceId}`,
        appendNewline: true,
      });
      setActiveDeviceId(deviceId);
      setNoPlaybackDetected(false);
    },
    [sendInputMutation],
  );

  const handleRefreshDevices = useCallback(() => {
    if (!client || !isConnected) {
      return;
    }

    setIsDevicesLoading(true);
    void (async () => {
      try {
        const probeTerminal =
          spotifyProbeTerminal ?? (await createProbeTerminalMutation.mutateAsync());
        client.sendTerminalInput(probeTerminal.id, {
          type: "input",
          data: `${SPOTIFY_DEVICES_PROBE_COMMAND}\n`,
        });
        await new Promise((resolve) => setTimeout(resolve, 250));
        const devicesCapture = await client.captureTerminal(probeTerminal.id, {
          start: -PROBE_CAPTURE_LINE_COUNT,
          end: -1,
          stripAnsi: true,
        });
        const parsedDevices = parseSpotifyDevicesProbeFromCapture(devicesCapture.lines);
        if (parsedDevices) {
          setDevices(parsedDevices);
          const active = parsedDevices.find((device) => device.isActive);
          if (active) {
            setActiveDeviceId(active.id);
          }
        }
      } finally {
        setIsDevicesLoading(false);
      }
    })();
  }, [client, createProbeTerminalMutation, isConnected, spotifyProbeTerminal]);

  const isReady = Boolean(spotifyTerminal);
  const statusLabel =
    !client || !isConnected
      ? "Daemon disconnected"
      : !isReady
        ? "Idle"
        : noPlaybackDetected
          ? "No playback"
          : deviceName
            ? `CLI ready • ${deviceName}`
            : "CLI ready";
  const canControl = Boolean(client && isConnected);
  const resolvedDuration = durationMs > 0 ? durationMs : DEFAULT_DURATION_MS;
  const resolvedProgress = Math.min(progressMs, resolvedDuration);
  const audioRoutingHint = noPlaybackDetected
    ? "Audio plays on the active Spotify Connect device. Choose a device below, then start playback."
    : `Audio is routed by Spotify Connect${
        deviceName ? ` to ${deviceName}` : ""
      }. Switch devices below at any time.`;

  return (
    <SpotifyMobileCliShell
      canControl={canControl}
      isLaunching={
        launchMutation.isPending ||
        createTerminalMutation.isPending ||
        createProbeTerminalMutation.isPending
      }
      isReady={isReady}
      launchError={launchError}
      title={title}
      artist={artist}
      albumImageUrl={albumImageUrl}
      isPlaying={isPlaying}
      isLiked={isLiked}
      shuffleEnabled={shuffleEnabled}
      repeatMode={repeatMode}
      progressRatio={resolvedDuration > 0 ? resolvedProgress / resolvedDuration : 0}
      elapsedLabel={formatElapsed(resolvedProgress)}
      durationLabel={formatElapsed(resolvedDuration)}
      statusLabel={statusLabel}
      devices={devices}
      activeDeviceId={activeDeviceId}
      isDevicesLoading={isDevicesLoading}
      audioRoutingHint={audioRoutingHint}
      onLaunch={handleLaunch}
      onToggleLike={() => setIsLiked((current) => !current)}
      onConnectDevice={handleConnectDevice}
      onRefreshDevices={handleRefreshDevices}
      onAction={handleAction}
    />
  );
}

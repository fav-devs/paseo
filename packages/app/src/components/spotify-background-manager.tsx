import { useEffect, useRef } from "react";
import { useHosts, useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useSpotifyPreviewStore } from "@/stores/spotify-preview-store";
import { useSpotifyRuntimeStore } from "@/stores/spotify-runtime-store";
import { TerminalStreamController } from "@/terminal/runtime/terminal-stream-controller";
import {
  SPOTIFY_DEVICES_PROBE_COMMAND,
  SPOTIFY_LAUNCH_COMMAND,
  SPOTIFY_PLAYBACK_PROBE_COMMAND,
  SPOTIFY_PROBE_TERMINAL_NAME,
  SPOTIFY_TERMINAL_NAME,
} from "./spotify/spotify-cli-controls";
import {
  parseSpotifyPlaybackProbeFromCapture,
  parseSpotifyTerminalSnapshot,
} from "./spotify/spotify-terminal-parser";

const PROBE_CAPTURE_LINE_COUNT = 220;
const PROBE_POLL_INTERVAL_MS = 2_500;
const TERMINAL_DISCOVERY_INTERVAL_MS = 15_000;

function ManagedSpotifyBackgroundSession({ serverId }: { serverId: string }) {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const setPreview = useSpotifyPreviewStore((state) => state.setPreview);
  const clearPreview = useSpotifyPreviewStore((state) => state.clearPreview);
  const setManaged = useSpotifyRuntimeStore((state) => state.setManaged);
  const setTerminalIds = useSpotifyRuntimeStore((state) => state.setTerminalIds);
  const terminalIds = useSpotifyRuntimeStore(
    (state) =>
      state.terminalIdsByServer[serverId] ?? { mainTerminalId: null, probeTerminalId: null },
  );
  const workspaceCwd = useSessionStore((state) => {
    const session = state.sessions[serverId];
    if (!session) {
      return null;
    }
    for (const workspaceId of session.workspaces.keys()) {
      return workspaceId;
    }
    for (const agent of session.agents.values()) {
      return agent.cwd;
    }
    return null;
  });
  const streamControllerRef = useRef<TerminalStreamController | null>(null);
  const launchedTerminalRef = useRef<string | null>(null);

  useEffect(() => {
    setManaged({ serverId, managed: true });
    return () => {
      setManaged({ serverId, managed: false });
      setTerminalIds({ serverId, mainTerminalId: null, probeTerminalId: null });
      clearPreview({ serverId });
    };
  }, [clearPreview, serverId, setManaged, setTerminalIds]);

  useEffect(() => {
    if (!client || !isConnected) {
      setTerminalIds({ serverId, mainTerminalId: null, probeTerminalId: null });
      return;
    }

    let cancelled = false;

    const ensureTerminals = async () => {
      try {
        const listing = await client.listTerminals();
        let mainTerminal =
          listing.terminals.find((terminal) => terminal.name === SPOTIFY_TERMINAL_NAME) ?? null;
        let probeTerminal =
          listing.terminals.find((terminal) => terminal.name === SPOTIFY_PROBE_TERMINAL_NAME) ??
          null;

        if (cancelled) {
          return;
        }

        setTerminalIds({
          serverId,
          mainTerminalId: mainTerminal?.id ?? null,
          probeTerminalId: probeTerminal?.id ?? null,
        });

        if (mainTerminal && launchedTerminalRef.current !== mainTerminal.id) {
          launchedTerminalRef.current = mainTerminal.id;
          client.sendTerminalInput(mainTerminal.id, {
            type: "input",
            data: `${SPOTIFY_LAUNCH_COMMAND}\n`,
          });
        }
      } catch {
        // Best effort background lifecycle management.
      }
    };

    void ensureTerminals();
    const intervalId = setInterval(() => {
      void ensureTerminals();
    }, TERMINAL_DISCOVERY_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [client, isConnected, serverId, setTerminalIds, workspaceCwd]);

  useEffect(() => {
    streamControllerRef.current?.dispose();
    streamControllerRef.current = null;

    if (!client || !isConnected || !terminalIds.mainTerminalId) {
      return;
    }

    const controller = new TerminalStreamController({
      client,
      getPreferredSize: () => null,
      onOutput: () => {},
      onSnapshot: ({ state }) => {
        const snapshot = parseSpotifyTerminalSnapshot(state);
        setPreview({
          serverId,
          preview: {
            title: snapshot.title && snapshot.title.length > 0 ? snapshot.title : "Unknown Track",
            artist:
              snapshot.artist && snapshot.artist.length > 0
                ? snapshot.artist
                : "spotify_player session",
            albumImageUrl: null,
            isPlaying: snapshot.isPlaying ?? false,
          },
        });
      },
      onStatusChange: () => {},
    });

    streamControllerRef.current = controller;
    controller.setTerminal({ terminalId: terminalIds.mainTerminalId });

    return () => {
      controller.dispose();
      if (streamControllerRef.current === controller) {
        streamControllerRef.current = null;
      }
    };
  }, [client, isConnected, serverId, setPreview, terminalIds.mainTerminalId]);

  useEffect(() => {
    if (!client || !isConnected || !terminalIds.probeTerminalId) {
      return;
    }

    let cancelled = false;
    let pollInFlight = false;

    const pollPlayback = async () => {
      if (cancelled || pollInFlight) {
        return;
      }
      pollInFlight = true;
      try {
        client.sendTerminalInput(terminalIds.probeTerminalId!, {
          type: "input",
          data: `${SPOTIFY_PLAYBACK_PROBE_COMMAND}\n`,
        });
        await new Promise((resolve) => setTimeout(resolve, 250));
        const capture = await client.captureTerminal(terminalIds.probeTerminalId!, {
          start: -PROBE_CAPTURE_LINE_COUNT,
          end: -1,
          stripAnsi: true,
        });
        const parsedProbe = parseSpotifyPlaybackProbeFromCapture(capture.lines);
        if (parsedProbe) {
          setPreview({
            serverId,
            preview: {
              title: parsedProbe.title || "Unknown Track",
              artist: parsedProbe.artist || "spotify_player session",
              albumImageUrl: parsedProbe.albumImageUrl ?? null,
              isPlaying: parsedProbe.isPlaying ?? false,
            },
          });
        }

        client.sendTerminalInput(terminalIds.probeTerminalId!, {
          type: "input",
          data: `${SPOTIFY_DEVICES_PROBE_COMMAND}\n`,
        });
      } catch {
        // Background poll is best effort.
      } finally {
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
  }, [client, isConnected, serverId, setPreview, terminalIds.probeTerminalId]);

  return null;
}

export function SpotifyBackgroundManager() {
  const hosts = useHosts();

  if (hosts.length === 0) {
    return null;
  }

  return (
    <>
      {hosts.map((host) => (
        <ManagedSpotifyBackgroundSession key={host.serverId} serverId={host.serverId} />
      ))}
    </>
  );
}

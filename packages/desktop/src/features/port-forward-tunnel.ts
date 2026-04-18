/**
 * Tunneled port forward manager for Electron desktop.
 *
 * Creates local TCP listeners on the client machine and bridges them through
 * the relay / local WebSocket to daemon-side TCP targets.  This is the
 * VS Code-style model: the client binds the local port, the daemon connects
 * to the target, data flows as pf_stream_* frames over the existing session.
 */

import net from "node:net";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TunneledForward {
  portForwardId: string;
  localPort: number;
  targetHost: string;
  targetPort: number;
  server: net.Server;
}

interface ActiveStream {
  socket: net.Socket;
  portForwardId: string;
}

// ---------------------------------------------------------------------------
// Port probing
// ---------------------------------------------------------------------------

function tryBindPort(port: number, host: string): Promise<net.Server | null> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(null));
    server.once("listening", () => resolve(server));
    server.listen(port, host);
  });
}

async function findFreePort(
  startPort: number,
  bindHost: string,
): Promise<{ server: net.Server; port: number }> {
  for (let port = startPort; port < startPort + 20; port++) {
    const server = await tryBindPort(port, bindHost);
    if (server) {
      const addr = server.address();
      const resolvedPort = addr && typeof addr === "object" ? addr.port : port;
      return { server, port: resolvedPort };
    }
  }
  throw new Error(`No free port found starting from ${startPort}`);
}

// ---------------------------------------------------------------------------
// Tunnel manager
// ---------------------------------------------------------------------------

export function createPortForwardTunnelManager() {
  const forwards = new Map<string, TunneledForward>();
  const streams = new Map<string, ActiveStream>();

  let ws: WebSocket | null = null;
  let transportPath: string | null = null;
  let transportType: "socket" | "pipe" = "socket";

  // Pending create requests waiting for a create_port_forward_response
  const pendingCreates = new Map<
    string,
    { resolve: (id: string) => void; reject: (err: Error) => void }
  >();

  // Pending stream opens waiting for pf_stream_opened / pf_stream_error
  const pendingStreamOpens = new Map<
    string,
    { resolve: () => void; reject: (err: Error) => void }
  >();

  function buildLocalWsUrl(): string {
    if (!transportPath) throw new Error("No transport path configured");
    return `ws+unix://${transportPath}:/ws`;
  }

  function send(msg: unknown): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "session", message: msg }));
  }

  function ensureConnected(): Promise<void> {
    if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const url = buildLocalWsUrl();
      const sock = new WebSocket(url);

      sock.once("open", () => {
        ws = sock;
        resolve();
      });

      sock.once("error", (err) => {
        reject(err);
      });

      sock.on("message", (data) => {
        try {
          const envelope = JSON.parse(data.toString()) as {
            type: string;
            message?: unknown;
          };
          if (envelope.type === "session" && envelope.message) {
            handleSessionMessage(envelope.message as Record<string, unknown>);
          }
        } catch {
          // ignore unparseable frames
        }
      });

      sock.once("close", () => {
        ws = null;
      });
    });
  }

  function handleSessionMessage(msg: Record<string, unknown>): void {
    const type = msg.type as string;

    if (type === "create_port_forward_response") {
      const requestId = msg.requestId as string | undefined;
      if (!requestId) return;
      const pending = pendingCreates.get(requestId);
      if (!pending) return;
      pendingCreates.delete(requestId);

      const error = (msg.error as string | null) ?? null;
      if (error) {
        pending.reject(new Error(error));
        return;
      }
      const portForward = msg.portForward as { id: string } | null;
      if (!portForward?.id) {
        pending.reject(new Error("No port forward ID in response"));
        return;
      }
      pending.resolve(portForward.id);
    }

    if (type === "pf_stream_opened") {
      const streamId = msg.streamId as string;
      const pending = pendingStreamOpens.get(streamId);
      if (pending) {
        pendingStreamOpens.delete(streamId);
        pending.resolve();
      }
    }

    if (type === "pf_stream_error") {
      const streamId = msg.streamId as string;
      const error = (msg.error as string) || "Stream error";
      const pending = pendingStreamOpens.get(streamId);
      if (pending) {
        pendingStreamOpens.delete(streamId);
        pending.reject(new Error(error));
        return;
      }
      // Already open — close the TCP socket
      const stream = streams.get(streamId);
      if (stream) {
        streams.delete(streamId);
        stream.socket.destroy();
      }
    }

    if (type === "pf_stream_data") {
      const streamId = msg.streamId as string;
      const data = msg.data as string;
      const stream = streams.get(streamId);
      if (stream && !stream.socket.destroyed) {
        stream.socket.write(Buffer.from(data, "base64"));
      }
    }

    if (type === "pf_stream_close") {
      const streamId = msg.streamId as string;
      const stream = streams.get(streamId);
      if (stream) {
        streams.delete(streamId);
        stream.socket.destroy();
      }
    }
  }

  function attachSocket(tcpSocket: net.Socket, portForwardId: string): void {
    const streamId = randomUUID();

    const openPromise = new Promise<void>((resolve, reject) => {
      pendingStreamOpens.set(streamId, { resolve, reject });
    });

    send({ type: "pf_stream_open", streamId, portForwardId });

    openPromise
      .then(() => {
        streams.set(streamId, { socket: tcpSocket, portForwardId });

        tcpSocket.on("data", (chunk: Buffer) => {
          send({ type: "pf_stream_data", streamId, data: chunk.toString("base64") });
        });

        tcpSocket.once("close", () => {
          if (streams.has(streamId)) {
            streams.delete(streamId);
            send({ type: "pf_stream_close", streamId });
          }
        });

        tcpSocket.on("error", () => {
          tcpSocket.destroy();
        });
      })
      .catch(() => {
        tcpSocket.destroy();
      });
  }

  return {
    setTransport(path: string, type: "socket" | "pipe"): void {
      transportPath = path;
      transportType = type;
      // transportType is stored for future use if needed
      void transportType;
    },

    async createTunneledForward(options: {
      cwd: string;
      targetHost: string;
      targetPort: number;
      name?: string;
      bindHost?: string;
    }): Promise<{ portForwardId: string; localPort: number }> {
      const bindHost = options.bindHost?.trim() || "127.0.0.1";

      await ensureConnected();

      // Bind local port first (VS Code style: try targetPort, then increment)
      const { server, port: localPort } = await findFreePort(options.targetPort, bindHost);

      // Create the port forward record on the daemon
      const requestId = randomUUID();
      const createPromise = new Promise<string>((resolve, reject) => {
        pendingCreates.set(requestId, { resolve, reject });
      });

      send({
        type: "create_port_forward_request",
        cwd: options.cwd,
        name: options.name,
        bindHost,
        localPort,
        targetHost: options.targetHost,
        targetPort: options.targetPort,
        tunneled: true,
        requestId,
      });

      let portForwardId: string;
      try {
        portForwardId = await createPromise;
      } catch (err) {
        server.close();
        throw err;
      }

      // Wire up the TCP server
      server.on("connection", (tcpSocket: net.Socket) => {
        attachSocket(tcpSocket, portForwardId);
      });

      server.on("error", () => {
        void this.closeTunneledForward(portForwardId);
      });

      const forward: TunneledForward = {
        portForwardId,
        localPort,
        targetHost: options.targetHost,
        targetPort: options.targetPort,
        server,
      };
      forwards.set(portForwardId, forward);

      return { portForwardId, localPort };
    },

    async closeTunneledForward(portForwardId: string): Promise<void> {
      const forward = forwards.get(portForwardId);
      if (!forward) return;
      forwards.delete(portForwardId);

      // Destroy all streams for this forward
      for (const [streamId, stream] of streams) {
        if (stream.portForwardId === portForwardId) {
          streams.delete(streamId);
          stream.socket.destroy();
        }
      }

      // Close local TCP server
      await new Promise<void>((resolve) => forward.server.close(() => resolve()));

      // Tell daemon to close the record
      if (ws && ws.readyState === WebSocket.OPEN) {
        const requestId = randomUUID();
        send({ type: "close_port_forward_request", portForwardId, requestId });
      }
    },

    closeAll(): void {
      for (const [id] of forwards) {
        void this.closeTunneledForward(id);
      }
      ws?.close();
      ws = null;
    },
  };
}

export type PortForwardTunnelManager = ReturnType<typeof createPortForwardTunnelManager>;

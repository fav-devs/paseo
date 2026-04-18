import { randomUUID } from "node:crypto";
import net from "node:net";
import { resolve, win32, posix } from "node:path";

export interface PortForwardListItem {
  id: string;
  name: string;
  cwd: string;
  bindHost: string;
  localPort: number;
  targetHost: string;
  targetPort: number;
  tunneled: boolean;
}

export interface PortForwardsChangedEvent {
  cwd: string;
  portForwards: PortForwardListItem[];
}

export type PortForwardsChangedListener = (input: PortForwardsChangedEvent) => void;

export interface PortForwardSession {
  id: string;
  name: string;
  cwd: string;
  bindHost: string;
  localPort: number;
  targetHost: string;
  targetPort: number;
  tunneled: boolean;
  close(): Promise<void>;
  onClose(listener: () => void): () => void;
}

export interface PortForwardManager {
  getPortForwards(cwd: string): Promise<PortForwardSession[]>;
  createPortForward(options: {
    cwd: string;
    name?: string;
    bindHost?: string;
    localPort: number;
    targetHost: string;
    targetPort: number;
    tunneled?: boolean;
  }): Promise<PortForwardSession>;
  getPortForward(id: string): PortForwardSession | undefined;
  closePortForward(id: string): Promise<void>;
  listDirectories(): string[];
  closeAll(): Promise<void>;
  subscribePortForwardsChanged(listener: PortForwardsChangedListener): () => void;
}

function assertAbsolutePath(cwd: string): void {
  if (!posix.isAbsolute(cwd) && !win32.isAbsolute(cwd)) {
    throw new Error("cwd must be absolute path");
  }
}

function normalizeRootPath(cwd: string): string {
  return resolve(cwd);
}

function defaultName(input: { localPort: number; targetPort: number; tunneled: boolean }): string {
  if (input.tunneled) {
    return `Tunnel → ${input.targetPort}`;
  }
  if (input.localPort > 0) {
    return `Forward ${input.localPort}`;
  }
  return `Forward → ${input.targetPort}`;
}

async function createPortForwardSession(options: {
  cwd: string;
  name?: string;
  bindHost: string;
  localPort: number;
  targetHost: string;
  targetPort: number;
}): Promise<PortForwardSession> {
  const id = randomUUID();
  const onCloseListeners = new Set<() => void>();
  const sockets = new Set<net.Socket>();
  let closed = false;

  const server = net.createServer((incomingSocket) => {
    const targetSocket = net.createConnection({
      host: options.targetHost,
      port: options.targetPort,
    });

    sockets.add(incomingSocket);
    sockets.add(targetSocket);

    const detach = (socket: net.Socket) => {
      sockets.delete(socket);
    };

    incomingSocket.on("close", () => detach(incomingSocket));
    targetSocket.on("close", () => detach(targetSocket));

    incomingSocket.on("error", () => {
      incomingSocket.destroy();
      targetSocket.destroy();
    });
    targetSocket.on("error", () => {
      incomingSocket.destroy();
      targetSocket.destroy();
    });

    incomingSocket.pipe(targetSocket);
    targetSocket.pipe(incomingSocket);
  });

  const closeSession = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;

    for (const socket of sockets) {
      socket.destroy();
    }
    sockets.clear();

    await new Promise<void>((resolveClose) => {
      server.close(() => resolveClose());
    });

    for (const listener of onCloseListeners) {
      try {
        listener();
      } catch {
        // no-op
      }
    }
  };

  server.on("close", () => {
    if (closed) {
      return;
    }
    closed = true;
    for (const listener of onCloseListeners) {
      try {
        listener();
      } catch {
        // no-op
      }
    }
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolveListen();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.localPort, options.bindHost);
  });

  const address = server.address();
  const resolvedLocalPort =
    address && typeof address === "object" ? address.port : options.localPort;
  const resolvedName =
    options.name?.trim() ||
    "" ||
    defaultName({
      localPort: resolvedLocalPort,
      targetPort: options.targetPort,
      tunneled: false,
    });

  return {
    id,
    name: resolvedName,
    cwd: options.cwd,
    bindHost: options.bindHost,
    localPort: resolvedLocalPort,
    targetHost: options.targetHost,
    targetPort: options.targetPort,
    tunneled: false,
    close: closeSession,
    onClose(listener: () => void): () => void {
      onCloseListeners.add(listener);
      return () => {
        onCloseListeners.delete(listener);
      };
    },
  };
}

function createTunneledPortForwardSession(options: {
  cwd: string;
  name?: string;
  localPort: number;
  targetHost: string;
  targetPort: number;
}): PortForwardSession {
  const id = randomUUID();
  const onCloseListeners = new Set<() => void>();
  let closed = false;

  const resolvedName =
    options.name?.trim() ||
    defaultName({ localPort: options.localPort, targetPort: options.targetPort, tunneled: true });

  const closeSession = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    for (const listener of onCloseListeners) {
      try {
        listener();
      } catch {
        // no-op
      }
    }
  };

  return {
    id,
    name: resolvedName,
    cwd: options.cwd,
    bindHost: "",
    localPort: options.localPort,
    targetHost: options.targetHost,
    targetPort: options.targetPort,
    tunneled: true,
    close: closeSession,
    onClose(listener: () => void): () => void {
      onCloseListeners.add(listener);
      return () => {
        onCloseListeners.delete(listener);
      };
    },
  };
}

export function createPortForwardManager(): PortForwardManager {
  const portForwardsByCwd = new Map<string, PortForwardSession[]>();
  const portForwardsById = new Map<string, PortForwardSession>();
  const portForwardCloseUnsubscribeById = new Map<string, () => void>();
  const portForwardsChangedListeners = new Set<PortForwardsChangedListener>();

  function toPortForwardListItem(session: PortForwardSession): PortForwardListItem {
    return {
      id: session.id,
      name: session.name,
      cwd: session.cwd,
      bindHost: session.bindHost,
      localPort: session.localPort,
      targetHost: session.targetHost,
      targetPort: session.targetPort,
      tunneled: session.tunneled,
    };
  }

  function emitPortForwardsChanged(cwd: string): void {
    if (portForwardsChangedListeners.size === 0) {
      return;
    }
    const portForwards = (portForwardsByCwd.get(cwd) ?? []).map(toPortForwardListItem);
    const event: PortForwardsChangedEvent = { cwd, portForwards };
    for (const listener of portForwardsChangedListeners) {
      try {
        listener(event);
      } catch {
        // no-op
      }
    }
  }

  async function removePortForwardById(id: string): Promise<void> {
    const session = portForwardsById.get(id);
    if (!session) {
      return;
    }

    const unsubscribeClose = portForwardCloseUnsubscribeById.get(id);
    if (unsubscribeClose) {
      unsubscribeClose();
      portForwardCloseUnsubscribeById.delete(id);
    }

    portForwardsById.delete(id);
    const cwdEntries = portForwardsByCwd.get(session.cwd);
    if (cwdEntries) {
      const nextEntries = cwdEntries.filter((entry) => entry.id !== id);
      if (nextEntries.length > 0) {
        portForwardsByCwd.set(session.cwd, nextEntries);
      } else {
        portForwardsByCwd.delete(session.cwd);
      }
    }

    await session.close();
    emitPortForwardsChanged(session.cwd);
  }

  function registerSession(session: PortForwardSession): PortForwardSession {
    portForwardsById.set(session.id, session);
    const unsubscribeClose = session.onClose(() => {
      void removePortForwardById(session.id);
    });
    portForwardCloseUnsubscribeById.set(session.id, unsubscribeClose);
    return session;
  }

  return {
    async getPortForwards(cwd: string): Promise<PortForwardSession[]> {
      assertAbsolutePath(cwd);
      return portForwardsByCwd.get(cwd) ?? [];
    },

    async createPortForward(options): Promise<PortForwardSession> {
      assertAbsolutePath(options.cwd);
      const session = registerSession(
        options.tunneled
          ? createTunneledPortForwardSession({
              cwd: options.cwd,
              name: options.name,
              localPort: options.localPort,
              targetHost: options.targetHost,
              targetPort: options.targetPort,
            })
          : await createPortForwardSession({
              cwd: options.cwd,
              name: options.name,
              bindHost: options.bindHost?.trim() || "127.0.0.1",
              localPort: options.localPort,
              targetHost: options.targetHost,
              targetPort: options.targetPort,
            }),
      );
      const entries = portForwardsByCwd.get(options.cwd) ?? [];
      portForwardsByCwd.set(options.cwd, [...entries, session]);
      emitPortForwardsChanged(options.cwd);
      return session;
    },

    getPortForward(id: string): PortForwardSession | undefined {
      return portForwardsById.get(id);
    },

    async closePortForward(id: string): Promise<void> {
      await removePortForwardById(id);
    },

    listDirectories(): string[] {
      return Array.from(portForwardsByCwd.keys()).map(normalizeRootPath);
    },

    async closeAll(): Promise<void> {
      for (const id of Array.from(portForwardsById.keys())) {
        await removePortForwardById(id);
      }
    },

    subscribePortForwardsChanged(listener: PortForwardsChangedListener): () => void {
      portForwardsChangedListeners.add(listener);
      return () => {
        portForwardsChangedListeners.delete(listener);
      };
    },
  };
}

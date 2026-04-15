import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPortForwardManager,
  type PortForwardManager,
  type PortForwardsChangedEvent,
} from "./port-forward-manager.js";

async function listenOnRandomPort(
  connectionHandler?: (socket: net.Socket) => void,
): Promise<net.Server> {
  const server = net.createServer(connectionHandler);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return server;
}

function getServerPort(server: net.Server): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }
  return address.port;
}

async function connectAndRead(port: number, message: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let data = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(message);
    });
    socket.on("data", (chunk) => {
      data += chunk;
      socket.end();
    });
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
  });
}

describe("PortForwardManager", () => {
  let manager: PortForwardManager | null = null;
  const cleanupServers: net.Server[] = [];

  afterEach(async () => {
    await manager?.closeAll();
    manager = null;
    await Promise.all(
      cleanupServers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
  });

  it("creates and lists a port forward for a workspace", async () => {
    const targetServer = await listenOnRandomPort();
    cleanupServers.push(targetServer);
    manager = createPortForwardManager();

    const session = await manager.createPortForward({
      cwd: "/repo/app",
      localPort: 0,
      targetHost: "127.0.0.1",
      targetPort: getServerPort(targetServer),
    });

    const entries = await manager.getPortForwards("/repo/app");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toBe(session);
    expect(session.bindHost).toBe("127.0.0.1");
    expect(session.localPort).toBeGreaterThan(0);
    expect(session.targetPort).toBe(getServerPort(targetServer));
  });

  it("forwards TCP traffic to the target host and port", async () => {
    const targetServer = await listenOnRandomPort((socket) => {
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => {
        socket.write(`pong:${chunk}`);
      });
    });
    cleanupServers.push(targetServer);
    manager = createPortForwardManager();

    const session = await manager.createPortForward({
      cwd: "/repo/app",
      localPort: 0,
      targetHost: "127.0.0.1",
      targetPort: getServerPort(targetServer),
    });

    await expect(connectAndRead(session.localPort, "ping")).resolves.toBe("pong:ping");
  });

  it("removes closed forwards and emits workspace change snapshots", async () => {
    const targetServer = await listenOnRandomPort();
    cleanupServers.push(targetServer);
    manager = createPortForwardManager();
    const events: PortForwardsChangedEvent[] = [];
    const unsubscribe = manager.subscribePortForwardsChanged((event) => {
      events.push(event);
    });

    const session = await manager.createPortForward({
      cwd: "/repo/app",
      localPort: 0,
      targetHost: "127.0.0.1",
      targetPort: getServerPort(targetServer),
    });

    await manager.closePortForward(session.id);
    unsubscribe();

    const entries = await manager.getPortForwards("/repo/app");
    expect(entries).toHaveLength(0);
    expect(events).toHaveLength(2);
    expect(events[0]?.portForwards).toHaveLength(1);
    expect(events[1]?.portForwards).toHaveLength(0);
  });

  it("rejects relative workspace paths", async () => {
    const targetServer = await listenOnRandomPort();
    cleanupServers.push(targetServer);
    manager = createPortForwardManager();

    await expect(
      manager.createPortForward({
        cwd: "repo/app",
        localPort: 0,
        targetHost: "127.0.0.1",
        targetPort: getServerPort(targetServer),
      }),
    ).rejects.toThrow("cwd must be absolute path");
  });
});

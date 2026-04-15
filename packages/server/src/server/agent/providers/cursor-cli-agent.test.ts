import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { CursorCliAgentClient, CursorCliAgentSession } from "./cursor-cli-agent.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import * as executableModule from "../../../utils/executable.js";
import * as spawnModule from "../../../utils/spawn.js";

const originalHome = process.env.HOME;

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  vi.restoreAllMocks();
});

describe("CursorCliAgentClient", () => {
  test("exposes cursor provider id and capabilities", () => {
    const client = new CursorCliAgentClient({ logger: createTestLogger() });
    expect(client.provider).toBe("cursor");
    expect(client.capabilities.supportsStreaming).toBe(true);
    expect(client.capabilities.supportsSessionPersistence).toBe(true);
  });

  test("streamHistory replays transcript history from .cursor/projects", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "cursor-home-"));
    process.env.HOME = home;

    const cwd = "/Users/test/workspace/paseo";
    const sessionId = "cursor-session-1";
    const transcriptDir = path.join(
      home,
      ".cursor",
      "projects",
      "Users-test-workspace-paseo",
      "agent-transcripts",
      sessionId,
    );
    await mkdir(transcriptDir, { recursive: true });
    await writeFile(
      path.join(transcriptDir, `${sessionId}.jsonl`),
      [
        JSON.stringify({
          role: "user",
          message: {
            content: [{ type: "text", text: "<user_query>\nhello cursor\n</user_query>" }],
          },
        }),
        JSON.stringify({
          role: "assistant",
          message: {
            content: [
              { type: "text", text: "first reply\n\n[REDACTED]" },
              { type: "tool_use", name: "Shell", input: { command: "pwd" } },
            ],
          },
        }),
        JSON.stringify({
          role: "assistant",
          message: { content: [{ type: "text", text: "[REDACTED]" }] },
        }),
        JSON.stringify({
          role: "assistant",
          message: { content: [{ type: "text", text: "second reply" }] },
        }),
      ].join("\n"),
      "utf8",
    );

    const session = new CursorCliAgentSession(
      { provider: "cursor", cwd },
      {
        logger: createTestLogger(),
        resumeChatId: sessionId,
      },
    );

    const events = [];
    for await (const event of session.streamHistory()) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "timeline",
        provider: "cursor",
        item: { type: "user_message", text: "hello cursor" },
      },
      {
        type: "timeline",
        provider: "cursor",
        item: { type: "assistant_message", text: "first reply" },
      },
      {
        type: "timeline",
        provider: "cursor",
        item: { type: "assistant_message", text: "second reply" },
      },
    ]);

    const replayedAgain = [];
    for await (const event of session.streamHistory()) {
      replayedAgain.push(event);
    }
    expect(replayedAgain).toEqual([]);
  });

  test("streamHistory ignores unsafe session ids for transcript lookup", async () => {
    const session = new CursorCliAgentSession(
      { provider: "cursor", cwd: "/Users/test/workspace/paseo" },
      {
        logger: createTestLogger(),
        resumeChatId: "../cursor-session-1",
      },
    );

    const events = [];
    for await (const event of session.streamHistory()) {
      events.push(event);
    }

    expect(events).toEqual([]);
  });

  test("startTurn enables partial streaming and ignores duplicate final assistant snapshot", async () => {
    vi.spyOn(executableModule, "findExecutable").mockResolvedValue("/home/favour/.local/bin/agent");

    const fakeChild = createFakeChildProcess();
    const spawnSpy = vi.spyOn(spawnModule, "spawnProcess").mockReturnValue(fakeChild as any);
    const session = new CursorCliAgentSession(
      { provider: "cursor", cwd: "/tmp/repo" },
      {
        logger: createTestLogger(),
        resumeChatId: null,
      },
    );

    const events: Array<{ type: string; item?: { type: string; text: string } }> = [];
    session.subscribe((event) => {
      if (event.type === "timeline" || event.type === "turn_completed") {
        events.push(event as any);
      }
    });

    await session.startTurn("hello");

    await vi.waitFor(() => {
      expect(spawnSpy).toHaveBeenCalledTimes(1);
    });
    const argv = spawnSpy.mock.calls[0]?.[1];
    expect(argv).toContain("--stream-partial-output");

    fakeChild.stdout.write(
      `${JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "cursor-session-1",
      })}\n`,
    );
    fakeChild.stdout.write(
      `${JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "Hel" }] },
        timestamp_ms: 1,
      })}\n`,
    );
    fakeChild.stdout.write(
      `${JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "lo" }] },
        timestamp_ms: 2,
      })}\n`,
    );
    fakeChild.stdout.write(
      `${JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "Hello" }] },
      })}\n`,
    );
    fakeChild.stdout.write(
      `${JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Hello",
        usage: { inputTokens: 1, outputTokens: 1 },
      })}\n`,
    );
    fakeChild.stdout.end();
    fakeChild.exitCode = 0;
    fakeChild.emit("exit", 0, null);

    await vi.waitFor(() => {
      expect(events.some((event) => event.type === "turn_completed")).toBe(true);
    });

    expect(
      events.filter((event) => event.type === "timeline").map((event) => event.item?.text),
    ).toEqual(["Hel", "lo"]);
  });
});

function createFakeChildProcess() {
  const emitter = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough;
    killed: boolean;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    kill: (signal?: NodeJS.Signals) => boolean;
  };
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.stdin = new PassThrough();
  emitter.killed = false;
  emitter.exitCode = null;
  emitter.signalCode = null;
  emitter.kill = (signal?: NodeJS.Signals) => {
    emitter.killed = true;
    emitter.signalCode = signal ?? null;
    return true;
  };
  return emitter;
}

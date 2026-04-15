import { describe, expect, test } from "vitest";
import {
  buildRewindCommand,
  extractBranchableUserMessages,
  supportsNativeRewind,
} from "./conversation-branch";
import type { StreamItem } from "@/types/stream";

describe("extractBranchableUserMessages", () => {
  test("returns only user messages with stable ids and indexes", () => {
    const timestamp = new Date("2025-01-01T00:00:00.000Z");
    const streamItems: StreamItem[] = [
      { kind: "user_message", id: "msg-1", text: "hello", timestamp },
      { kind: "assistant_message", id: "assistant-1", text: "hi", timestamp },
      { kind: "user_message", id: "msg-2", text: "redo this", timestamp },
    ];

    expect(extractBranchableUserMessages(streamItems)).toEqual([
      { id: "msg-1", text: "hello", userMessageIndex: 0 },
      { id: "msg-2", text: "redo this", userMessageIndex: 1 },
    ]);
  });

  test("exposes native rewind support only for Claude", () => {
    expect(supportsNativeRewind("claude")).toBe(true);
    expect(supportsNativeRewind("codex")).toBe(false);
  });

  test("builds rewind commands for latest and uuid-addressable Claude turns", () => {
    expect(
      buildRewindCommand({
        provider: "claude",
        selectedMessageId: "msg-local",
        latestUserMessageId: "msg-local",
      }),
    ).toBe("/rewind");

    expect(
      buildRewindCommand({
        provider: "claude",
        selectedMessageId: "123e4567-e89b-42d3-a456-426614174000",
        latestUserMessageId: "msg-latest",
      }),
    ).toBe("/rewind 123e4567-e89b-42d3-a456-426614174000");

    expect(
      buildRewindCommand({
        provider: "claude",
        selectedMessageId: "msg-older-local",
        latestUserMessageId: "msg-latest",
      }),
    ).toBeNull();
  });
});

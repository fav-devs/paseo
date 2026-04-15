import { describe, expect, test } from "vitest";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import { buildTranscriptFromTimeline } from "./agent-manager.js";

const TIMELINE: AgentTimelineItem[] = [
  { type: "user_message", text: "first prompt", messageId: "msg-1" },
  { type: "assistant_message", text: "first reply" },
  { type: "user_message", text: "second prompt", messageId: "msg-2" },
  { type: "assistant_message", text: "second reply" },
  { type: "user_message", text: "third prompt", messageId: "msg-3" },
];

describe("buildTranscriptFromTimeline", () => {
  test("preserves legacy tail transcript behavior by default", () => {
    expect(buildTranscriptFromTimeline(TIMELINE, "codex", "msg-2")).toBe(
      [
        "[Context from previous session (provider: codex)]",
        "",
        "User: second prompt",
        "",
        "Assistant: second reply",
        "",
        "User: third prompt",
      ].join("\n"),
    );
  });

  test("can fork from a selected message by keeping history through that message", () => {
    expect(buildTranscriptFromTimeline(TIMELINE, "codex", "msg-2", "through")).toBe(
      [
        "[Context from previous session (provider: codex)]",
        "",
        "User: first prompt",
        "",
        "Assistant: first reply",
        "",
        "User: second prompt",
      ].join("\n"),
    );
  });

  test("can edit a selected message by keeping only earlier history", () => {
    expect(buildTranscriptFromTimeline(TIMELINE, "codex", "msg-2", "before")).toBe(
      [
        "[Context from previous session (provider: codex)]",
        "",
        "User: first prompt",
        "",
        "Assistant: first reply",
      ].join("\n"),
    );
  });
});

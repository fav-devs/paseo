import { describe, expect, it } from "vitest";
import { buildSplitDiffRows, buildUnifiedDiffLines } from "./diff-layout";
import type { ParsedDiffFile } from "@/hooks/use-checkout-diff-query";

function makeFile(lines: ParsedDiffFile["hunks"][number]["lines"]): ParsedDiffFile {
  return {
    path: "example.ts",
    isNew: false,
    isDeleted: false,
    additions: lines.filter((line) => line.type === "add").length,
    deletions: lines.filter((line) => line.type === "remove").length,
    status: "ok",
    hunks: [
      {
        oldStart: 10,
        oldCount: 4,
        newStart: 10,
        newCount: 5,
        lines,
      },
    ],
  };
}

describe("buildSplitDiffRows", () => {
  it("pairs replacement runs by index", () => {
    const rows = buildSplitDiffRows(
      makeFile([
        { type: "header", content: "@@ -10,2 +10,2 @@" },
        { type: "remove", content: "before one" },
        { type: "remove", content: "before two" },
        { type: "add", content: "after one" },
        { type: "add", content: "after two" },
      ]),
    );

    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({
      kind: "pair",
      hunkIndex: 0,
      isFirstChangedLineInHunk: true,
      chatReference: "example.ts:10-11",
      left: { type: "remove", content: "before one", lineNumber: 10 },
      right: { type: "add", content: "after one", lineNumber: 10 },
    });
    expect(rows[2]).toMatchObject({
      kind: "pair",
      hunkIndex: 0,
      isFirstChangedLineInHunk: false,
      chatReference: "example.ts:10-11",
      left: { type: "remove", content: "before two", lineNumber: 11 },
      right: { type: "add", content: "after two", lineNumber: 11 },
    });
  });

  it("keeps unmatched additions on the right side only", () => {
    const rows = buildSplitDiffRows(
      makeFile([
        { type: "header", content: "@@ -10,1 +10,2 @@" },
        { type: "remove", content: "before" },
        { type: "add", content: "after one" },
        { type: "add", content: "after two" },
      ]),
    );

    expect(rows[2]).toMatchObject({
      kind: "pair",
      hunkIndex: 0,
      isFirstChangedLineInHunk: false,
      chatReference: "example.ts:10-11",
      left: null,
      right: { type: "add", content: "after two", lineNumber: 11 },
    });
  });

  it("duplicates context rows on both sides", () => {
    const rows = buildSplitDiffRows(
      makeFile([
        { type: "header", content: "@@ -10,1 +10,1 @@" },
        { type: "context", content: "same line" },
      ]),
    );

    expect(rows[1]).toMatchObject({
      kind: "pair",
      hunkIndex: 0,
      isFirstChangedLineInHunk: false,
      chatReference: "example.ts:10",
      left: { type: "context", content: "same line", lineNumber: 10 },
      right: { type: "context", content: "same line", lineNumber: 10 },
    });
  });

  it("marks the first changed row instead of leading context", () => {
    const rows = buildSplitDiffRows(
      makeFile([
        { type: "header", content: "@@ -10,3 +10,3 @@" },
        { type: "context", content: "same line" },
        { type: "remove", content: "before" },
        { type: "add", content: "after" },
      ]),
    );

    expect(rows[1]).toMatchObject({
      kind: "pair",
      isFirstChangedLineInHunk: false,
      left: { type: "context", content: "same line", lineNumber: 10 },
      right: { type: "context", content: "same line", lineNumber: 10 },
    });
    expect(rows[2]).toMatchObject({
      kind: "pair",
      isFirstChangedLineInHunk: true,
      chatReference: "example.ts:11",
      left: { type: "remove", content: "before", lineNumber: 11 },
      right: { type: "add", content: "after", lineNumber: 11 },
    });
  });

  it("uses surrounding new-side context for delete-only split rows", () => {
    const rows = buildSplitDiffRows({
      path: "example.ts",
      isNew: false,
      isDeleted: false,
      additions: 0,
      deletions: 6,
      status: "ok",
      hunks: [
        {
          oldStart: 237,
          oldCount: 8,
          newStart: 239,
          newCount: 2,
          lines: [
            { type: "header", content: "@@ -237,8 +239,2 @@" },
            { type: "context", content: "before" },
            { type: "remove", content: "deleted one" },
            { type: "remove", content: "deleted two" },
            { type: "remove", content: "deleted three" },
            { type: "remove", content: "deleted four" },
            { type: "remove", content: "deleted five" },
            { type: "remove", content: "deleted six" },
            { type: "context", content: "after" },
          ],
        },
      ],
    });

    expect(rows[2]).toMatchObject({
      kind: "pair",
      chatReference: "example.ts:239-240",
      left: { type: "remove", content: "deleted one", lineNumber: 238 },
      right: null,
    });
    expect(rows[7]).toMatchObject({
      kind: "pair",
      chatReference: "example.ts:239-240",
      left: { type: "remove", content: "deleted six", lineNumber: 243 },
      right: null,
    });
  });
});

describe("buildUnifiedDiffLines", () => {
  it("computes line numbers per line type within a hunk", () => {
    const lines = buildUnifiedDiffLines(
      makeFile([
        { type: "header", content: "@@ -10,3 +10,4 @@" },
        { type: "context", content: "before" },
        { type: "add", content: "inserted" },
        { type: "remove", content: "removed" },
        { type: "context", content: "after" },
      ]),
    );

    expect(
      lines.map(({ line, lineNumber }) => ({
        type: line.type,
        lineNumber,
        content: line.content,
      })),
    ).toEqual([
      { type: "header", lineNumber: null, content: "@@ -10,3 +10,4 @@" },
      { type: "context", lineNumber: 10, content: "before" },
      { type: "add", lineNumber: 11, content: "inserted" },
      { type: "remove", lineNumber: 11, content: "removed" },
      { type: "context", lineNumber: 12, content: "after" },
    ]);
  });

  it("restarts numbering at each hunk boundary", () => {
    const file: ParsedDiffFile = {
      path: "example.ts",
      isNew: false,
      isDeleted: false,
      additions: 1,
      deletions: 0,
      status: "ok",
      hunks: [
        {
          oldStart: 75,
          oldCount: 2,
          newStart: 75,
          newCount: 3,
          lines: [
            { type: "header", content: "@@ -75,2 +75,3 @@" },
            { type: "context", content: "first" },
            { type: "add", content: "inserted" },
            { type: "context", content: "second" },
          ],
        },
        {
          oldStart: 165,
          oldCount: 2,
          newStart: 166,
          newCount: 2,
          lines: [
            { type: "header", content: "@@ -165,2 +166,2 @@" },
            { type: "context", content: "third" },
            { type: "context", content: "fourth" },
          ],
        },
      ],
    };

    const lines = buildUnifiedDiffLines(file);

    expect(lines[0]?.lineNumber).toBeNull();
    expect(lines[1]?.lineNumber).toBe(75);
    expect(lines[3]?.lineNumber).toBe(77);
    expect(lines[4]?.lineNumber).toBeNull();
    expect(lines[5]?.lineNumber).toBe(166);
    expect(lines[6]?.lineNumber).toBe(167);
  });
});

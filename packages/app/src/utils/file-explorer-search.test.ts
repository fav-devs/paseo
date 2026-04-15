import { describe, expect, it } from "vitest";

import {
  buildFileExplorerSearchExpansionPaths,
  buildFileExplorerSearchRows,
} from "./file-explorer-search";

describe("buildFileExplorerSearchRows", () => {
  it("derives names and parent paths from workspace search entries", () => {
    expect(
      buildFileExplorerSearchRows([
        { path: "src/components/file-explorer-pane.tsx", kind: "file" },
        { path: "src/components", kind: "directory" },
      ]),
    ).toEqual([
      {
        path: "src/components/file-explorer-pane.tsx",
        kind: "file",
        name: "file-explorer-pane.tsx",
        parentPath: "src/components",
      },
      {
        path: "src/components",
        kind: "directory",
        name: "components",
        parentPath: "src",
      },
    ]);
  });
});

describe("buildFileExplorerSearchExpansionPaths", () => {
  it("expands only ancestor directories for file results", () => {
    expect(
      buildFileExplorerSearchExpansionPaths("src/components/file-explorer-pane.tsx", "file"),
    ).toEqual([".", "src", "src/components"]);
  });

  it("includes the directory itself for directory results", () => {
    expect(buildFileExplorerSearchExpansionPaths("src/components", "directory")).toEqual([
      ".",
      "src",
      "src/components",
    ]);
  });
});

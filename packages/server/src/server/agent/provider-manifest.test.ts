import { describe, expect, test } from "vitest";

import { getAgentProviderDefinition } from "./provider-manifest.js";

describe("provider-manifest", () => {
  test("gemini uses ACP-compatible mode ids", () => {
    const gemini = getAgentProviderDefinition("gemini");

    expect(gemini.defaultModeId).toBe("default");
    expect(gemini.modes.map((mode) => mode.id)).toEqual(["default", "autoEdit", "yolo", "plan"]);
  });
});

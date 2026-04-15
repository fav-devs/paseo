import { describe, expect, it } from "vitest";
import type { ProjectActionPayload } from "../shared/messages.js";
import { getWorkspaceCreationProjectAction } from "./project-actions.js";

function buildAction(
  input: Partial<ProjectActionPayload> & Pick<ProjectActionPayload, "id">,
): ProjectActionPayload {
  return {
    id: input.id,
    name: input.name ?? input.id,
    command: input.command ?? `echo ${input.id}`,
    icon: input.icon ?? "play",
    shortcut: input.shortcut ?? null,
    runOnWorkspaceCreate: input.runOnWorkspaceCreate ?? false,
  };
}

describe("getWorkspaceCreationProjectAction", () => {
  it("returns the first action marked for workspace creation", () => {
    const action = getWorkspaceCreationProjectAction([
      buildAction({ id: "test" }),
      buildAction({ id: "setup", runOnWorkspaceCreate: true }),
      buildAction({ id: "later", runOnWorkspaceCreate: true }),
    ]);

    expect(action?.id).toBe("setup");
  });

  it("ignores empty setup commands", () => {
    const action = getWorkspaceCreationProjectAction([
      buildAction({ id: "empty", command: "   ", runOnWorkspaceCreate: true }),
    ]);

    expect(action).toBeNull();
  });
});

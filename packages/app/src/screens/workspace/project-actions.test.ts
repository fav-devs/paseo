import { describe, expect, it } from "vitest";
import type { ProjectActionPayload } from "@server/shared/messages";
import {
  deleteProjectAction,
  getPrimaryProjectAction,
  normalizeProjectActionShortcut,
  resolveProjectActionShortcutMatch,
  upsertProjectActions,
} from "./project-actions";

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

describe("project action helpers", () => {
  it("prefers a non-setup action for the primary header button", () => {
    const primary = getPrimaryProjectAction([
      buildAction({ id: "setup", runOnWorkspaceCreate: true }),
      buildAction({ id: "test" }),
    ]);

    expect(primary?.id).toBe("test");
  });

  it("normalizes shortcut strings to the app shortcut format", () => {
    expect(normalizeProjectActionShortcut("Ctrl+Shift+t")).toBe("Ctrl+Shift+T");
  });

  it("clears the setup flag on other actions when saving a new setup action", () => {
    const nextActions = upsertProjectActions({
      actions: [
        buildAction({ id: "test" }),
        buildAction({ id: "bootstrap", runOnWorkspaceCreate: true }),
      ],
      draft: {
        name: "Configure",
        command: "pnpm install",
        icon: "configure",
        shortcut: "Ctrl+Shift+I",
        runOnWorkspaceCreate: true,
      },
    });

    expect(nextActions.filter((action) => action.runOnWorkspaceCreate)).toHaveLength(1);
    expect(nextActions.find((action) => action.runOnWorkspaceCreate)?.name).toBe("Configure");
  });

  it("matches project actions by their saved shortcuts", () => {
    const matched = resolveProjectActionShortcutMatch({
      actions: [buildAction({ id: "test", shortcut: "Ctrl+Shift+T" })],
      comboString: "Ctrl+Shift+T",
    });

    expect(matched?.id).toBe("test");
  });

  it("removes a deleted action from the persisted list", () => {
    const nextActions = deleteProjectAction(
      [buildAction({ id: "test" }), buildAction({ id: "build" })],
      "test",
    );

    expect(nextActions.map((action) => action.id)).toEqual(["build"]);
  });
});

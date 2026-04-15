import type { ProjectActionPayload } from "../shared/messages.js";

export function getWorkspaceCreationProjectAction(
  actions: readonly ProjectActionPayload[],
): ProjectActionPayload | null {
  for (const action of actions) {
    if (action.runOnWorkspaceCreate && action.command.trim().length > 0) {
      return action;
    }
  }

  return null;
}

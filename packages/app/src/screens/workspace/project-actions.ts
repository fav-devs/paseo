import type { ProjectActionPayload } from "@server/shared/messages";
import { keyComboToString, parseShortcutString } from "../../keyboard/shortcut-string";

export interface ProjectActionDraftInput {
  name: string;
  command: string;
  icon: ProjectActionPayload["icon"];
  shortcut: string | null;
  runOnWorkspaceCreate: boolean;
}

function normalizeProjectActionIdFragment(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "action";
}

function normalizeShortcutToken(token: string): string {
  const trimmedToken = token.trim();
  const lowerToken = trimmedToken.toLowerCase();
  if (lowerToken === "cmd" || lowerToken === "meta") {
    return "Cmd";
  }
  if (lowerToken === "ctrl" || lowerToken === "control") {
    return "Ctrl";
  }
  if (lowerToken === "alt" || lowerToken === "option") {
    return "Alt";
  }
  if (lowerToken === "shift") {
    return "Shift";
  }
  if (lowerToken.length === 1) {
    return lowerToken.toUpperCase();
  }
  if (lowerToken.startsWith("f") && Number.isInteger(Number(lowerToken.slice(1)))) {
    return lowerToken.toUpperCase();
  }
  return `${lowerToken.slice(0, 1).toUpperCase()}${lowerToken.slice(1)}`;
}

export function nextProjectActionId(name: string, existingIds: Iterable<string>): string {
  const taken = new Set(existingIds);
  const baseId = normalizeProjectActionIdFragment(name);
  if (!taken.has(baseId)) {
    return baseId;
  }

  let suffix = 2;
  while (suffix < 10_000) {
    const candidate = `${baseId}-${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
    suffix += 1;
  }

  return `${baseId}-${Date.now()}`;
}

export function normalizeProjectActionShortcut(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }

  const normalizedValue = trimmed.split("+").map(normalizeShortcutToken).join("+");
  return keyComboToString(parseShortcutString(normalizedValue));
}

export function getPrimaryProjectAction(
  actions: readonly ProjectActionPayload[],
): ProjectActionPayload | null {
  const regularAction = actions.find((action) => !action.runOnWorkspaceCreate);
  return regularAction ?? actions[0] ?? null;
}

export function upsertProjectActions(input: {
  actions: readonly ProjectActionPayload[];
  editingActionId?: string | null;
  draft: ProjectActionDraftInput;
}): ProjectActionPayload[] {
  const shortcut = normalizeProjectActionShortcut(input.draft.shortcut);
  const existingIds = input.actions.map((action) => action.id);
  const actionId =
    input.editingActionId ??
    nextProjectActionId(
      input.draft.name,
      existingIds.filter((id) => id !== input.editingActionId),
    );

  const nextAction: ProjectActionPayload = {
    id: actionId,
    name: input.draft.name.trim(),
    command: input.draft.command.trim(),
    icon: input.draft.icon,
    shortcut,
    runOnWorkspaceCreate: input.draft.runOnWorkspaceCreate,
  };

  const nextActions = input.editingActionId
    ? input.actions.map((action) => (action.id === input.editingActionId ? nextAction : action))
    : [...input.actions, nextAction];

  if (!nextAction.runOnWorkspaceCreate) {
    return nextActions;
  }

  return nextActions.map((action) =>
    action.id === nextAction.id ? action : { ...action, runOnWorkspaceCreate: false },
  );
}

export function deleteProjectAction(
  actions: readonly ProjectActionPayload[],
  actionId: string,
): ProjectActionPayload[] {
  return actions.filter((action) => action.id !== actionId);
}

export function resolveProjectActionShortcutMatch(input: {
  actions: readonly ProjectActionPayload[];
  comboString: string | null;
}): ProjectActionPayload | null {
  const normalizedCombo = normalizeProjectActionShortcut(input.comboString);
  if (!normalizedCombo) {
    return null;
  }

  for (const action of input.actions) {
    if (normalizeProjectActionShortcut(action.shortcut) === normalizedCombo) {
      return action;
    }
  }

  return null;
}

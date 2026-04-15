import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import type { ProjectActionPayload } from "@server/shared/messages";
import {
  Bug,
  ChevronDown,
  FlaskConical,
  Hammer,
  ListChecks,
  Play,
  Plus,
  Settings,
  Wrench,
} from "lucide-react-native";
import { AdaptiveModalSheet, AdaptiveTextInput } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { confirmDialog } from "@/utils/confirm-dialog";
import { isNative } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { heldModifiersFromEvent, keyboardEventToComboString } from "@/keyboard/shortcut-string";
import {
  deleteProjectAction,
  getPrimaryProjectAction,
  normalizeProjectActionShortcut,
  upsertProjectActions,
} from "@/screens/workspace/project-actions";

const PROJECT_ACTION_ICONS: Array<{
  id: ProjectActionPayload["icon"];
  label: string;
}> = [
  { id: "play", label: "Play" },
  { id: "test", label: "Test" },
  { id: "lint", label: "Lint" },
  { id: "configure", label: "Configure" },
  { id: "build", label: "Build" },
  { id: "debug", label: "Debug" },
];

function ProjectActionIcon({
  icon,
  color,
  size,
}: {
  icon: ProjectActionPayload["icon"];
  color: string;
  size: number;
}) {
  if (icon === "test") {
    return <FlaskConical size={size} color={color} />;
  }
  if (icon === "lint") {
    return <ListChecks size={size} color={color} />;
  }
  if (icon === "configure") {
    return <Wrench size={size} color={color} />;
  }
  if (icon === "build") {
    return <Hammer size={size} color={color} />;
  }
  if (icon === "debug") {
    return <Bug size={size} color={color} />;
  }
  return <Play size={size} color={color} />;
}

function getActionLabel(action: ProjectActionPayload): string {
  return action.runOnWorkspaceCreate ? `${action.name} (setup)` : action.name;
}

export interface WorkspaceProjectActionsProps {
  serverId: string;
  projectId: string;
  actions: readonly ProjectActionPayload[];
  onRunAction: (action: ProjectActionPayload) => Promise<void> | void;
}

export function WorkspaceProjectActions({
  serverId,
  projectId,
  actions,
  onRunAction,
}: WorkspaceProjectActionsProps) {
  const { theme } = useUnistyles();
  const toast = useToast();
  const isCompact = useIsCompactFormFactor();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const setCapturingShortcut = useKeyboardShortcutsStore((state) => state.setCapturingShortcut);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [icon, setIcon] = useState<ProjectActionPayload["icon"]>("play");
  const [shortcut, setShortcut] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [runOnWorkspaceCreate, setRunOnWorkspaceCreate] = useState(false);
  const [capturingShortcut, setShortcutCaptureOpen] = useState(false);
  const [heldShortcutModifiers, setHeldShortcutModifiers] = useState<string | null>(null);

  const canMutateActions = Boolean(client) && isConnected && projectId.length > 0;
  const primaryAction = useMemo(() => getPrimaryProjectAction(actions), [actions]);
  const isEditing = editingActionId !== null;

  const saveActionsMutation = useMutation({
    mutationFn: async (nextActions: ProjectActionPayload[]) => {
      if (!client) {
        throw new Error("Host is not connected");
      }
      return await client.updateProjectActions(projectId, nextActions);
    },
  });

  const stopShortcutCapture = useCallback(() => {
    setShortcutCaptureOpen(false);
    setHeldShortcutModifiers(null);
    setCapturingShortcut(false);
  }, [setCapturingShortcut]);

  useEffect(() => {
    return () => {
      setCapturingShortcut(false);
    };
  }, [setCapturingShortcut]);

  useEffect(() => {
    if (!capturingShortcut || isNative) {
      return;
    }

    setCapturingShortcut(true);
    function handleKeyDown(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();

      const key = event.key ?? "";
      if (
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        key === "Escape"
      ) {
        stopShortcutCapture();
        return;
      }
      if (
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        (key === "Backspace" || key === "Delete")
      ) {
        setShortcut("");
        return;
      }

      const comboString = keyboardEventToComboString(event);
      if (comboString === null) {
        setHeldShortcutModifiers(heldModifiersFromEvent(event));
        return;
      }
      if (!comboString.includes("+")) {
        setHeldShortcutModifiers(null);
        return;
      }

      try {
        const normalizedShortcut = normalizeProjectActionShortcut(comboString);
        setShortcut(normalizedShortcut ?? "");
        setHeldShortcutModifiers(null);
        setShortcutCaptureOpen(false);
        setCapturingShortcut(false);
      } catch {
        setHeldShortcutModifiers(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      setCapturingShortcut(false);
      setHeldShortcutModifiers(null);
    };
  }, [capturingShortcut, setCapturingShortcut, stopShortcutCapture]);

  const resetDialogState = useCallback(() => {
    setEditingActionId(null);
    setName("");
    setCommand("");
    setIcon("play");
    setShortcut("");
    setRunOnWorkspaceCreate(false);
    setValidationError(null);
    stopShortcutCapture();
  }, [stopShortcutCapture]);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    resetDialogState();
  }, [resetDialogState]);

  const openAddDialog = useCallback(() => {
    resetDialogState();
    setDialogOpen(true);
  }, [resetDialogState]);

  const openEditDialog = useCallback(
    (action: ProjectActionPayload) => {
      setEditingActionId(action.id);
      setName(action.name);
      setCommand(action.command);
      setIcon(action.icon);
      setShortcut(action.shortcut ?? "");
      setRunOnWorkspaceCreate(Boolean(action.runOnWorkspaceCreate));
      setValidationError(null);
      stopShortcutCapture();
      setDialogOpen(true);
    },
    [stopShortcutCapture],
  );

  const handleSave = useCallback(async () => {
    const trimmedName = name.trim();
    const trimmedCommand = command.trim();
    if (trimmedName.length === 0) {
      setValidationError("Name is required.");
      return;
    }
    if (trimmedCommand.length === 0) {
      setValidationError("Command is required.");
      return;
    }

    try {
      const nextActions = upsertProjectActions({
        actions,
        editingActionId,
        draft: {
          name: trimmedName,
          command: trimmedCommand,
          icon,
          shortcut,
          runOnWorkspaceCreate,
        },
      });
      await saveActionsMutation.mutateAsync(nextActions);
      closeDialog();
      toast.show(isEditing ? "Saved action" : "Added action", { variant: "success" });
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Failed to save action.");
    }
  }, [
    actions,
    closeDialog,
    editingActionId,
    icon,
    isEditing,
    name,
    command,
    runOnWorkspaceCreate,
    saveActionsMutation,
    shortcut,
    toast,
  ]);

  const handleDelete = useCallback(async () => {
    if (!editingActionId) {
      return;
    }
    const confirmed = await confirmDialog({
      title: "Delete action?",
      message: `Delete "${name.trim() || "this action"}"? This cannot be undone.`,
      confirmLabel: "Delete action",
      destructive: true,
    });
    if (!confirmed) {
      return;
    }

    try {
      const nextActions = deleteProjectAction(actions, editingActionId);
      await saveActionsMutation.mutateAsync(nextActions);
      closeDialog();
      toast.show("Deleted action", { variant: "success" });
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Failed to delete action.");
    }
  }, [actions, closeDialog, editingActionId, name, saveActionsMutation, toast]);

  const handleRunSelectedAction = useCallback(
    (action: ProjectActionPayload) => {
      void onRunAction(action);
    },
    [onRunAction],
  );

  return (
    <>
      {primaryAction ? (
        <View style={styles.row}>
          <View style={styles.splitButton}>
            <Pressable
              testID="workspace-project-actions-primary"
              disabled={!canMutateActions}
              accessibilityRole="button"
              accessibilityLabel={`Run ${primaryAction.name}`}
              onPress={() => handleRunSelectedAction(primaryAction)}
              style={({ hovered, pressed }) => [
                styles.primaryButton,
                (hovered || pressed) && styles.primaryButtonHovered,
                !canMutateActions && styles.primaryButtonDisabled,
              ]}
            >
              <View style={styles.primaryButtonContent}>
                <ProjectActionIcon
                  icon={primaryAction.icon}
                  size={16}
                  color={theme.colors.foreground}
                />
                {!isCompact ? (
                  <Text style={styles.primaryButtonText} numberOfLines={1}>
                    {primaryAction.name}
                  </Text>
                ) : null}
              </View>
            </Pressable>
            <DropdownMenu>
              <DropdownMenuTrigger
                testID="workspace-project-actions-menu-trigger"
                disabled={!canMutateActions}
                accessibilityRole="button"
                accessibilityLabel="Project actions"
                style={({ hovered, pressed, open }) => [
                  styles.caretButton,
                  (hovered || pressed || open) && styles.caretButtonHovered,
                  !canMutateActions && styles.primaryButtonDisabled,
                ]}
              >
                <ChevronDown size={16} color={theme.colors.foregroundMuted} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" width={260} testID="workspace-project-actions-menu">
                {actions.map((action) => (
                  <DropdownMenuItem
                    key={action.id}
                    testID={`workspace-project-action-run-${action.id}`}
                    leading={
                      <ProjectActionIcon
                        icon={action.icon}
                        size={16}
                        color={theme.colors.foregroundMuted}
                      />
                    }
                    description={action.command}
                    onSelect={() => handleRunSelectedAction(action)}
                  >
                    {getActionLabel(action)}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                {actions.map((action) => (
                  <DropdownMenuItem
                    key={`${action.id}-edit`}
                    testID={`workspace-project-action-edit-${action.id}`}
                    leading={<Settings size={16} color={theme.colors.foregroundMuted} />}
                    onSelect={() => openEditDialog(action)}
                  >
                    Edit {action.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  testID="workspace-project-action-add"
                  leading={<Plus size={16} color={theme.colors.foregroundMuted} />}
                  onSelect={openAddDialog}
                >
                  Add action
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </View>
        </View>
      ) : (
        <Button
          testID="workspace-project-action-add-button"
          variant="outline"
          size="sm"
          onPress={openAddDialog}
          disabled={!canMutateActions}
          leftIcon={(color: string) => <Plus size={16} color={color} />}
          style={styles.addButton}
        >
          {isCompact ? "" : "Add action"}
        </Button>
      )}

      <AdaptiveModalSheet
        title={isEditing ? "Edit Action" : "Add Action"}
        visible={dialogOpen}
        onClose={closeDialog}
        testID="workspace-project-action-dialog"
      >
        <Text style={styles.sheetDescription}>
          Actions are project-scoped commands you can run from the top bar or keybindings.
        </Text>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Name</Text>
          <View style={styles.nameRow}>
            <View style={styles.iconPickerGrid}>
              {PROJECT_ACTION_ICONS.map((entry) => {
                const selected = entry.id === icon;
                return (
                  <Pressable
                    key={entry.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Use ${entry.label} icon`}
                    onPress={() => setIcon(entry.id)}
                    style={({ pressed, hovered }) => [
                      styles.iconButton,
                      selected && styles.iconButtonSelected,
                      (pressed || hovered) && styles.iconButtonPressed,
                    ]}
                  >
                    <ProjectActionIcon
                      icon={entry.id}
                      size={16}
                      color={selected ? theme.colors.foreground : theme.colors.foregroundMuted}
                    />
                    <Text style={styles.iconButtonLabel}>{entry.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <AdaptiveTextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Test"
              placeholderTextColor={theme.colors.foregroundMuted}
              autoFocus
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Keybinding</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Capture action shortcut"
            disabled={isNative}
            onPress={() => {
              if (isNative) {
                return;
              }
              setValidationError(null);
              setHeldShortcutModifiers(null);
              setShortcutCaptureOpen(true);
            }}
            style={({ pressed, hovered }) => [
              styles.shortcutField,
              (hovered || pressed || capturingShortcut) && styles.shortcutFieldActive,
              isNative && styles.shortcutFieldDisabled,
            ]}
          >
            <Text style={shortcut ? styles.shortcutText : styles.shortcutPlaceholder}>
              {capturingShortcut
                ? heldShortcutModifiers
                  ? `${heldShortcutModifiers} + ...`
                  : "Press shortcut"
                : shortcut || "Press shortcut"}
            </Text>
          </Pressable>
          <Text style={styles.helperText}>
            {isNative
              ? "Keyboard shortcuts are only available on desktop."
              : "Press a shortcut. Use Backspace to clear."}
          </Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Command</Text>
          <AdaptiveTextInput
            style={styles.textarea}
            value={command}
            onChangeText={setCommand}
            placeholder="bun test"
            placeholderTextColor={theme.colors.foregroundMuted}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
          />
        </View>

        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: runOnWorkspaceCreate }}
          onPress={() => setRunOnWorkspaceCreate((current) => !current)}
          style={({ pressed, hovered }) => [
            styles.setupRow,
            (pressed || hovered) && styles.setupRowHovered,
          ]}
        >
          <View style={styles.setupTextGroup}>
            <Text style={styles.setupLabel}>Run automatically on worktree creation</Text>
            <Text style={styles.helperText}>
              Only one action can be marked as the setup action.
            </Text>
          </View>
          <View style={[styles.switchTrack, runOnWorkspaceCreate && styles.switchTrackActive]}>
            <View style={[styles.switchThumb, runOnWorkspaceCreate && styles.switchThumbActive]} />
          </View>
        </Pressable>

        {validationError ? <Text style={styles.validationError}>{validationError}</Text> : null}

        <View style={styles.footer}>
          {isEditing ? (
            <Button
              variant="destructive"
              size="sm"
              onPress={() => {
                void handleDelete();
              }}
              disabled={saveActionsMutation.isPending}
            >
              Delete
            </Button>
          ) : (
            <View />
          )}
          <View style={styles.footerActions}>
            <Button
              variant="secondary"
              size="sm"
              onPress={closeDialog}
              disabled={saveActionsMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onPress={() => {
                void handleSave();
              }}
              disabled={saveActionsMutation.isPending}
            >
              {saveActionsMutation.isPending
                ? "Saving..."
                : isEditing
                  ? "Save changes"
                  : "Save action"}
            </Button>
          </View>
        </View>
      </AdaptiveModalSheet>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  splitButton: {
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    overflow: "hidden",
    maxWidth: 220,
  },
  primaryButton: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    justifyContent: "center",
    minHeight: 32,
  },
  primaryButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  primaryButtonDisabled: {
    opacity: theme.opacity[50],
  },
  primaryButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
  primaryButtonText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    flexShrink: 1,
  },
  caretButton: {
    width: 28,
    justifyContent: "center",
    alignItems: "center",
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.borderAccent,
  },
  caretButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  addButton: {
    minHeight: 32,
  },
  sheetDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.5,
  },
  field: {
    gap: theme.spacing[2],
  },
  fieldLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  nameRow: {
    gap: theme.spacing[3],
  },
  iconPickerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  iconButton: {
    width: 84,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    backgroundColor: theme.colors.surface1,
  },
  iconButtonSelected: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.accent,
  },
  iconButtonPressed: {
    opacity: 0.9,
  },
  iconButtonLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
  input: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  textarea: {
    minHeight: 120,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  shortcutField: {
    minHeight: 44,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    paddingHorizontal: theme.spacing[3],
    alignItems: "flex-start",
    justifyContent: "center",
  },
  shortcutFieldActive: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface2,
  },
  shortcutFieldDisabled: {
    opacity: theme.opacity[50],
  },
  shortcutText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  shortcutPlaceholder: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  helperText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs * 1.5,
  },
  setupRow: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  setupRowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  setupTextGroup: {
    flex: 1,
    gap: theme.spacing[1],
  },
  setupLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  switchTrack: {
    width: 38,
    height: 22,
    borderRadius: 999,
    backgroundColor: theme.colors.surface3,
    padding: 2,
    justifyContent: "center",
  },
  switchTrackActive: {
    backgroundColor: theme.colors.accent,
  },
  switchThumb: {
    width: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: theme.colors.foregroundMuted,
  },
  switchThumbActive: {
    transform: [{ translateX: 16 }],
    backgroundColor: theme.colors.accentForeground,
  },
  validationError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingTop: theme.spacing[2],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  footerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));

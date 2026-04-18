import { useState, useCallback, useEffect, useMemo, useRef, memo, type ReactElement } from "react";
import { useRouter } from "expo-router";
import {
  View,
  Text,
  ActivityIndicator,
  Pressable,
  FlatList,
  PanResponder,
  TextInput,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  AlignJustify,
  Archive,
  ChevronDown,
  Columns2,
  Download,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  ListChevronsDownUp,
  ListChevronsUpDown,
  Pilcrow,
  RefreshCcw,
  Upload,
  WrapText,
} from "lucide-react-native";
import { useCheckoutGitActionsStore } from "@/stores/checkout-git-actions-store";
import { useCheckoutDiffQuery, type ParsedDiffFile } from "@/hooks/use-checkout-diff-query";
import { useCheckoutHistoryQuery } from "@/hooks/use-checkout-history-query";
import { useCheckoutStatusQuery } from "@/hooks/use-checkout-status-query";
import { useCheckoutPrStatusQuery } from "@/hooks/use-checkout-pr-status-query";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import { shouldAnchorHeaderBeforeCollapse } from "@/utils/git-diff-scroll";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { GitHubIcon } from "@/components/icons/github-icon";
import { buildGitActions, type GitActions } from "@/components/git-actions-policy";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { buildNewAgentRoute, resolveNewAgentWorkingDir } from "@/utils/new-agent-routing";
import { openExternalUrl } from "@/utils/open-external-url";
import { GitActionsSplitButton } from "@/components/git-actions-split-button";
import {
  ChatReferenceButton,
  GitDiffFileBody,
  type HunkChatActionMode,
} from "@/components/git-diff-file-body";
import { useToast } from "@/contexts/toast-context";
import { insertIntoActiveChatComposer } from "@/utils/active-chat-composer";
import { buildFileChatReference } from "@/utils/chat-reference-token";
import { appendTextTokenToComposer } from "@/utils/composer-text-insert";
import { buildDraftStoreKey, generateDraftId } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { prepareWorkspaceTab } from "@/utils/workspace-navigation";
import { usePanelStore } from "@/stores/panel-store";
import { buildWorkspaceExplorerStateKey } from "@/hooks/use-file-explorer-actions";
import { isWeb, isNative } from "@/constants/platform";

export type { GitActionId, GitAction, GitActions } from "@/components/git-actions-policy";

const GRAPH_HEIGHT_DEFAULT = 220;
const GRAPH_HEIGHT_MIN = 100;
const GRAPH_HEIGHT_MAX = 420;

function openURLInNewTab(url: string): void {
  void openExternalUrl(url);
}

function getPathBasename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function getParentPathLabel(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return "";
  }
  return parts.slice(0, -1).join("/");
}

function getFileStatusLetter(file: ParsedDiffFile): "A" | "D" | "M" {
  if (file.isDeleted) {
    return "D";
  }
  if (file.isNew) {
    return "A";
  }
  return "M";
}

interface DiffFileSectionProps {
  file: ParsedDiffFile;
  isExpanded: boolean;
  onToggle: (path: string) => void;
  onAddFileReference?: (file: ParsedDiffFile) => void;
  onClearArmedLine?: () => void;
  onHeaderHeightChange?: (path: string, height: number) => void;
  testID?: string;
}

const DiffFileHeader = memo(function DiffFileHeader({
  file,
  isExpanded,
  onToggle,
  onAddFileReference,
  onClearArmedLine,
  onHeaderHeightChange,
  testID,
}: DiffFileSectionProps) {
  const statusLetter = getFileStatusLetter(file);
  const fileName = getPathBasename(file.path);
  const parentPathLabel = getParentPathLabel(file.path);
  const layoutYRef = useRef<number | null>(null);
  const pressHandledRef = useRef(false);
  const pressInRef = useRef<{ ts: number; pageX: number; pageY: number } | null>(null);

  const toggleExpanded = useCallback(() => {
    pressHandledRef.current = true;
    onClearArmedLine?.();
    onToggle(file.path);
  }, [file.path, onClearArmedLine, onToggle]);

  return (
    <View
      style={[styles.fileSectionHeaderContainer, isExpanded && styles.fileSectionHeaderExpanded]}
      onLayout={(event) => {
        layoutYRef.current = event.nativeEvent.layout.y;
        onHeaderHeightChange?.(file.path, event.nativeEvent.layout.height);
      }}
      testID={testID}
    >
      <View style={styles.fileHeaderRow}>
        <Pressable
          testID={testID ? `${testID}-toggle` : undefined}
          style={({ pressed }) => [styles.fileHeader, pressed && styles.fileHeaderPressed]}
          // Android: prevent parent pan/scroll gestures from canceling the tap release.
          cancelable={false}
          onPressIn={(event) => {
            pressHandledRef.current = false;
            pressInRef.current = {
              ts: Date.now(),
              pageX: event.nativeEvent.pageX,
              pageY: event.nativeEvent.pageY,
            };
          }}
          onPressOut={(event) => {
            if (
              isNative &&
              !pressHandledRef.current &&
              layoutYRef.current === 0 &&
              pressInRef.current
            ) {
              const durationMs = Date.now() - pressInRef.current.ts;
              const dx = event.nativeEvent.pageX - pressInRef.current.pageX;
              const dy = event.nativeEvent.pageY - pressInRef.current.pageY;
              const distance = Math.hypot(dx, dy);
              // Sticky headers on Android can emit pressIn/pressOut without onPress.
              // Treat short, low-movement interactions as taps.
              if (durationMs <= 500 && distance <= 12) {
                toggleExpanded();
              }
            }
          }}
          onPress={toggleExpanded}
        >
          <View style={styles.fileHeaderLeft}>
            <View
              style={[
                styles.fileStatusBadge,
                statusLetter === "A"
                  ? styles.fileStatusBadgeAdded
                  : statusLetter === "D"
                    ? styles.fileStatusBadgeDeleted
                    : styles.fileStatusBadgeModified,
              ]}
            >
              <Text
                style={[
                  styles.fileStatusBadgeText,
                  statusLetter === "A"
                    ? styles.fileStatusBadgeTextAdded
                    : statusLetter === "D"
                      ? styles.fileStatusBadgeTextDeleted
                      : styles.fileStatusBadgeTextModified,
                ]}
              >
                {statusLetter}
              </Text>
            </View>
            <View style={styles.fileIdentity}>
              <Text style={styles.fileName} numberOfLines={1}>
                {fileName}
              </Text>
              {parentPathLabel ? (
                <Text style={styles.fileDir} numberOfLines={1}>
                  {parentPathLabel}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={styles.fileHeaderRight}>
            {file.isSubmodule ? (
              <>
                {file.submodule?.isDirty ? <Text style={styles.additions}>+dirty</Text> : null}
                <Text style={styles.additions}>
                  +{file.submodule?.newCommit?.slice(0, 7) ?? "?"}
                </Text>
                <Text style={styles.deletions}>
                  -{file.submodule?.oldCommit?.slice(0, 7) ?? "?"}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.additions}>+{file.additions}</Text>
                <Text style={styles.deletions}>-{file.deletions}</Text>
              </>
            )}
          </View>
        </Pressable>
        {onAddFileReference ? (
          <ChatReferenceButton
            accessibilityLabel="Add file to chat"
            tooltipLabel="Add file to chat"
            onPress={() => {
              onClearArmedLine?.();
              onAddFileReference(file);
            }}
            testID={testID ? `${testID}-add-to-chat` : undefined}
          />
        ) : null}
      </View>
    </View>
  );
});

interface GitDiffPaneProps {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
  hideHeaderRow?: boolean;
}

type DiffListItem =
  | { type: "directory"; path: string; name: string; depth: number }
  | { type: "header"; file: ParsedDiffFile; fileIndex: number; isExpanded: boolean; depth: number }
  | { type: "body"; file: ParsedDiffFile; fileIndex: number; depth: number };

function buildTreeItems(input: {
  files: ParsedDiffFile[];
  expandedPaths: Set<string>;
}): DiffListItem[] {
  const emittedDirectories = new Set<string>();
  const items: DiffListItem[] = [];
  const sortedFiles = [...input.files].sort((left, right) => left.path.localeCompare(right.path));

  for (const file of sortedFiles) {
    const fileIndex = input.files.findIndex((entry) => entry.path === file.path);
    const segments = file.path.split("/").filter(Boolean);
    const directorySegments = segments.slice(0, -1);

    directorySegments.forEach((_, index) => {
      const path = directorySegments.slice(0, index + 1).join("/");
      if (emittedDirectories.has(path)) {
        return;
      }
      emittedDirectories.add(path);
      items.push({
        type: "directory",
        path,
        name: directorySegments[index] ?? path,
        depth: index,
      });
    });

    const depth = directorySegments.length;
    const isExpanded = input.expandedPaths.has(file.path);
    items.push({ type: "header", file, fileIndex, isExpanded, depth });
    if (isExpanded) {
      items.push({ type: "body", file, fileIndex, depth });
    }
  }

  return items;
}

export function GitDiffPane({ serverId, workspaceId, cwd, hideHeaderRow }: GitDiffPaneProps) {
  const { theme } = useUnistyles();
  const isMobile = useIsCompactFormFactor();
  const showDesktopWebScrollbar = isWeb && !isMobile;
  const canUseSplitLayout = isWeb && !isMobile;
  const hunkActionMode: HunkChatActionMode = isWeb && !isMobile ? "hover" : "tap-reveal";
  const router = useRouter();
  const toast = useToast();
  const closeToAgent = usePanelStore((state) => state.closeToAgent);
  const [commitMessage, setCommitMessage] = useState("");
  const [graphHeight, setGraphHeight] = useState(GRAPH_HEIGHT_DEFAULT);
  const [diffModeOverride, setDiffModeOverride] = useState<"uncommitted" | "base" | null>(null);
  const [postShipArchiveSuggested, setPostShipArchiveSuggested] = useState(false);
  const [shipDefault, setShipDefault] = useState<"merge" | "pr">("merge");
  const { preferences: changesPreferences, updatePreferences: updateChangesPreferences } =
    useChangesPreferences();
  const wrapLines = changesPreferences.wrapLines;
  const effectiveLayout = canUseSplitLayout ? changesPreferences.layout : "unified";

  const handleToggleWrapLines = useCallback(() => {
    void updateChangesPreferences({ wrapLines: !wrapLines });
  }, [updateChangesPreferences, wrapLines]);

  const handleLayoutChange = useCallback(
    (nextLayout: "unified" | "split") => {
      void updateChangesPreferences({ layout: nextLayout });
    },
    [updateChangesPreferences],
  );

  const handleToggleHideWhitespace = useCallback(() => {
    void updateChangesPreferences({ hideWhitespace: !changesPreferences.hideWhitespace });
  }, [changesPreferences.hideWhitespace, updateChangesPreferences]);

  const handleViewModeChange = useCallback(
    (nextViewMode: "flat" | "tree") => {
      void updateChangesPreferences({ viewMode: nextViewMode });
    },
    [updateChangesPreferences],
  );

  const handleInsertChatReference = useCallback(
    (reference: string) => {
      if (insertIntoActiveChatComposer(reference)) {
        if (isMobile) {
          closeToAgent();
        }
        return;
      }

      const resolvedWorkspaceId = workspaceId?.trim() || cwd.trim();
      if (!resolvedWorkspaceId) {
        toast.error("Open a chat first");
        return;
      }

      const draftId = generateDraftId();
      const draftKey = buildDraftStoreKey({
        serverId,
        agentId: draftId,
        draftId,
      });
      useDraftStore.getState().saveDraftInput({
        draftKey,
        draft: {
          text: appendTextTokenToComposer({ value: "", token: reference }),
          attachments: [],
          cwd: resolvedWorkspaceId,
        },
      });

      const route = prepareWorkspaceTab({
        serverId,
        workspaceId: resolvedWorkspaceId,
        target: { kind: "draft", draftId },
      });
      if (isMobile) {
        closeToAgent();
      }
      router.navigate(route as any);
    },
    [closeToAgent, cwd, isMobile, router, serverId, toast, workspaceId],
  );

  const handleAddFileReference = useCallback(
    (file: ParsedDiffFile) => {
      handleInsertChatReference(buildFileChatReference(file.path));
    },
    [handleInsertChatReference],
  );

  const handleAddHunkReference = useCallback(
    (reference: string) => {
      handleInsertChatReference(reference);
    },
    [handleInsertChatReference],
  );

  const {
    status,
    isLoading: isStatusLoading,
    isFetching: isStatusFetching,
    isError: isStatusError,
    error: statusError,
    refresh: refreshStatus,
  } = useCheckoutStatusQuery({ serverId, cwd });
  const gitStatus = status && status.isGit ? status : null;
  const isGit = Boolean(gitStatus);
  const notGit = status !== null && !status.isGit && !status.error;
  const statusErrorMessage =
    status?.error?.message ??
    (isStatusError && statusError instanceof Error ? statusError.message : null);
  const baseRef = gitStatus?.baseRef ?? undefined;

  // Auto-select diff mode based on state: uncommitted when dirty, base when clean
  const hasUncommittedChanges = Boolean(gitStatus?.isDirty);
  const autoDiffMode = hasUncommittedChanges ? "uncommitted" : "base";
  const diffMode = diffModeOverride ?? autoDiffMode;

  const {
    files,
    payloadError: diffPayloadError,
    isLoading: isDiffLoading,
    isFetching: isDiffFetching,
    isError: isDiffError,
    error: diffError,
    refresh: refreshDiff,
  } = useCheckoutDiffQuery({
    serverId,
    cwd,
    mode: diffMode,
    baseRef,
    ignoreWhitespace: changesPreferences.hideWhitespace,
    enabled: isGit,
  });
  const {
    status: prStatus,
    githubFeaturesEnabled,
    payloadError: prPayloadError,
    refresh: refreshPrStatus,
  } = useCheckoutPrStatusQuery({
    serverId,
    cwd,
    enabled: isGit,
  });
  const {
    history,
    isLoading: isHistoryLoading,
    isError: isHistoryError,
    error: historyError,
    refresh: refreshHistory,
  } = useCheckoutHistoryQuery({
    serverId,
    cwd,
    limit: 20,
    enabled: isGit,
  });
  // Track user-initiated refresh to avoid iOS RefreshControl animation on background fetches
  const [isManualRefresh, setIsManualRefresh] = useState(false);
  const normalizedWorkspaceRoot = useMemo(() => cwd.trim(), [cwd]);
  const workspaceStateKey = useMemo(
    () =>
      buildWorkspaceExplorerStateKey({
        workspaceId,
        workspaceRoot: normalizedWorkspaceRoot,
      }),
    [normalizedWorkspaceRoot, workspaceId],
  );
  const expandedPathsArray = usePanelStore((state) =>
    workspaceStateKey ? state.diffExpandedPathsByWorkspace[workspaceStateKey] : undefined,
  );
  const setDiffExpandedPathsForWorkspace = usePanelStore(
    (state) => state.setDiffExpandedPathsForWorkspace,
  );
  const expandedPaths = useMemo(() => new Set(expandedPathsArray ?? []), [expandedPathsArray]);
  const diffListRef = useRef<FlatList<DiffListItem>>(null);
  const scrollbar = useWebScrollViewScrollbar(diffListRef, {
    enabled: showDesktopWebScrollbar,
  });
  const diffListScrollOffsetRef = useRef(0);
  const diffListViewportHeightRef = useRef(0);
  const headerHeightByPathRef = useRef<Record<string, number>>({});
  const bodyHeightByPathRef = useRef<Record<string, number>>({});
  const defaultHeaderHeightRef = useRef<number>(44);
  const graphHeightRef = useRef(graphHeight);
  const graphResizeStartHeightRef = useRef(graphHeight);

  useEffect(() => {
    graphHeightRef.current = graphHeight;
  }, [graphHeight]);

  const graphResizePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 2,
        onPanResponderGrant: () => {
          graphResizeStartHeightRef.current = graphHeightRef.current;
        },
        onPanResponderMove: (_, gestureState) => {
          const nextHeight = Math.max(
            GRAPH_HEIGHT_MIN,
            Math.min(GRAPH_HEIGHT_MAX, graphResizeStartHeightRef.current + gestureState.dy),
          );
          if (nextHeight !== graphHeightRef.current) {
            graphHeightRef.current = nextHeight;
            setGraphHeight(nextHeight);
          }
        },
      }),
    [],
  );
  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    void refreshDiff();
    void refreshStatus();
    void refreshPrStatus();
    void refreshHistory();
  }, [refreshDiff, refreshHistory, refreshPrStatus, refreshStatus]);

  const shipDefaultStorageKey = useMemo(() => {
    if (!gitStatus?.repoRoot) {
      return null;
    }
    return `@paseo:changes-ship-default:${gitStatus.repoRoot}`;
  }, [gitStatus?.repoRoot]);

  useEffect(() => {
    if (!shipDefaultStorageKey) {
      return;
    }
    let isActive = true;
    AsyncStorage.getItem(shipDefaultStorageKey)
      .then((value) => {
        if (!isActive) return;
        if (value === "pr" || value === "merge") {
          setShipDefault(value);
        }
      })
      .catch(() => undefined);
    return () => {
      isActive = false;
    };
  }, [shipDefaultStorageKey]);

  const persistShipDefault = useCallback(
    async (next: "merge" | "pr") => {
      setShipDefault(next);
      if (!shipDefaultStorageKey) return;
      try {
        await AsyncStorage.setItem(shipDefaultStorageKey, next);
      } catch {
        // Ignore persistence failures; default will reset to "merge".
      }
    },
    [shipDefaultStorageKey],
  );

  const { flatItems, stickyHeaderIndices } = useMemo(() => {
    const items: DiffListItem[] = [];
    const stickyIndices: number[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isExpanded = expandedPaths.has(file.path);
      items.push({ type: "header", file, fileIndex: i, isExpanded, depth: 0 });
      if (isExpanded) {
        stickyIndices.push(items.length - 1);
      }
      if (isExpanded) {
        items.push({ type: "body", file, fileIndex: i, depth: 0 });
      }
    }
    return { flatItems: items, stickyHeaderIndices: stickyIndices };
  }, [expandedPaths, files]);
  const diffItems = useMemo(
    () =>
      changesPreferences.viewMode === "tree" ? buildTreeItems({ files, expandedPaths }) : flatItems,
    [changesPreferences.viewMode, expandedPaths, files, flatItems],
  );

  const handleHeaderHeightChange = useCallback((path: string, height: number) => {
    if (!Number.isFinite(height) || height <= 0) {
      return;
    }
    headerHeightByPathRef.current[path] = height;
    defaultHeaderHeightRef.current = height;
  }, []);

  const handleBodyHeightChange = useCallback((path: string, height: number) => {
    if (!Number.isFinite(height) || height < 0) {
      return;
    }
    bodyHeightByPathRef.current[path] = height;
  }, []);

  const handleDiffListScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      diffListScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
      scrollbar.onScroll(event);
    },
    [scrollbar.onScroll],
  );

  const handleDiffListLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      if (!Number.isFinite(height) || height <= 0) {
        return;
      }
      diffListViewportHeightRef.current = height;
      scrollbar.onLayout(event);
    },
    [scrollbar.onLayout],
  );

  const computeHeaderOffset = useCallback(
    (path: string): number => {
      const defaultHeaderHeight = defaultHeaderHeightRef.current;
      let offset = 0;
      for (const file of files) {
        if (file.path === path) {
          break;
        }
        offset += headerHeightByPathRef.current[file.path] ?? defaultHeaderHeight;
        if (expandedPaths.has(file.path)) {
          offset += bodyHeightByPathRef.current[file.path] ?? 0;
        }
      }
      return Math.max(0, offset);
    },
    [expandedPaths, files],
  );

  const handleToggleExpanded = useCallback(
    (path: string) => {
      if (!workspaceStateKey) {
        return;
      }
      const isCurrentlyExpanded = expandedPaths.has(path);
      const nextExpanded = !isCurrentlyExpanded;
      const targetOffset = isCurrentlyExpanded ? computeHeaderOffset(path) : null;
      const headerHeight = headerHeightByPathRef.current[path] ?? defaultHeaderHeightRef.current;
      const shouldAnchor =
        isCurrentlyExpanded &&
        targetOffset !== null &&
        shouldAnchorHeaderBeforeCollapse({
          headerOffset: targetOffset,
          headerHeight,
          viewportOffset: diffListScrollOffsetRef.current,
          viewportHeight: diffListViewportHeightRef.current,
        });

      // Anchor to the clicked header before collapsing so visual context is preserved.
      if (shouldAnchor && targetOffset !== null) {
        diffListRef.current?.scrollToOffset({
          offset: targetOffset,
          animated: false,
        });
      }

      const nextPaths = nextExpanded
        ? [...expandedPaths, path]
        : Array.from(expandedPaths).filter((expandedPath) => expandedPath !== path);
      setDiffExpandedPathsForWorkspace(workspaceStateKey, nextPaths);
    },
    [computeHeaderOffset, expandedPaths, setDiffExpandedPathsForWorkspace, workspaceStateKey],
  );

  const allExpanded = useMemo(() => {
    if (files.length === 0) return false;
    return files.every((file) => expandedPaths.has(file.path));
  }, [expandedPaths, files]);

  const handleToggleExpandAll = useCallback(() => {
    if (!workspaceStateKey) {
      return;
    }
    if (allExpanded) {
      setDiffExpandedPathsForWorkspace(workspaceStateKey, []);
    } else {
      setDiffExpandedPathsForWorkspace(
        workspaceStateKey,
        files.map((file) => file.path),
      );
    }
  }, [allExpanded, files, setDiffExpandedPathsForWorkspace, workspaceStateKey]);

  // Reset manual refresh flag when fetch completes
  useEffect(() => {
    if (!(isDiffFetching || isStatusFetching) && isManualRefresh) {
      setIsManualRefresh(false);
    }
  }, [isDiffFetching, isStatusFetching, isManualRefresh]);

  // Clear diff mode override when auto mode changes (e.g., after commit)
  useEffect(() => {
    setDiffModeOverride(null);
  }, [autoDiffMode]);

  const commitStatus = useCheckoutGitActionsStore((state) =>
    state.getStatus({ serverId, cwd, actionId: "commit" }),
  );
  const pullStatus = useCheckoutGitActionsStore((state) =>
    state.getStatus({ serverId, cwd, actionId: "pull" }),
  );
  const pushStatus = useCheckoutGitActionsStore((state) =>
    state.getStatus({ serverId, cwd, actionId: "push" }),
  );
  const prCreateStatus = useCheckoutGitActionsStore((state) =>
    state.getStatus({ serverId, cwd, actionId: "create-pr" }),
  );
  const mergeStatus = useCheckoutGitActionsStore((state) =>
    state.getStatus({ serverId, cwd, actionId: "merge-branch" }),
  );
  const mergeFromBaseStatus = useCheckoutGitActionsStore((state) =>
    state.getStatus({ serverId, cwd, actionId: "merge-from-base" }),
  );
  const archiveStatus = useCheckoutGitActionsStore((state) =>
    state.getStatus({ serverId, cwd, actionId: "archive-worktree" }),
  );

  const runCommit = useCheckoutGitActionsStore((state) => state.commit);
  const runPull = useCheckoutGitActionsStore((state) => state.pull);
  const runPush = useCheckoutGitActionsStore((state) => state.push);
  const runCreatePr = useCheckoutGitActionsStore((state) => state.createPr);
  const runMergeBranch = useCheckoutGitActionsStore((state) => state.mergeBranch);
  const runMergeFromBase = useCheckoutGitActionsStore((state) => state.mergeFromBase);
  const runArchiveWorktree = useCheckoutGitActionsStore((state) => state.archiveWorktree);

  const toastActionError = useCallback(
    (error: unknown, fallback: string) => {
      const message = error instanceof Error ? error.message : fallback;
      toast.error(message);
    },
    [toast],
  );

  const toastActionSuccess = useCallback(
    (message: string) => {
      toast.show(message, { variant: "success" });
    },
    [toast],
  );

  const handleCommit = useCallback(() => {
    const trimmedCommitMessage = commitMessage.trim();
    void runCommit({
      serverId,
      cwd,
      message: trimmedCommitMessage || undefined,
    })
      .then(() => {
        setCommitMessage("");
        toastActionSuccess("Committed");
      })
      .catch((err) => {
        toastActionError(err, "Failed to commit");
      });
  }, [commitMessage, cwd, runCommit, serverId, toastActionError, toastActionSuccess]);

  const handlePull = useCallback(() => {
    void runPull({ serverId, cwd })
      .then(() => {
        toastActionSuccess("Pulled");
      })
      .catch((err) => {
        toastActionError(err, "Failed to pull");
      });
  }, [cwd, runPull, serverId, toastActionError, toastActionSuccess]);

  const handlePush = useCallback(() => {
    void runPush({ serverId, cwd })
      .then(() => {
        toastActionSuccess("Pushed");
      })
      .catch((err) => {
        toastActionError(err, "Failed to push");
      });
  }, [cwd, runPush, serverId, toastActionError, toastActionSuccess]);

  const handleCreatePr = useCallback(() => {
    void persistShipDefault("pr");
    void runCreatePr({ serverId, cwd })
      .then(() => {
        toastActionSuccess("PR created");
      })
      .catch((err) => {
        toastActionError(err, "Failed to create PR");
      });
  }, [cwd, persistShipDefault, runCreatePr, serverId, toastActionError, toastActionSuccess]);

  const handleMergeBranch = useCallback(() => {
    if (!baseRef) {
      toast.error("Base ref unavailable");
      return;
    }
    void persistShipDefault("merge");
    void runMergeBranch({ serverId, cwd, baseRef })
      .then(() => {
        setPostShipArchiveSuggested(true);
        toastActionSuccess("Merged");
      })
      .catch((err) => {
        toastActionError(err, "Failed to merge");
      });
  }, [
    baseRef,
    cwd,
    persistShipDefault,
    runMergeBranch,
    serverId,
    toast,
    toastActionError,
    toastActionSuccess,
  ]);

  const handleMergeFromBase = useCallback(() => {
    if (!baseRef) {
      toast.error("Base ref unavailable");
      return;
    }
    void runMergeFromBase({ serverId, cwd, baseRef })
      .then(() => {
        toastActionSuccess("Updated");
      })
      .catch((err) => {
        toastActionError(err, "Failed to merge from base");
      });
  }, [baseRef, cwd, runMergeFromBase, serverId, toast, toastActionError, toastActionSuccess]);

  const handleArchiveWorktree = useCallback(() => {
    const worktreePath = status?.cwd;
    if (!worktreePath) {
      toast.error("Worktree path unavailable");
      return;
    }
    const targetWorkingDir = resolveNewAgentWorkingDir(cwd, status ?? null);
    void runArchiveWorktree({ serverId, cwd, worktreePath })
      .then(() => {
        router.replace(buildNewAgentRoute(serverId, targetWorkingDir));
      })
      .catch((err) => {
        toastActionError(err, "Failed to archive worktree");
      });
  }, [cwd, router, runArchiveWorktree, serverId, status, toast, toastActionError]);

  const renderDiffItem = useCallback(
    ({ item }: { item: DiffListItem }) => {
      if (item.type === "directory") {
        return (
          <View
            style={[
              styles.treeDirectoryRow,
              {
                paddingLeft: theme.spacing[3] + item.depth * theme.spacing[3],
              },
            ]}
          >
            <Text style={styles.treeDirectoryLabel}>{item.name}</Text>
          </View>
        );
      }

      if (item.type === "header") {
        return (
          <View
            style={
              item.depth > 0
                ? {
                    paddingLeft: theme.spacing[3] + item.depth * theme.spacing[3],
                  }
                : undefined
            }
          >
            <DiffFileHeader
              file={item.file}
              isExpanded={item.isExpanded}
              onToggle={handleToggleExpanded}
              onAddFileReference={handleAddFileReference}
              onHeaderHeightChange={handleHeaderHeightChange}
              testID={`diff-file-${item.fileIndex}`}
            />
          </View>
        );
      }
      return (
        <View
          style={
            item.depth > 0
              ? {
                  paddingLeft: theme.spacing[3] + item.depth * theme.spacing[3],
                }
              : undefined
          }
        >
          <GitDiffFileBody
            file={item.file}
            layout={effectiveLayout}
            wrapLines={wrapLines}
            hunkActionMode={hunkActionMode}
            onAddHunkReference={handleAddHunkReference}
            onBodyHeightChange={handleBodyHeightChange}
            testID={`diff-file-${item.fileIndex}-body`}
            cwd={cwd}
            serverId={serverId}
          />
        </View>
      );
    },
    [
      effectiveLayout,
      handleAddFileReference,
      handleAddHunkReference,
      handleBodyHeightChange,
      handleHeaderHeightChange,
      handleToggleExpanded,
      hunkActionMode,
      wrapLines,
      cwd,
      serverId,
      theme.spacing,
    ],
  );

  const diffKeyExtractor = useCallback((item: DiffListItem) => {
    if (item.type === "directory") {
      return `directory-${item.path}`;
    }
    return `${item.type}-${item.file.path}`;
  }, []);

  const hasChanges = files.length > 0;
  const historyEntries = history?.entries ?? [];
  const diffErrorMessage =
    diffPayloadError?.message ??
    (isDiffError && diffError instanceof Error ? diffError.message : null);
  const historyErrorMessage = isHistoryError
    ? historyError instanceof Error
      ? historyError.message
      : "Unable to load history graph."
    : null;
  const prErrorMessage = githubFeaturesEnabled ? (prPayloadError?.message ?? null) : null;
  const branchLabel =
    gitStatus?.currentBranch && gitStatus.currentBranch !== "HEAD"
      ? gitStatus.currentBranch
      : notGit
        ? "Not a git repository"
        : "Unknown";
  const actionsDisabled = !isGit || Boolean(status?.error) || isStatusLoading;
  const aheadCount = gitStatus?.aheadBehind?.ahead ?? 0;
  const behindBaseCount = gitStatus?.aheadBehind?.behind ?? 0;
  const aheadOfOrigin = gitStatus?.aheadOfOrigin ?? 0;
  const behindOfOrigin = gitStatus?.behindOfOrigin ?? 0;
  const repositoryRoot = gitStatus?.repoRoot?.trim() || cwd.trim();
  const repositoryName = getPathBasename(repositoryRoot);
  const baseRefLabel = useMemo(() => {
    if (!baseRef) return "base";
    const trimmed = baseRef.replace(/^refs\/(heads|remotes)\//, "").trim();
    return trimmed.startsWith("origin/") ? trimmed.slice("origin/".length) : trimmed;
  }, [baseRef]);
  const committedDiffDescription = useMemo(() => {
    if (!branchLabel || !baseRefLabel) {
      return undefined;
    }
    return branchLabel === baseRefLabel ? undefined : `${branchLabel} -> ${baseRefLabel}`;
  }, [baseRefLabel, branchLabel]);
  const hasPullRequest = Boolean(prStatus?.url);
  const hasRemote = gitStatus?.hasRemote ?? false;
  const isPaseoOwnedWorktree = gitStatus?.isPaseoOwnedWorktree ?? false;
  const isMergedPullRequest = Boolean(prStatus?.isMerged);
  const currentBranch = gitStatus?.currentBranch;
  const isOnBaseBranch = currentBranch === baseRefLabel;
  const repositorySubtitle = useMemo(() => {
    const relativeWorkspace =
      repositoryRoot !== cwd && cwd.startsWith(`${repositoryRoot}/`)
        ? cwd.slice(repositoryRoot.length + 1)
        : null;
    const parts = [branchLabel];
    if (relativeWorkspace) {
      parts.push(relativeWorkspace);
    }
    if (diffMode === "base" && baseRefLabel && branchLabel !== baseRefLabel) {
      parts.push(`vs ${baseRefLabel}`);
    }
    return parts.filter(Boolean).join(" • ");
  }, [baseRefLabel, branchLabel, cwd, diffMode, repositoryRoot]);
  const changeCountLabel = `${files.length} file${files.length === 1 ? "" : "s"}`;
  const shouldPromoteArchive =
    isPaseoOwnedWorktree &&
    !hasUncommittedChanges &&
    (postShipArchiveSuggested || isMergedPullRequest);

  const commitDisabled = actionsDisabled || commitStatus === "pending";
  const commitBoxDisabled = commitDisabled || !hasUncommittedChanges;
  const pullDisabled = actionsDisabled || pullStatus === "pending";
  const prDisabled = actionsDisabled || prCreateStatus === "pending";
  const mergeDisabled = actionsDisabled || mergeStatus === "pending";
  const mergeFromBaseDisabled = actionsDisabled || mergeFromBaseStatus === "pending";
  const pushDisabled = actionsDisabled || pushStatus === "pending";
  const archiveDisabled = actionsDisabled || archiveStatus === "pending";

  let bodyContent: ReactElement;

  if (isStatusLoading) {
    bodyContent = (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.foregroundMuted} />
        <Text style={styles.loadingText}>Checking repository...</Text>
      </View>
    );
  } else if (statusErrorMessage) {
    bodyContent = (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{statusErrorMessage}</Text>
      </View>
    );
  } else if (notGit) {
    bodyContent = (
      <View style={styles.emptyContainer} testID="changes-not-git">
        <Text style={styles.emptyText}>Not a git repository</Text>
      </View>
    );
  } else if (isDiffLoading) {
    bodyContent = (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.foregroundMuted} />
      </View>
    );
  } else if (diffErrorMessage) {
    bodyContent = (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{diffErrorMessage}</Text>
      </View>
    );
  } else if (!hasChanges) {
    bodyContent = (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          {changesPreferences.hideWhitespace
            ? "No visible changes after hiding whitespace"
            : diffMode === "uncommitted"
              ? "No uncommitted changes"
              : `No changes vs ${baseRefLabel}`}
        </Text>
      </View>
    );
  } else {
    bodyContent = (
      <FlatList
        ref={diffListRef}
        data={diffItems}
        renderItem={renderDiffItem}
        keyExtractor={diffKeyExtractor}
        stickyHeaderIndices={
          changesPreferences.viewMode === "flat" ? stickyHeaderIndices : undefined
        }
        extraData={{
          expandedPathsArray,
          effectiveLayout,
          viewMode: changesPreferences.viewMode,
          wrapLines,
        }}
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        testID="git-diff-scroll"
        onLayout={handleDiffListLayout}
        onScroll={handleDiffListScroll}
        onContentSizeChange={scrollbar.onContentSizeChange}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={!showDesktopWebScrollbar}
        onRefresh={handleRefresh}
        refreshing={isManualRefresh && isDiffFetching}
        // Mixed-height rows (header + potentially very large body) are prone to clipping artifacts.
        // Keep a larger render window and disable clipping to avoid bodies disappearing mid-scroll.
        removeClippedSubviews={changesPreferences.viewMode === "flat" ? false : undefined}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={10}
      />
    );
  }

  useEffect(() => {
    setPostShipArchiveSuggested(false);
  }, [cwd]);

  useEffect(() => {
    if (!hasUncommittedChanges) {
      setCommitMessage("");
    }
  }, [hasUncommittedChanges]);

  // ==========================================================================
  // Git Actions (Data-Oriented)
  // ==========================================================================
  // All possible actions are computed as data, then partitioned into:
  // - primary: The main CTA button
  // - secondary: Dropdown next to primary button
  // - menu: Kebab overflow menu
  // ==========================================================================

  const gitActions: GitActions = useMemo(() => {
    return buildGitActions({
      isGit,
      githubFeaturesEnabled,
      hasPullRequest,
      pullRequestUrl: prStatus?.url ?? null,
      hasRemote,
      isPaseoOwnedWorktree,
      isOnBaseBranch,
      hasUncommittedChanges,
      baseRefAvailable: Boolean(baseRef),
      baseRefLabel,
      aheadCount,
      behindBaseCount,
      aheadOfOrigin,
      behindOfOrigin,
      shouldPromoteArchive,
      shipDefault,
      runtime: {
        commit: {
          disabled: commitDisabled,
          status: commitStatus,
          icon: <GitCommitHorizontal size={16} color={theme.colors.foregroundMuted} />,
          handler: handleCommit,
        },
        pull: {
          disabled: pullDisabled,
          status: pullStatus,
          icon: <Download size={16} color={theme.colors.foregroundMuted} />,
          handler: handlePull,
        },
        push: {
          disabled: pushDisabled,
          status: pushStatus,
          icon: <Upload size={16} color={theme.colors.foregroundMuted} />,
          handler: handlePush,
        },
        pr: {
          disabled: prDisabled,
          status: hasPullRequest ? "idle" : prCreateStatus,
          icon: <GitHubIcon size={16} color={theme.colors.foregroundMuted} />,
          handler: () => {
            if (prStatus?.url) {
              openURLInNewTab(prStatus.url);
              return;
            }
            handleCreatePr();
          },
        },
        "merge-branch": {
          disabled: mergeDisabled,
          status: mergeStatus,
          icon: <GitMerge size={16} color={theme.colors.foregroundMuted} />,
          handler: handleMergeBranch,
        },
        "merge-from-base": {
          disabled: mergeFromBaseDisabled,
          status: mergeFromBaseStatus,
          icon: <RefreshCcw size={16} color={theme.colors.foregroundMuted} />,
          handler: handleMergeFromBase,
        },
        "archive-worktree": {
          disabled: archiveDisabled,
          status: archiveStatus,
          icon: <Archive size={16} color={theme.colors.foregroundMuted} />,
          handler: handleArchiveWorktree,
        },
      },
    });
  }, [
    isGit,
    hasRemote,
    hasPullRequest,
    prStatus?.url,
    aheadCount,
    behindBaseCount,
    isPaseoOwnedWorktree,
    isOnBaseBranch,
    githubFeaturesEnabled,
    hasUncommittedChanges,
    aheadOfOrigin,
    behindOfOrigin,
    shipDefault,
    baseRefLabel,
    shouldPromoteArchive,
    commitDisabled,
    pullDisabled,
    pushDisabled,
    prDisabled,
    mergeDisabled,
    mergeFromBaseDisabled,
    archiveDisabled,
    commitStatus,
    pullStatus,
    pushStatus,
    prCreateStatus,
    mergeStatus,
    mergeFromBaseStatus,
    archiveStatus,
    handleCommit,
    handlePull,
    handlePush,
    handleCreatePr,
    handleMergeBranch,
    handleMergeFromBase,
    handleArchiveWorktree,
    theme.colors.foregroundMuted,
  ]);

  // Helper to get display label based on status

  return (
    <View style={styles.container}>
      {!hideHeaderRow ? (
        <View style={styles.header} testID="changes-header">
          <View style={styles.headerLeft}>
            <GitBranch size={16} color={theme.colors.foregroundMuted} />
            <Text style={styles.branchLabel} testID="changes-branch" numberOfLines={1}>
              {branchLabel}
            </Text>
          </View>
          {isGit ? <GitActionsSplitButton gitActions={gitActions} /> : null}
        </View>
      ) : null}

      {isGit ? (
        <View style={styles.repositorySection}>
          <View style={styles.repositorySectionHeader}>
            <View style={styles.repositoryMetaBlock}>
              <Text style={styles.sectionEyebrow}>Repository</Text>
              <View style={styles.repositoryTitleRow}>
                <GitBranch size={14} color={theme.colors.foregroundMuted} />
                <Text style={styles.repositoryName} numberOfLines={1}>
                  {repositoryName}
                </Text>
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{changeCountLabel}</Text>
                </View>
              </View>
              <Text style={styles.repositorySubtitle} numberOfLines={1}>
                {repositorySubtitle}
              </Text>
            </View>
          </View>

          <View style={styles.commitComposer}>
            <TextInput
              accessibilityLabel="Commit message"
              testID="changes-commit-message-input"
              value={commitMessage}
              onChangeText={setCommitMessage}
              placeholder="Message (leave blank to auto-generate)"
              placeholderTextColor={theme.colors.foregroundMuted}
              editable={!commitBoxDisabled}
              multiline
              numberOfLines={2}
              style={[
                styles.commitInput,
                commitBoxDisabled && styles.commitInputDisabled,
                !isMobile && styles.commitInputDesktop,
              ]}
            />
            <Button
              testID="changes-commit-button"
              size="sm"
              variant="default"
              disabled={commitBoxDisabled}
              onPress={handleCommit}
            >
              Commit
            </Button>
          </View>

          <View style={styles.diffStatusContainer}>
            <View style={styles.diffSectionHeader}>
              <View style={styles.diffSectionTitleGroup}>
                <Text style={styles.sectionEyebrow}>Changes</Text>
                <View style={styles.diffSectionNameRow}>
                  <Text style={styles.diffSectionTitle}>Working tree</Text>
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{files.length}</Text>
                  </View>
                </View>
              </View>
              <GitActionsSplitButton gitActions={gitActions} />
            </View>
            <View style={styles.diffStatusInner}>
              <DropdownMenu>
                <DropdownMenuTrigger
                  style={({ hovered, pressed, open }) => [
                    styles.diffModeTrigger,
                    hovered && styles.diffModeTriggerHovered,
                    (pressed || open) && styles.diffModeTriggerPressed,
                  ]}
                  testID="changes-diff-status"
                  accessibilityRole="button"
                  accessibilityLabel="Diff mode"
                >
                  <Text style={styles.diffStatusText} numberOfLines={1}>
                    {diffMode === "uncommitted" ? "Uncommitted" : "Committed"}
                  </Text>
                  <ChevronDown size={12} color={theme.colors.foregroundMuted} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" width={260} testID="changes-diff-status-menu">
                  <DropdownMenuItem
                    testID="changes-diff-mode-uncommitted"
                    selected={diffMode === "uncommitted"}
                    onSelect={() => setDiffModeOverride("uncommitted")}
                  >
                    Uncommitted
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    testID="changes-diff-mode-committed"
                    selected={diffMode === "base"}
                    description={committedDiffDescription}
                    onSelect={() => setDiffModeOverride("base")}
                  >
                    Committed
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <View style={styles.diffStatusButtons}>
                {files.length > 0 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      style={({ hovered, pressed, open }) => [
                        styles.diffModeTrigger,
                        hovered && styles.diffModeTriggerHovered,
                        (pressed || open) && styles.diffModeTriggerPressed,
                      ]}
                      testID="changes-view-mode"
                      accessibilityRole="button"
                      accessibilityLabel="View mode"
                    >
                      <Text style={styles.diffStatusText} numberOfLines={1}>
                        {changesPreferences.viewMode === "tree" ? "Tree" : "Flat"}
                      </Text>
                      <ChevronDown size={12} color={theme.colors.foregroundMuted} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" width={180} testID="changes-view-mode-menu">
                      <DropdownMenuItem
                        testID="changes-view-mode-flat"
                        selected={changesPreferences.viewMode === "flat"}
                        onSelect={() => handleViewModeChange("flat")}
                      >
                        Flat
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        testID="changes-view-mode-tree"
                        selected={changesPreferences.viewMode === "tree"}
                        onSelect={() => handleViewModeChange("tree")}
                      >
                        Tree
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                {canUseSplitLayout ? (
                  <View style={styles.toggleButtonGroup}>
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Unified diff"
                          testID="changes-layout-unified"
                          onPress={() => handleLayoutChange("unified")}
                          style={({ hovered, pressed }) => [
                            styles.toggleButton,
                            styles.toggleButtonGroupStart,
                            changesPreferences.layout === "unified" && styles.toggleButtonSelected,
                            (hovered || pressed) && styles.diffStatusRowHovered,
                          ]}
                        >
                          <AlignJustify
                            size={14}
                            color={
                              changesPreferences.layout === "unified"
                                ? theme.colors.foreground
                                : theme.colors.foregroundMuted
                            }
                          />
                        </Pressable>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <Text style={styles.tooltipText}>Unified diff</Text>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Side-by-side diff"
                          testID="changes-layout-split"
                          onPress={() => handleLayoutChange("split")}
                          style={({ hovered, pressed }) => [
                            styles.toggleButton,
                            styles.toggleButtonGroupEnd,
                            changesPreferences.layout === "split" && styles.toggleButtonSelected,
                            (hovered || pressed) && styles.diffStatusRowHovered,
                          ]}
                        >
                          <Columns2
                            size={14}
                            color={
                              changesPreferences.layout === "split"
                                ? theme.colors.foreground
                                : theme.colors.foregroundMuted
                            }
                          />
                        </Pressable>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <Text style={styles.tooltipText}>Side-by-side diff</Text>
                      </TooltipContent>
                    </Tooltip>
                  </View>
                ) : null}
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Hide whitespace"
                      testID="changes-toggle-whitespace"
                      style={({ hovered, pressed }) => [
                        styles.expandAllButton,
                        changesPreferences.hideWhitespace && styles.toggleButtonSelected,
                        (hovered || pressed) && styles.diffStatusRowHovered,
                      ]}
                      onPress={handleToggleHideWhitespace}
                    >
                      <Pilcrow
                        size={isMobile ? 18 : 14}
                        color={
                          changesPreferences.hideWhitespace
                            ? theme.colors.foreground
                            : theme.colors.foregroundMuted
                        }
                      />
                    </Pressable>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <Text style={styles.tooltipText}>Hide whitespace</Text>
                  </TooltipContent>
                </Tooltip>
                {files.length > 0 ? (
                  <View style={styles.diffStatusButtons}>
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <Pressable
                          style={({ hovered, pressed }) => [
                            styles.expandAllButton,
                            wrapLines && styles.toggleButtonSelected,
                            (hovered || pressed) && styles.diffStatusRowHovered,
                          ]}
                          onPress={handleToggleWrapLines}
                        >
                          <WrapText
                            size={isMobile ? 18 : 14}
                            color={
                              wrapLines ? theme.colors.foreground : theme.colors.foregroundMuted
                            }
                          />
                        </Pressable>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <Text style={styles.tooltipText}>
                          {wrapLines ? "Scroll long lines" : "Wrap long lines"}
                        </Text>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <Pressable
                          style={({ hovered, pressed }) => [
                            styles.expandAllButton,
                            (hovered || pressed) && styles.diffStatusRowHovered,
                          ]}
                          onPress={handleToggleExpandAll}
                        >
                          {allExpanded ? (
                            <ListChevronsDownUp
                              size={isMobile ? 18 : 14}
                              color={theme.colors.foregroundMuted}
                            />
                          ) : (
                            <ListChevronsUpDown
                              size={isMobile ? 18 : 14}
                              color={theme.colors.foregroundMuted}
                            />
                          )}
                        </Pressable>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <Text style={styles.tooltipText}>
                          {allExpanded ? "Collapse all files" : "Expand all files"}
                        </Text>
                      </TooltipContent>
                    </Tooltip>
                  </View>
                ) : null}
              </View>
            </View>
          </View>

          <View style={styles.graphSection}>
            <View style={styles.graphSectionHeader}>
              <View style={styles.diffSectionTitleGroup}>
                <Text style={styles.sectionEyebrow}>Graph</Text>
                <View style={styles.diffSectionNameRow}>
                  <Text style={styles.diffSectionTitle}>Recent commits</Text>
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{historyEntries.length}</Text>
                  </View>
                </View>
              </View>
            </View>

            {isHistoryLoading ? (
              <Text style={styles.graphMessage}>Loading history…</Text>
            ) : historyErrorMessage ? (
              <Text style={styles.graphErrorText}>{historyErrorMessage}</Text>
            ) : historyEntries.length === 0 ? (
              <Text style={styles.graphMessage}>No commit history yet.</Text>
            ) : (
              <View style={styles.graphListContainer}>
                <FlatList
                  data={historyEntries}
                  keyExtractor={(entry) => entry.hash}
                  style={[styles.graphList, { height: graphHeight }]}
                  nestedScrollEnabled
                  initialNumToRender={8}
                  maxToRenderPerBatch={10}
                  windowSize={5}
                  renderItem={({ item: entry }) => (
                    <View style={styles.graphRow}>
                      <Text style={styles.graphAscii}>{entry.graph || "*"}</Text>
                      <View style={styles.graphContent}>
                        <View style={styles.graphSubjectRow}>
                          <Text style={styles.graphSubject} numberOfLines={1}>
                            {entry.subject}
                          </Text>
                          <Text style={styles.graphMetaMuted}>{entry.shortHash}</Text>
                        </View>
                        <Text style={styles.graphMetaText} numberOfLines={1}>
                          {entry.authorName} • {entry.authoredRelative}
                        </Text>
                        {entry.refs.length > 0 ? (
                          <View style={styles.graphRefsRow}>
                            {entry.refs.slice(0, 3).map((ref) => (
                              <View key={`${entry.hash}-${ref}`} style={styles.graphRefBadge}>
                                <Text style={styles.graphRefText} numberOfLines={1}>
                                  {ref}
                                </Text>
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    </View>
                  )}
                />
                {!isMobile ? (
                  <View
                    style={[
                      styles.graphResizeHandleTouch,
                      isWeb && ({ cursor: "row-resize" } as any),
                    ]}
                    {...graphResizePanResponder.panHandlers}
                  >
                    <View style={styles.graphResizeHandle} />
                  </View>
                ) : null}
              </View>
            )}
          </View>
        </View>
      ) : null}

      {prErrorMessage ? <Text style={styles.actionErrorText}>{prErrorMessage}</Text> : null}

      <View style={styles.diffContainer}>
        {bodyContent}
        {hasChanges ? scrollbar.overlay : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
    minWidth: 0,
  },
  branchLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
    flexShrink: 1,
  },
  sectionEyebrow: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  repositorySection: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  repositorySectionHeader: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
  },
  repositoryMetaBlock: {
    gap: theme.spacing[1],
  },
  repositoryTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  repositoryName: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  countBadge: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
  },
  countBadgeText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.medium,
  },
  repositorySubtitle: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  diffStatusContainer: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
  },
  diffSectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  diffSectionTitleGroup: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  diffSectionNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  diffSectionTitle: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  diffStatusInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  diffModeTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
    height: {
      xs: 28,
      sm: 28,
      md: 24,
    },
    borderRadius: theme.borderRadius.base,
    flexShrink: 0,
  },
  diffModeTriggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  diffModeTriggerPressed: {
    backgroundColor: theme.colors.surface2,
  },
  diffStatusRowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  diffStatusText: {
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs * 1.25,
    color: theme.colors.foregroundMuted,
  },
  diffStatusIconHidden: {
    opacity: 0,
  },
  diffStatusButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexWrap: "wrap",
  },
  toggleButtonGroup: {
    flexDirection: "row",
    alignItems: "center",
  },
  toggleButton: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: {
      xs: 32,
      sm: 32,
      md: 24,
    },
    height: {
      xs: 32,
      sm: 32,
      md: 24,
    },
    paddingHorizontal: {
      xs: theme.spacing[2],
      sm: theme.spacing[2],
      md: theme.spacing[1],
    },
  },
  toggleButtonGroupStart: {
    borderTopLeftRadius: theme.borderRadius.base,
    borderBottomLeftRadius: theme.borderRadius.base,
  },
  toggleButtonGroupEnd: {
    borderTopRightRadius: theme.borderRadius.base,
    borderBottomRightRadius: theme.borderRadius.base,
  },
  toggleButtonSelected: {
    backgroundColor: theme.colors.surface2,
  },
  expandAllButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    minWidth: {
      xs: 32,
      sm: 32,
      md: 24,
    },
    height: {
      xs: 32,
      sm: 32,
      md: 24,
    },
    paddingHorizontal: {
      xs: theme.spacing[2],
      sm: theme.spacing[2],
      md: theme.spacing[1],
    },
    borderRadius: theme.borderRadius.base,
    flexShrink: 0,
  },
  actionErrorText: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[1],
    fontSize: theme.fontSize.xs,
    color: theme.colors.destructive,
  },
  commitComposer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[2],
    paddingTop: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  commitInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 88,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textAlignVertical: "top",
  },
  commitInputDesktop: {
    minHeight: 36,
  },
  commitInputDisabled: {
    opacity: 0.6,
  },
  graphSection: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[3],
    gap: theme.spacing[2],
  },
  graphSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  graphListContainer: {
    gap: theme.spacing[1],
  },
  graphList: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
    backgroundColor: theme.colors.background,
  },
  graphResizeHandleTouch: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[1],
  },
  graphResizeHandle: {
    width: 56,
    height: 4,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.border,
  },
  graphRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  graphAscii: {
    width: 44,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    fontFamily: "monospace",
  },
  graphContent: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  graphSubjectRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  graphSubject: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  graphMetaText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  graphMetaMuted: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    flexShrink: 0,
  },
  graphRefsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexWrap: "wrap",
  },
  graphRefBadge: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
  },
  graphRefText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  graphMessage: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  graphErrorText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.destructive,
  },
  diffContainer: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: theme.spacing[8],
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: theme.spacing[16],
    gap: theme.spacing[4],
  },
  loadingText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: theme.spacing[16],
    paddingHorizontal: theme.spacing[6],
  },
  errorText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.destructive,
    textAlign: "center",
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: theme.spacing[16],
  },
  emptyText: {
    fontSize: theme.fontSize.lg,
    color: theme.colors.foregroundMuted,
  },
  fileSection: {
    overflow: "hidden",
    backgroundColor: theme.colors.surface2,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  fileSectionHeaderContainer: {
    overflow: "hidden",
  },
  treeDirectoryRow: {
    paddingRight: theme.spacing[2],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  treeDirectoryLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  fileSectionHeaderExpanded: {
    backgroundColor: theme.colors.surface1,
  },
  fileSectionBodyContainer: {
    overflow: "hidden",
    backgroundColor: theme.colors.surface2,
  },
  fileSectionBorder: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  fileHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    zIndex: 2,
    elevation: 2,
  },
  fileHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[1],
    flex: 1,
    minWidth: 0,
  },
  fileHeaderPressed: {
    opacity: 0.7,
  },
  fileHeaderLeft: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    flex: 1,
    minWidth: 0,
  },
  fileIdentity: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  fileHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  fileName: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
    flexShrink: 1,
  },
  fileDir: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
  },
  fileStatusBadge: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    flexShrink: 0,
  },
  fileStatusBadgeAdded: {
    backgroundColor: "rgba(46, 160, 67, 0.16)",
  },
  fileStatusBadgeDeleted: {
    backgroundColor: "rgba(248, 81, 73, 0.16)",
  },
  fileStatusBadgeModified: {
    backgroundColor: "rgba(63, 185, 80, 0.12)",
  },
  fileStatusBadgeText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  fileStatusBadgeTextAdded: {
    color: theme.colors.diffAddition,
  },
  fileStatusBadgeTextDeleted: {
    color: theme.colors.diffDeletion,
  },
  fileStatusBadgeTextModified: {
    color: theme.colors.accent,
  },
  additions: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.diffAddition,
  },
  deletions: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.diffDeletion,
  },
  submoduleBody: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  submoduleLogSummary: (t: typeof theme) => ({
    fontSize: t.fontSize.xs,
    color: t.colors.foregroundMuted,
    lineHeight: t.fontSize.xs * 1.5,
  }),
  nestedDiffList: {
    marginTop: theme.spacing[2],
    borderRadius: theme.borderRadius.base,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  nestedDiffLoading: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  nestedDiffEmpty: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  nestedDiffEmptyText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  diffContent: {
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  diffContentRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  diffContentInner: {
    flexDirection: "column",
  },
  linesContainer: {
    backgroundColor: theme.colors.surface1,
  },
  splitLinesContainer: {
    backgroundColor: theme.colors.surface1,
    minWidth: 760,
  },
  gutterColumn: {
    backgroundColor: theme.colors.surface1,
  },
  gutterCell: {
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
    justifyContent: "flex-start",
  },
  textLineContainer: {
    flexDirection: "row",
    alignItems: "stretch",
    paddingLeft: theme.spacing[2],
  },
  splitRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  splitColumnScroll: {
    flex: 1,
  },
  tooltipText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.foreground,
  },
}));

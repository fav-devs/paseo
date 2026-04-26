import { useCallback, useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { AutocompleteOption } from "@/components/ui/autocomplete";
import { useAgentCommandsQuery, type DraftCommandConfig } from "./use-agent-commands-query";
import { orderAutocompleteOptions } from "@/components/ui/autocomplete-utils";
import { useAutocomplete } from "./use-autocomplete";
import { useSessionStore } from "@/stores/session-store";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import {
  applyEnvMentionReplacement,
  applyFileMentionReplacement,
  findActiveEnvMention,
  findActiveFileMention,
  type EnvMentionRange,
  type FileMentionRange,
} from "@/utils/file-mention-autocomplete";

interface UseAgentAutocompleteInput {
  userInput: string;
  cursorIndex: number;
  setUserInput: (nextValue: string) => void;
  serverId: string;
  agentId: string;
  draftConfig?: DraftCommandConfig;
  onAutocompleteApplied?: () => void;
}

type AgentAutocompleteOption =
  | (AutocompleteOption & { type: "command" })
  | (AutocompleteOption & {
      type: "workspace_entry";
      entryPath: string;
      mention: FileMentionRange;
    })
  | (AutocompleteOption & {
      type: "env_alias";
      alias: string;
      mention: EnvMentionRange;
    });

interface AgentAutocompleteResult {
  isVisible: boolean;
  options: AutocompleteOption[];
  selectedIndex: number;
  isLoading: boolean;
  errorMessage?: string;
  loadingText: string;
  emptyText: string;
  onSelectOption: (option: AutocompleteOption) => void;
  onKeyPress: (event: { key: string; preventDefault: () => void }) => boolean;
}

interface DirectorySuggestionEntry {
  path: string;
  kind: "file" | "directory";
}

function normalizeDraftCommandConfig(
  draftConfig?: DraftCommandConfig,
): DraftCommandConfig | undefined {
  if (!draftConfig) {
    return undefined;
  }

  const cwd = draftConfig.cwd.trim();
  if (!cwd) {
    return undefined;
  }

  const modeId = draftConfig.modeId?.trim() ?? "";
  const model = draftConfig.model?.trim() ?? "";
  const thinkingOptionId = draftConfig.thinkingOptionId?.trim() ?? "";
  const featureValues = draftConfig.featureValues;
  return {
    provider: draftConfig.provider,
    cwd,
    ...(modeId ? { modeId } : {}),
    ...(model ? { model } : {}),
    ...(thinkingOptionId ? { thinkingOptionId } : {}),
    ...(featureValues && Object.keys(featureValues).length > 0 ? { featureValues } : {}),
  };
}

function mapDirectorySuggestionsToEntries(payload: {
  entries?: Array<{ path: string; kind: string }>;
  directories?: string[];
}): DirectorySuggestionEntry[] {
  if (Array.isArray(payload.entries) && payload.entries.length > 0) {
    return payload.entries.flatMap((entry) => {
      if (
        !entry ||
        typeof entry.path !== "string" ||
        (entry.kind !== "file" && entry.kind !== "directory")
      ) {
        return [];
      }
      return [{ path: entry.path, kind: entry.kind }];
    });
  }

  return (payload.directories ?? []).map((path) => ({
    path,
    kind: "directory" as const,
  }));
}

type AutocompleteMode = "command" | "file" | null;

function resolveAutocompleteMode(args: {
  showFileAutocomplete: boolean;
  showCommandAutocomplete: boolean;
}): AutocompleteMode {
  if (args.showFileAutocomplete) {
    return "file";
  }
  if (args.showCommandAutocomplete) {
    return "command";
  }
  return null;
}

function resolveAutocompleteIsVisible(args: {
  mode: AutocompleteMode;
  canLoadCommands: boolean;
  serverId: string;
  autocompleteCwd: string;
}): boolean {
  if (args.mode === "command") {
    return args.canLoadCommands;
  }
  if (args.mode === "file") {
    return Boolean(args.serverId) && args.autocompleteCwd.length > 0;
  }
  return false;
}

function resolveAutocompleteIsLoading(args: {
  mode: AutocompleteMode;
  isCommandsLoading: boolean;
  fileSuggestionsIsPending: boolean;
  fileSuggestionsIsLoading: boolean;
  optionsLength: number;
}): boolean {
  if (args.mode === "command") {
    return args.isCommandsLoading;
  }
  if (args.mode === "file") {
    return (
      args.fileSuggestionsIsPending || (args.fileSuggestionsIsLoading && args.optionsLength === 0)
    );
  }
  return false;
}

function resolveAutocompleteErrorMessage(args: {
  mode: AutocompleteMode;
  isCommandError: boolean;
  commandError: Error | null;
  fileSuggestionsError: unknown;
}): string | undefined {
  if (args.mode === "command") {
    return args.isCommandError ? (args.commandError?.message ?? "Failed to load") : undefined;
  }
  if (args.mode === "file") {
    return args.fileSuggestionsError instanceof Error
      ? args.fileSuggestionsError.message
      : undefined;
  }
  return undefined;
}

export function useAgentAutocomplete(input: UseAgentAutocompleteInput): AgentAutocompleteResult {
  const {
    userInput,
    cursorIndex,
    setUserInput,
    serverId,
    agentId,
    draftConfig,
    onAutocompleteApplied,
  } = input;

  const showCommandAutocomplete = userInput.startsWith("/") && !userInput.includes(" ");
  const commandFilterQuery = showCommandAutocomplete ? userInput.slice(1) : "";

  const activeEnvMention = useMemo(
    () =>
      findActiveEnvMention({
        text: userInput,
        cursorIndex,
      }),
    [cursorIndex, userInput],
  );
  const activeFileMention = useMemo(() => {
    if (activeEnvMention) {
      return null;
    }
    return findActiveFileMention({
      text: userInput,
      cursorIndex,
    });
  }, [activeEnvMention, cursorIndex, userInput]);
  const showFileAutocomplete = activeFileMention !== null;
  const fileFilterQuery = activeFileMention?.query ?? "";
  const envFilterQuery = useMemo(() => {
    const raw = activeEnvMention?.query ?? "";
    if (raw.startsWith("env:")) {
      return raw.slice("env:".length);
    }
    if (raw.startsWith("secret:")) {
      return raw.slice("secret:".length);
    }
    return "";
  }, [activeEnvMention]);

  const normalizedDraftConfig = useMemo(
    () => normalizeDraftCommandConfig(draftConfig),
    [draftConfig],
  );

  const isDraftContext = normalizedDraftConfig !== undefined;
  const queryDraftConfig = isDraftContext ? normalizedDraftConfig : undefined;
  const canLoadCommands = Boolean(serverId) && (Boolean(agentId) || isDraftContext);

  const agentCwd = useSessionStore(
    (state) => state.sessions[serverId]?.agents?.get(agentId)?.cwd ?? "",
  );
  const autocompleteCwd = useMemo(() => {
    if (isDraftContext) {
      return queryDraftConfig?.cwd ?? "";
    }
    return agentCwd.trim();
  }, [agentCwd, isDraftContext, queryDraftConfig]);

  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  const showEnvAutocomplete = activeEnvMention !== null;
  const mode: "command" | "file" | "env" | null = showEnvAutocomplete
    ? "env"
    : showFileAutocomplete
      ? "file"
      : showCommandAutocomplete
        ? "command"
        : null;
  const isVisible =
    mode === "command"
      ? canLoadCommands
      : mode === "file" || mode === "env"
        ? Boolean(serverId) && autocompleteCwd.length > 0
        : false;

  const {
    commands,
    isLoading: isCommandsLoading,
    isError,
    error,
  } = useAgentCommandsQuery({
    serverId,
    agentId,
    enabled: mode === "command" && canLoadCommands,
    draftConfig: queryDraftConfig,
  });

  const secretAliasesQuery = useQuery({
    queryKey: ["secretAliases", serverId, autocompleteCwd, envFilterQuery],
    queryFn: async () => {
      if (!client) {
        throw new Error("Daemon client unavailable");
      }
      const response = await client.listSecretAliases({ cwd: autocompleteCwd });
      return response.aliases;
    },
    enabled:
      mode === "env" &&
      Boolean(serverId) &&
      autocompleteCwd.length > 0 &&
      Boolean(client) &&
      isConnected,
    retry: false,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  const fileSuggestionsQuery = useQuery({
    queryKey: ["directorySuggestions", serverId, autocompleteCwd, fileFilterQuery, true, true],
    queryFn: async (): Promise<DirectorySuggestionEntry[]> => {
      if (!client) {
        throw new Error("Daemon client unavailable");
      }
      const response = await client.getDirectorySuggestions({
        cwd: autocompleteCwd,
        query: fileFilterQuery,
        limit: 50,
        includeFiles: true,
        includeDirectories: true,
      });
      if (response.error) {
        throw new Error(response.error);
      }
      return mapDirectorySuggestionsToEntries(response);
    },
    enabled:
      mode === "file" &&
      Boolean(serverId) &&
      autocompleteCwd.length > 0 &&
      Boolean(client) &&
      isConnected,
    retry: false,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  const options = useMemo<AgentAutocompleteOption[]>(() => {
    if (!isVisible) {
      return [];
    }

    if (mode === "command") {
      const filterLower = commandFilterQuery.toLowerCase();
      const matches = commands.filter((cmd) => cmd.name.toLowerCase().includes(filterLower));
      const orderedMatches = orderAutocompleteOptions(matches);
      return orderedMatches.map((cmd) => ({
        type: "command" as const,
        id: cmd.name,
        label: `/${cmd.name}`,
        detail: cmd.argumentHint || undefined,
        description: cmd.description,
        kind: "command",
      }));
    }

    if (mode === "env" && activeEnvMention) {
      const filterLower = envFilterQuery.toLowerCase();
      const source = secretAliasesQuery.data ?? [];
      const matches = source.filter((entry) => entry.alias.toLowerCase().includes(filterLower));
      const orderedMatches = orderAutocompleteOptions(matches);
      return orderedMatches.map((entry) => ({
        type: "env_alias" as const,
        id: `env:${entry.alias}`,
        label: `@env:${entry.alias}`,
        detail:
          entry.scope === "project" && entry.projectRoot
            ? `project · ${entry.projectRoot}`
            : "global",
        kind: "env",
        alias: entry.alias,
        mention: activeEnvMention,
      }));
    }

    if (mode === "file" && activeFileMention) {
      const orderedEntries = orderAutocompleteOptions(fileSuggestionsQuery.data ?? []);
      return orderedEntries.map((entry) => ({
        type: "workspace_entry" as const,
        id: `${entry.kind}:${entry.path}`,
        label: entry.path,
        kind: entry.kind,
        entryPath: entry.path,
        mention: activeFileMention,
      }));
    }

    return [];
  }, [
    activeEnvMention,
    activeFileMention,
    commandFilterQuery,
    commands,
    envFilterQuery,
    fileSuggestionsQuery.data,
    isVisible,
    mode,
    secretAliasesQuery.data,
  ]);

  const onSelectOption = useCallback(
    (option: AutocompleteOption) => {
      const selected = option as AgentAutocompleteOption;
      if (selected.type === "command") {
        setUserInput(`/${selected.id} `);
        onAutocompleteApplied?.();
        return;
      }

      if (selected.type === "env_alias") {
        const nextInput = applyEnvMentionReplacement({
          text: userInput,
          mention: selected.mention,
          alias: selected.alias,
        });
        setUserInput(nextInput);
        onAutocompleteApplied?.();
        return;
      }

      const nextInput = applyFileMentionReplacement({
        text: userInput,
        mention: selected.mention,
        relativePath: selected.entryPath,
      });
      setUserInput(nextInput);
      onAutocompleteApplied?.();
    },
    [onAutocompleteApplied, setUserInput, userInput],
  );

  const { selectedIndex, onKeyPress } = useAutocomplete({
    isVisible,
    options,
    query:
      mode === "command" ? commandFilterQuery : mode === "env" ? envFilterQuery : fileFilterQuery,
    onSelectOption,
    onEscape: mode === "command" ? () => setUserInput("") : undefined,
  });

  const isLoading =
    mode === "command"
      ? isCommandsLoading
      : mode === "env"
        ? secretAliasesQuery.isPending || (secretAliasesQuery.isLoading && options.length === 0)
        : mode === "file"
          ? fileSuggestionsQuery.isPending ||
            (fileSuggestionsQuery.isLoading && options.length === 0)
          : false;
  const errorMessage =
    mode === "command"
      ? isError
        ? (error?.message ?? "Failed to load")
        : undefined
      : mode === "env"
        ? secretAliasesQuery.error instanceof Error
          ? secretAliasesQuery.error.message
          : undefined
        : mode === "file"
          ? fileSuggestionsQuery.error instanceof Error
            ? fileSuggestionsQuery.error.message
            : undefined
          : undefined;

  const loadingText =
    mode === "file"
      ? "Searching workspace..."
      : mode === "env"
        ? "Loading secret aliases..."
        : "Loading commands...";
  const emptyText =
    mode === "file"
      ? "No files or directories found"
      : mode === "env"
        ? "No secret aliases found"
        : "No commands found";

  return {
    isVisible,
    options,
    selectedIndex,
    isLoading,
    errorMessage,
    loadingText,
    emptyText,
    onSelectOption,
    onKeyPress,
  };
}

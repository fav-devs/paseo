import type { ProviderSnapshotEntry } from "@server/server/agent/agent-sdk-types";
import {
  AGENT_PROVIDER_DEFINITIONS,
  type AgentModeColorTier,
  type AgentModeIcon,
  type AgentProviderDefinition,
  type AgentProviderModeDefinition,
} from "@server/server/agent/provider-manifest";

function buildProviderModes(entry: ProviderSnapshotEntry): AgentProviderModeDefinition[] {
  const entryModes = entry.modes ?? [];

  return entryModes.map((mode) =>
    Object.assign({}, mode, {
      icon: (mode.icon ?? "ShieldCheck") as AgentModeIcon,
      colorTier: (mode.colorTier ?? "moderate") as AgentModeColorTier,
    }),
  );
}

export function buildProviderDefinitions(
  snapshotEntries: ProviderSnapshotEntry[] | undefined,
): AgentProviderDefinition[] {
  if (!snapshotEntries?.length) {
    return [];
  }

  return snapshotEntries.map((entry) => ({
    id: entry.provider,
    label: entry.label ?? entry.provider,
    description: entry.description ?? "",
    defaultModeId: entry.defaultModeId ?? null,
    modes: buildProviderModes(entry),
  }));
}

export function resolveProviderLabel(
  provider: string,
  snapshotEntries: ProviderSnapshotEntry[] | undefined,
): string {
  return snapshotEntries?.find((entry) => entry.provider === provider)?.label ?? provider;
}

/** Prefer daemon snapshot labels, then built-in manifest names (e.g. Claude), else the raw id. */
export function resolveProviderDisplayLabel(
  provider: string,
  snapshotEntries: ProviderSnapshotEntry[] | undefined,
): string {
  const fromSnapshot = snapshotEntries?.find((entry) => entry.provider === provider)?.label;
  if (fromSnapshot) {
    return fromSnapshot;
  }
  const builtin = AGENT_PROVIDER_DEFINITIONS.find(
    (definition) => definition.id === provider,
  )?.label;
  return builtin ?? provider;
}

export function resolveProviderDefinition(
  provider: string,
  snapshotEntries: ProviderSnapshotEntry[] | undefined,
): AgentProviderDefinition | undefined {
  return buildProviderDefinitions(snapshotEntries).find((definition) => definition.id === provider);
}

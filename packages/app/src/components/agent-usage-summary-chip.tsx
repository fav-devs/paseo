import { Pressable, Text, View } from "react-native";
import { Activity } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import type { AgentUsage } from "@server/server/agent/agent-sdk-types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatTokenCountShort } from "@/utils/format-tokens";

type AgentUsageSummaryChipProps = {
  usage: AgentUsage;
  providerLabel?: string;
};

function hasBillableUsage(usage: AgentUsage): boolean {
  const { inputTokens, outputTokens, cachedInputTokens, totalCostUsd } = usage;
  return (
    (typeof inputTokens === "number" && inputTokens > 0) ||
    (typeof outputTokens === "number" && outputTokens > 0) ||
    (typeof cachedInputTokens === "number" && cachedInputTokens > 0) ||
    (typeof totalCostUsd === "number" && totalCostUsd > 0)
  );
}

function formatUsd(value: number): string {
  if (value >= 0.01) {
    return `$${value.toFixed(2)}`;
  }
  return `$${value.toFixed(4)}`;
}

function buildCompactLabel(usage: AgentUsage): string | null {
  const parts: string[] = [];
  if (typeof usage.inputTokens === "number" && usage.inputTokens > 0) {
    parts.push(`↓${formatTokenCountShort(usage.inputTokens)}`);
  }
  if (typeof usage.cachedInputTokens === "number" && usage.cachedInputTokens > 0) {
    parts.push(`cache ${formatTokenCountShort(usage.cachedInputTokens)}`);
  }
  if (typeof usage.outputTokens === "number" && usage.outputTokens > 0) {
    parts.push(`↑${formatTokenCountShort(usage.outputTokens)}`);
  }
  if (typeof usage.totalCostUsd === "number" && usage.totalCostUsd > 0) {
    parts.push(formatUsd(usage.totalCostUsd));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function AgentUsageSummaryChip({ usage, providerLabel }: AgentUsageSummaryChipProps) {
  const { theme } = useUnistyles();

  if (!hasBillableUsage(usage)) {
    return null;
  }

  const compact = buildCompactLabel(usage);
  if (!compact) {
    return null;
  }

  const title = providerLabel ? `${providerLabel} · Session usage` : "Session usage";

  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile>
      <TooltipTrigger asChild triggerRefProp="ref">
        <Pressable
          style={styles.container}
          accessibilityRole="text"
          accessibilityLabel={`${title}. ${compact}`}
        >
          <Activity size={12} color={theme.colors.foregroundMuted} />
          <Text style={[styles.label, { color: theme.colors.foregroundMuted }]} numberOfLines={1}>
            {compact}
          </Text>
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <View style={styles.tooltipContent}>
          <Text style={styles.tooltipTitle}>{title}</Text>
          {typeof usage.inputTokens === "number" && usage.inputTokens > 0 ? (
            <Text style={styles.tooltipText}>
              {`Input: ${usage.inputTokens.toLocaleString()} tokens`}
            </Text>
          ) : null}
          {typeof usage.cachedInputTokens === "number" && usage.cachedInputTokens > 0 ? (
            <Text style={styles.tooltipText}>
              {`Cache read: ${usage.cachedInputTokens.toLocaleString()} tokens`}
            </Text>
          ) : null}
          {typeof usage.outputTokens === "number" && usage.outputTokens > 0 ? (
            <Text style={styles.tooltipText}>
              {`Output: ${usage.outputTokens.toLocaleString()} tokens`}
            </Text>
          ) : null}
          {typeof usage.totalCostUsd === "number" && usage.totalCostUsd > 0 ? (
            <Text
              style={styles.tooltipDetail}
            >{`Estimated cost: ${formatUsd(usage.totalCostUsd)}`}</Text>
          ) : null}
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    maxWidth: 200,
    minHeight: 28,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  label: {
    flexShrink: 1,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  tooltipContent: {
    gap: theme.spacing[1],
  },
  tooltipTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
  tooltipDetail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs * 1.4,
  },
}));

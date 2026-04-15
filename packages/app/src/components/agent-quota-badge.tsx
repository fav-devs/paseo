import { Pressable, Text, View } from "react-native";
import { AlertTriangle, Ban, Gauge } from "lucide-react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import type { AgentQuota } from "@server/server/agent/agent-sdk-types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type AgentQuotaBadgeProps = {
  quota: AgentQuota;
  /** Shown in the tooltip (e.g. Claude, Codex). */
  providerLabel?: string;
};

function formatUtilization(utilization: number | undefined): string | null {
  if (typeof utilization !== "number" || !Number.isFinite(utilization)) {
    return null;
  }
  const normalized = utilization <= 1 ? utilization * 100 : utilization;
  return `${Math.round(normalized)}% used`;
}

function formatResetCountdown(resetsAt: string | undefined): string | null {
  if (!resetsAt) {
    return null;
  }

  const resetDate = new Date(resetsAt);
  if (Number.isNaN(resetDate.getTime())) {
    return null;
  }

  const diffMs = resetDate.getTime() - Date.now();
  if (diffMs <= 0) {
    return "Reset pending";
  }

  const totalMinutes = Math.ceil(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `Resets in ${hours}h ${minutes}m`;
  }
  return `Resets in ${minutes}m`;
}

function formatResetDate(resetsAt: string | undefined): string | null {
  if (!resetsAt) {
    return null;
  }

  const resetDate = new Date(resetsAt);
  if (Number.isNaN(resetDate.getTime())) {
    return null;
  }

  return resetDate.toLocaleString();
}

export function AgentQuotaBadge({ quota, providerLabel }: AgentQuotaBadgeProps) {
  const { theme } = useUnistyles();
  const countdown = formatResetCountdown(quota.resetsAt);
  const resetDate = formatResetDate(quota.resetsAt);
  const utilization = formatUtilization(quota.utilization);

  const tone =
    quota.status === "blocked"
      ? {
          background: theme.colors.palette.red[100],
          border: theme.colors.palette.red[300],
          text: theme.colors.palette.red[800],
          icon: theme.colors.palette.red[500],
          Icon: Ban,
          label: "Blocked",
        }
      : quota.status === "warning"
        ? {
            background: theme.colors.surface2,
            border: theme.colors.palette.amber[500],
            text: theme.colors.palette.amber[700],
            icon: theme.colors.palette.amber[500],
            Icon: AlertTriangle,
            label: "Warning",
          }
        : {
            background: theme.colors.surface2,
            border: theme.colors.border,
            text: theme.colors.foregroundMuted,
            icon: theme.colors.palette.blue[500],
            Icon: Gauge,
            label: "OK",
          };

  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile>
      <TooltipTrigger asChild triggerRefProp="ref">
        <Pressable
          style={[
            styles.container,
            {
              backgroundColor: tone.background,
              borderColor: tone.border,
            },
          ]}
          accessibilityRole="text"
          accessibilityLabel={`${providerLabel ? `${providerLabel} ` : ""}Provider quota ${tone.label}${countdown ? `, ${countdown}` : ""}`}
        >
          <tone.Icon size={12} color={tone.icon} />
          <Text style={[styles.label, { color: tone.text }]} numberOfLines={1}>
            {countdown ?? tone.label}
          </Text>
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <View style={styles.tooltipContent}>
          <Text style={styles.tooltipTitle}>
            {providerLabel ? `${providerLabel} · Rate limit` : "Provider quota"}
          </Text>
          <Text style={styles.tooltipText}>{`Status: ${tone.label}`}</Text>
          {quota.limitKind ? (
            <Text style={styles.tooltipText}>{`Window: ${quota.limitKind}`}</Text>
          ) : null}
          {utilization ? <Text style={styles.tooltipText}>{utilization}</Text> : null}
          {resetDate ? <Text style={styles.tooltipDetail}>{`Resets: ${resetDate}`}</Text> : null}
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    maxWidth: 160,
    minHeight: 28,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    paddingHorizontal: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
  },
  label: {
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

import { useQuery } from "@tanstack/react-query";
import { Activity, Cpu, Network } from "lucide-react-native";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import type { SystemMonitorResponse } from "@server/shared/messages";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { useSessionStore } from "@/stores/session-store";

type SystemMonitorPayload = SystemMonitorResponse["payload"];
type PortEntry = SystemMonitorPayload["ports"][number];
type SystemResources = SystemMonitorPayload["resources"];

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatUptime(seconds: number | null): string {
  if (seconds === null) {
    return "—";
  }
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) {
    return "—";
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ResourceBar({ value, color }: { value: number; color: string }) {
  const { theme } = useUnistyles();
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <View
      style={{
        height: 6,
        borderRadius: 3,
        backgroundColor: theme.colors.border,
        overflow: "hidden",
        flex: 1,
      }}
    >
      <View
        style={{
          width: `${clamped}%`,
          height: "100%",
          borderRadius: 3,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

function ResourcesSection({ resources }: { resources: SystemResources }) {
  const { theme } = useUnistyles();
  const cpuPct = resources.cpuPercent ?? 0;
  const memPct =
    resources.memTotalBytes && resources.memUsedBytes
      ? (resources.memUsedBytes / resources.memTotalBytes) * 100
      : 0;
  const cpuColor =
    cpuPct > 80
      ? theme.colors.destructive
      : cpuPct > 50
        ? (theme.colors.warning ?? theme.colors.foregroundMuted)
        : theme.colors.primary;
  const memColor =
    memPct > 85
      ? theme.colors.destructive
      : memPct > 65
        ? (theme.colors.warning ?? theme.colors.foregroundMuted)
        : theme.colors.primary;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Cpu size={14} color={theme.colors.foregroundMuted} />
        <Text style={[styles.sectionTitle, { color: theme.colors.foreground }]}>
          System Resources
        </Text>
      </View>
      <View style={styles.resourceRow}>
        <Text style={[styles.resourceLabel, { color: theme.colors.foregroundMuted }]}>CPU</Text>
        <ResourceBar value={cpuPct} color={cpuColor} />
        <Text style={[styles.resourceValue, { color: theme.colors.foreground }]}>
          {resources.cpuPercent !== null ? `${Math.round(resources.cpuPercent)}%` : "—"}
        </Text>
      </View>
      <View style={styles.resourceRow}>
        <Text style={[styles.resourceLabel, { color: theme.colors.foregroundMuted }]}>Memory</Text>
        <ResourceBar value={memPct} color={memColor} />
        <Text style={[styles.resourceValue, { color: theme.colors.foreground }]}>
          {resources.memUsedBytes !== null
            ? `${formatBytes(resources.memUsedBytes)} / ${formatBytes(resources.memTotalBytes)}`
            : "—"}
        </Text>
      </View>
      <View style={styles.resourceRow}>
        <Text style={[styles.resourceLabel, { color: theme.colors.foregroundMuted }]}>Load</Text>
        <View style={{ flex: 1 }} />
        <Text style={[styles.resourceValue, { color: theme.colors.foreground }]}>
          {resources.loadAvg1m !== null ? resources.loadAvg1m.toFixed(2) : "—"}
        </Text>
      </View>
    </View>
  );
}

function PortRow({ entry }: { entry: PortEntry }) {
  const { theme } = useUnistyles();
  const statusColor =
    entry.status === "healthy" ? (theme.colors.success ?? "#22c55e") : theme.colors.foregroundMuted;

  return (
    <View style={[styles.portRow, { borderBottomColor: theme.colors.border }]}>
      <View style={[styles.portBadge, { backgroundColor: theme.colors.surface1 }]}>
        <Text style={[styles.portBadgeText, { color: theme.colors.foreground }]}>
          :{entry.port}
        </Text>
      </View>
      <View style={styles.portInfo}>
        <Text style={[styles.portProcess, { color: theme.colors.foreground }]} numberOfLines={1}>
          {entry.process}
        </Text>
        {entry.framework ? (
          <Text style={[styles.portFramework, { color: theme.colors.foregroundMuted }]}>
            {entry.framework}
          </Text>
        ) : null}
      </View>
      <View style={styles.portMeta}>
        {entry.pid !== null ? (
          <Text style={[styles.portPid, { color: theme.colors.foregroundMuted }]}>
            PID {entry.pid}
          </Text>
        ) : null}
        <Text style={[styles.portUptime, { color: theme.colors.foregroundMuted }]}>
          {formatUptime(entry.uptimeSeconds)}
        </Text>
        <View
          style={[
            styles.statusDot,
            {
              backgroundColor: statusColor,
            },
          ]}
        />
      </View>
    </View>
  );
}

function PortsSection({ ports }: { ports: PortEntry[] }) {
  const { theme } = useUnistyles();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Network size={14} color={theme.colors.foregroundMuted} />
        <Text style={[styles.sectionTitle, { color: theme.colors.foreground }]}>
          Listening Ports
        </Text>
        <Text style={[styles.portCount, { color: theme.colors.foregroundMuted }]}>
          {ports.length} active
        </Text>
      </View>
      {ports.length === 0 ? (
        <Text style={[styles.emptyText, { color: theme.colors.foregroundMuted }]}>
          No listening ports found
        </Text>
      ) : (
        ports.map((entry) => <PortRow key={`${entry.port}-${entry.pid}`} entry={entry} />)
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function SystemMonitorPanel() {
  const { serverId } = usePaneContext();
  const { theme } = useUnistyles();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);

  const query = useQuery({
    queryKey: ["system-monitor", serverId] as const,
    enabled: Boolean(client),
    queryFn: async (): Promise<SystemMonitorPayload> => {
      if (!client) {
        throw new Error("No client");
      }
      return client.systemMonitor();
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  if (query.isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <Text style={{ color: theme.colors.foregroundMuted }}>Loading…</Text>
      </View>
    );
  }

  if (query.isError || !query.data) {
    const errorMsg =
      query.error instanceof Error ? query.error.message : "Failed to load system data";
    return (
      <View style={[styles.centered, { backgroundColor: theme.colors.background }]}>
        <Text style={{ color: theme.colors.destructive }}>{errorMsg}</Text>
      </View>
    );
  }

  const { ports, resources, error } = query.data;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.scrollContent}
    >
      {error ? (
        <Text style={[styles.errorBanner, { color: theme.colors.destructive }]}>{error}</Text>
      ) : null}
      <ResourcesSection resources={resources} />
      <PortsSection ports={ports} />
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Descriptor & registration
// ---------------------------------------------------------------------------

function useSystemMonitorDescriptor(): PanelDescriptor {
  return {
    label: "System Monitor",
    subtitle: "Ports & Resources",
    titleState: "ready",
    icon: Activity,
    statusBucket: null,
  };
}

export const systemMonitorPanelRegistration: PanelRegistration<"system-monitor"> = {
  kind: "system-monitor",
  component: SystemMonitorPanel,
  useDescriptor: useSystemMonitorDescriptor,
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create((theme) => ({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    padding: 16,
    gap: 20,
  },
  errorBanner: {
    fontSize: 13,
    marginBottom: 8,
  },
  section: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  portCount: {
    fontSize: 12,
  },
  resourceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  resourceLabel: {
    fontSize: 12,
    width: 52,
  },
  resourceValue: {
    fontSize: 12,
    width: 130,
    textAlign: "right",
  },
  portRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  portBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 64,
    alignItems: "center",
  },
  portBadgeText: {
    fontSize: 12,
    fontFamily: "monospace",
    fontWeight: "600",
  },
  portInfo: {
    flex: 1,
    gap: 2,
  },
  portProcess: {
    fontSize: 13,
    fontWeight: "500",
  },
  portFramework: {
    fontSize: 11,
  },
  portMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  portPid: {
    fontSize: 11,
  },
  portUptime: {
    fontSize: 11,
    minWidth: 28,
    textAlign: "right",
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  emptyText: {
    fontSize: 13,
    fontStyle: "italic",
  },
}));

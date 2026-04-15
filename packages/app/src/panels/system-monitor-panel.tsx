import { Activity } from "lucide-react-native";
import { View } from "react-native";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { SystemMonitorPane } from "@/components/system-monitor-pane";

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function SystemMonitorPanel() {
  const { serverId } = usePaneContext();
  return (
    <View style={{ flex: 1 }}>
      <SystemMonitorPane serverId={serverId} />
    </View>
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

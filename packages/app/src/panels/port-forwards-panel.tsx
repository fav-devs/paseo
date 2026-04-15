import { Network } from "lucide-react-native";
import { View } from "react-native";
import { PortForwardsPane } from "@/components/port-forwards-pane";
import { usePaneContext } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";

function PortForwardsPanel() {
  const { serverId, workspaceId } = usePaneContext();
  return (
    <View style={{ flex: 1 }}>
      <PortForwardsPane serverId={serverId} workspaceId={workspaceId} />
    </View>
  );
}

function usePortForwardsDescriptor(): PanelDescriptor {
  return {
    label: "Ports",
    subtitle: "Port Forwards",
    titleState: "ready",
    icon: Network,
    statusBucket: null,
  };
}

export const portForwardsPanelRegistration: PanelRegistration<"port-forwards"> = {
  kind: "port-forwards",
  component: PortForwardsPanel,
  useDescriptor: usePortForwardsDescriptor,
};

import { agentPanelRegistration } from "@/panels/agent-panel";
import { draftPanelRegistration } from "@/panels/draft-panel";
import { filePanelRegistration } from "@/panels/file-panel";
import { registerPanel } from "@/panels/panel-registry";
import { portForwardsPanelRegistration } from "@/panels/port-forwards-panel";
import { systemMonitorPanelRegistration } from "@/panels/system-monitor-panel";
import { terminalPanelRegistration } from "@/panels/terminal-panel";

let panelsRegistered = false;

export function ensurePanelsRegistered(): void {
  if (panelsRegistered) {
    return;
  }
  registerPanel(draftPanelRegistration);
  registerPanel(agentPanelRegistration);
  registerPanel(terminalPanelRegistration);
  registerPanel(portForwardsPanelRegistration);
  registerPanel(filePanelRegistration);
  registerPanel(systemMonitorPanelRegistration);
  panelsRegistered = true;
}

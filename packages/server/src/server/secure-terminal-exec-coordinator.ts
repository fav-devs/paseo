import { randomUUID } from "node:crypto";
import type { SessionOutboundMessage } from "../shared/messages.js";

export type SecureTerminalExecApprovalPayload = Extract<
  SessionOutboundMessage,
  { type: "secure_terminal_exec_approval_required" }
>["payload"];

type Pending = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Coordinates cross-surface approval for secure terminal exec (MCP tool waits; UI approves via WS).
 */
export class SecureTerminalExecCoordinator {
  private readonly pending = new Map<string, Pending>();
  private broadcaster?: (payload: SecureTerminalExecApprovalPayload) => void;

  public setBroadcaster(handler: (payload: SecureTerminalExecApprovalPayload) => void): void {
    this.broadcaster = handler;
  }

  public createApprovalId(): string {
    return randomUUID();
  }

  public async waitForApproval(params: {
    approvalId: string;
    cwd: string;
    command: string;
    secretAliases: string[];
    source: "mcp" | "session";
    agentId?: string | null;
    timeoutMs: number;
  }): Promise<void> {
    const { approvalId, timeoutMs, cwd, command, secretAliases, source, agentId } = params;
    if (this.pending.has(approvalId)) {
      throw new Error("Duplicate secure terminal exec approval id");
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const entry = this.pending.get(approvalId);
        if (!entry) {
          return;
        }
        this.pending.delete(approvalId);
        entry.reject(new Error(`Secure terminal exec approval timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(approvalId, { resolve, reject, timer });
      this.broadcaster?.({
        approvalId,
        cwd,
        command,
        secretAliases: [...secretAliases],
        requestedAt: new Date().toISOString(),
        source,
        agentId: agentId ?? null,
      });
    });
  }

  public approve(approvalId: string): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) {
      return false;
    }
    clearTimeout(entry.timer);
    this.pending.delete(approvalId);
    entry.resolve();
    return true;
  }

  public reject(approvalId: string, message = "Secure terminal exec rejected"): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) {
      return false;
    }
    clearTimeout(entry.timer);
    this.pending.delete(approvalId);
    entry.reject(new Error(message));
    return true;
  }
}

import type { TerminalManager } from "../terminal/terminal-manager.js";
import { captureTerminalLines } from "../terminal/terminal.js";
import type { SecretVault } from "./secret-vault.js";

export async function runSecureTerminalExec(params: {
  terminalManager: TerminalManager;
  secretVault: SecretVault;
  cwd: string;
  command: string;
  secretAliases: string[];
  captureLines?: number;
  waitMs?: number;
}): Promise<{ terminalId: string; lines: string[]; totalLines: number }> {
  const secretEnv = params.secretVault.resolveAliases(params.secretAliases, params.cwd);
  const terminal = await params.terminalManager.createTerminal({
    cwd: params.cwd,
    name: "secure-exec",
    env: secretEnv,
  });

  terminal.send({
    type: "input",
    data: `${params.command}\r`,
  });

  const waitMs = params.waitMs ?? 700;
  if (waitMs > 0) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, waitMs));
  }

  const capture = captureTerminalLines(terminal, {
    start: -(params.captureLines ?? 120),
    end: -1,
    stripAnsi: true,
  });

  const redactedLines = capture.lines.map((line) => {
    let next = line;
    for (const [alias, value] of Object.entries(secretEnv)) {
      if (value.length > 0) {
        next = next.split(value).join(`[REDACTED_${alias}]`);
      }
    }
    return next;
  });

  return {
    terminalId: terminal.id,
    lines: redactedLines,
    totalLines: capture.totalLines,
  };
}

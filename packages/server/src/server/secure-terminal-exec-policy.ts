import path from "node:path";
import type { MutableDaemonConfig } from "../shared/messages.js";

export type ResolvedSecretsPolicy = {
  allowedSecureExecCwdPrefixes: string[];
  deniedCommandSubstrings: string[];
  blockEnvDumpCommands: boolean;
  aliasesRequiringApproval: string[];
  approvalTimeoutMs: number;
};

const ENV_DUMP_REGEXES: ReadonlyArray<RegExp> = [
  /(?:^|[;&|])\s*env(?:\s|$|[;&|])/i,
  /(?:^|[;&|])\s*printenv\b/i,
  /\bexport\s+-p\b/i,
  /\bdeclare\s+-p\b/i,
  /(?:^|[;&|])\s*set\s*(?:;|\||&|$)/i,
];

export function resolveSecretsPolicy(config: MutableDaemonConfig): ResolvedSecretsPolicy {
  const raw = config.secrets?.policy;
  const approvalTimeoutMs = raw?.approvalTimeoutMs ?? 120_000;
  return {
    allowedSecureExecCwdPrefixes: (raw?.allowedSecureExecCwdPrefixes ?? [])
      .map((entry) => path.normalize(entry.trim()))
      .filter((entry) => entry.length > 0),
    deniedCommandSubstrings: (raw?.deniedCommandSubstrings ?? [])
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
    blockEnvDumpCommands: raw?.blockEnvDumpCommands ?? false,
    aliasesRequiringApproval: (raw?.aliasesRequiringApproval ?? [])
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
    approvalTimeoutMs: Math.min(600_000, Math.max(5_000, approvalTimeoutMs)),
  };
}

function firstCommandLine(command: string): string {
  return command.split(/\r?\n/)[0]?.trim() ?? "";
}

function assertCwdMatchesPrefixes(cwd: string, prefixes: string[]): void {
  if (prefixes.length === 0) {
    return;
  }
  const normalizedCwd = path.normalize(cwd.trim());
  const allowed = prefixes.some(
    (prefix) => normalizedCwd === prefix || normalizedCwd.startsWith(`${prefix}${path.sep}`),
  );
  if (!allowed) {
    throw new Error(
      `Secure terminal cwd is not allowed by secrets.policy.allowedSecureExecCwdPrefixes (cwd=${normalizedCwd})`,
    );
  }
}

function assertDeniedSubstrings(commandLine: string, substrings: string[]): void {
  if (substrings.length === 0) {
    return;
  }
  const lower = commandLine.toLowerCase();
  for (const needle of substrings) {
    if (lower.includes(needle.toLowerCase())) {
      throw new Error(
        `Secure terminal command matched secrets.policy.deniedCommandSubstrings entry: ${JSON.stringify(needle)}`,
      );
    }
  }
}

function assertNoEnvDumpPatterns(commandLine: string): void {
  for (const pattern of ENV_DUMP_REGEXES) {
    if (pattern.test(commandLine)) {
      throw new Error(
        "Secure terminal command looks like an environment dump (blocked by secrets.policy.blockEnvDumpCommands)",
      );
    }
  }
}

export function evaluateSecureExecPolicy(
  policy: ResolvedSecretsPolicy,
  input: { cwd: string; command: string; secretAliases: readonly string[] },
): { needsApproval: boolean; approvalAliases: string[] } {
  assertCwdMatchesPrefixes(input.cwd, policy.allowedSecureExecCwdPrefixes);

  const commandLine = firstCommandLine(input.command);
  if (commandLine.length === 0) {
    throw new Error("Secure terminal command is empty");
  }

  assertDeniedSubstrings(commandLine, policy.deniedCommandSubstrings);
  if (policy.blockEnvDumpCommands) {
    assertNoEnvDumpPatterns(commandLine);
  }

  const approvalSet = new Set(policy.aliasesRequiringApproval);
  const approvalAliases = input.secretAliases
    .map((alias) => alias.trim())
    .filter((alias) => alias.length > 0 && approvalSet.has(alias));

  return {
    needsApproval: approvalAliases.length > 0,
    approvalAliases,
  };
}

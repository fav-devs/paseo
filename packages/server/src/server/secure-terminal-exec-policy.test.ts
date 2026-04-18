import path from "node:path";
import { describe, expect, it } from "vitest";
import type { MutableDaemonConfig } from "../shared/messages.js";
import { evaluateSecureExecPolicy, resolveSecretsPolicy } from "./secure-terminal-exec-policy.js";

function cfg(partial: MutableDaemonConfig["secrets"]): MutableDaemonConfig {
  return {
    mcp: { injectIntoAgents: true },
    ...(partial !== undefined ? { secrets: partial } : {}),
  };
}

describe("resolveSecretsPolicy", () => {
  it("defaults approval timeout", () => {
    const policy = resolveSecretsPolicy(cfg(undefined));
    expect(policy.approvalTimeoutMs).toBe(120_000);
    expect(policy.blockEnvDumpCommands).toBe(false);
  });
});

describe("evaluateSecureExecPolicy", () => {
  const root = path.parse(process.cwd()).root || "/";

  it("allows cwd when prefix list is empty", () => {
    const policy = resolveSecretsPolicy(cfg(undefined));
    expect(() =>
      evaluateSecureExecPolicy(policy, {
        cwd: process.cwd(),
        command: "echo hi",
        secretAliases: [],
      }),
    ).not.toThrow();
  });

  it("rejects cwd outside allowed prefixes", () => {
    const policy = resolveSecretsPolicy(
      cfg({
        policy: {
          allowedSecureExecCwdPrefixes: [path.join(root, "only-here")],
        },
      }),
    );
    expect(() =>
      evaluateSecureExecPolicy(policy, {
        cwd: "/tmp/other",
        command: "echo hi",
        secretAliases: [],
      }),
    ).toThrow(/allowedSecureExecCwdPrefixes/);
  });

  it("matches deniedCommandSubstrings case-insensitively", () => {
    const policy = resolveSecretsPolicy(
      cfg({
        policy: {
          deniedCommandSubstrings: ["curl evil"],
        },
      }),
    );
    expect(() =>
      evaluateSecureExecPolicy(policy, {
        cwd: process.cwd(),
        command: "curl EVIL payload",
        secretAliases: [],
      }),
    ).toThrow(/deniedCommandSubstrings/);
  });

  it("blocks env dumps when enabled", () => {
    const policy = resolveSecretsPolicy(
      cfg({
        policy: {
          blockEnvDumpCommands: true,
        },
      }),
    );
    expect(() =>
      evaluateSecureExecPolicy(policy, {
        cwd: process.cwd(),
        command: "env",
        secretAliases: [],
      }),
    ).toThrow(/environment dump/);
  });

  it("flags aliases requiring approval", () => {
    const policy = resolveSecretsPolicy(
      cfg({
        policy: {
          aliasesRequiringApproval: ["DB_URL"],
        },
      }),
    );
    const result = evaluateSecureExecPolicy(policy, {
      cwd: process.cwd(),
      command: "echo hi",
      secretAliases: ["DB_URL"],
    });
    expect(result.needsApproval).toBe(true);
    expect(result.approvalAliases).toEqual(["DB_URL"]);
  });
});

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const SECRET_VAULT_FILENAME = "secret-vault.json";
const KEYPAIR_FILENAME = "daemon-keypair.json";

const SecretRecordSchema = z.object({
  alias: z.string().min(1),
  scope: z.enum(["global", "project"]).default("global"),
  projectRoot: z.string().nullable().default(null),
  encryptedValue: z.string().min(1),
  iv: z.string().min(1),
  authTag: z.string().min(1),
  updatedAt: z.string().min(1),
});

const SecretVaultSchema = z.object({
  v: z.literal(1),
  entries: z.array(SecretRecordSchema),
});

type SecretRecord = z.infer<typeof SecretRecordSchema>;
type SecretVaultFile = z.infer<typeof SecretVaultSchema>;

export class SecretVault {
  private readonly filePath: string;
  private readonly key: Buffer;

  constructor(private readonly paseoHome: string) {
    this.filePath = path.join(this.paseoHome, SECRET_VAULT_FILENAME);
    this.key = this.deriveKey();
  }

  public listAliases(cwd?: string): Array<{
    alias: string;
    updatedAt: string;
    scope: "global" | "project";
    projectRoot: string | null;
  }> {
    const resolvedCwd = cwd?.trim();
    return this.readVault()
      .entries.filter((entry) => this.matchesScopeForCwd(entry, resolvedCwd))
      .map((entry) => ({
        alias: entry.alias,
        updatedAt: entry.updatedAt,
        scope: entry.scope,
        projectRoot: entry.projectRoot,
      }));
  }

  public upsert(input: {
    alias: string;
    value: string;
    scope?: "global" | "project";
    projectRoot?: string;
  }): void {
    const scope = input.scope ?? "global";
    const projectRoot = scope === "project" ? (input.projectRoot?.trim() ?? "") : "";
    const normalizedAlias = input.alias.trim();
    const normalizedValue = input.value;
    if (!normalizedAlias) {
      throw new Error("alias is required");
    }
    if (!normalizedValue) {
      throw new Error("value is required");
    }
    if (scope === "project" && !projectRoot) {
      throw new Error("projectRoot is required for project-scoped secrets");
    }

    const vault = this.readVault();
    const encrypted = this.encrypt(normalizedValue);
    const record: SecretRecord = {
      alias: normalizedAlias,
      scope,
      projectRoot: scope === "project" ? projectRoot : null,
      encryptedValue: encrypted.cipherTextB64,
      iv: encrypted.ivB64,
      authTag: encrypted.authTagB64,
      updatedAt: new Date().toISOString(),
    };

    const existingIndex = vault.entries.findIndex(
      (entry) =>
        entry.alias === normalizedAlias &&
        entry.scope === record.scope &&
        (entry.projectRoot ?? null) === (record.projectRoot ?? null),
    );
    if (existingIndex >= 0) {
      vault.entries[existingIndex] = record;
    } else {
      vault.entries.push(record);
    }
    this.writeVault(vault);
  }

  public remove(input: {
    alias: string;
    scope?: "global" | "project";
    projectRoot?: string;
  }): boolean {
    const normalizedAlias = input.alias.trim();
    const scope = input.scope ?? "global";
    const projectRoot = scope === "project" ? (input.projectRoot?.trim() ?? "") : "";
    if (!normalizedAlias) {
      return false;
    }
    const vault = this.readVault();
    const nextEntries = vault.entries.filter(
      (entry) =>
        !(
          entry.alias === normalizedAlias &&
          entry.scope === scope &&
          (scope !== "project" || (entry.projectRoot ?? "") === projectRoot)
        ),
    );
    if (nextEntries.length === vault.entries.length) {
      return false;
    }
    this.writeVault({ ...vault, entries: nextEntries });
    return true;
  }

  public resolveAliases(aliases: string[], cwd?: string): Record<string, string> {
    const resolvedCwd = cwd?.trim();
    const uniqueAliases = Array.from(
      new Set(aliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0)),
    );
    const vault = this.readVault();
    const env: Record<string, string> = {};

    for (const alias of uniqueAliases) {
      const entry = this.resolveBestEntryForAlias(vault.entries, alias, resolvedCwd);
      if (!entry) {
        throw new Error(`Unknown secret alias: ${alias}`);
      }
      env[alias] = this.decrypt(entry);
    }

    return env;
  }

  private deriveKey(): Buffer {
    const keypairPath = path.join(this.paseoHome, KEYPAIR_FILENAME);
    if (!existsSync(keypairPath)) {
      throw new Error("Daemon keypair is required before using secret vault");
    }
    const raw = readFileSync(keypairPath, "utf8");
    const parsed = z
      .object({
        secretKeyB64: z.string().min(1),
      })
      .parse(JSON.parse(raw));
    return createHash("sha256").update(parsed.secretKeyB64, "utf8").digest();
  }

  private encrypt(value: string): {
    cipherTextB64: string;
    ivB64: string;
    authTagB64: string;
  } {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      cipherTextB64: encrypted.toString("base64"),
      ivB64: iv.toString("base64"),
      authTagB64: authTag.toString("base64"),
    };
  }

  private decrypt(entry: SecretRecord): string {
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(entry.iv, "base64"));
    decipher.setAuthTag(Buffer.from(entry.authTag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(entry.encryptedValue, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  }

  private readVault(): SecretVaultFile {
    if (!existsSync(this.filePath)) {
      return { v: 1, entries: [] };
    }
    const raw = readFileSync(this.filePath, "utf8");
    return SecretVaultSchema.parse(JSON.parse(raw));
  }

  private writeVault(vault: SecretVaultFile): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(vault, null, 2) + "\n", { mode: 0o600 });
  }

  private matchesScopeForCwd(entry: SecretRecord, cwd?: string): boolean {
    if (entry.scope === "global") {
      return true;
    }
    if (!cwd || !entry.projectRoot) {
      return false;
    }
    return cwd === entry.projectRoot || cwd.startsWith(`${entry.projectRoot}${path.sep}`);
  }

  private resolveBestEntryForAlias(
    entries: SecretRecord[],
    alias: string,
    cwd?: string,
  ): SecretRecord | undefined {
    const candidates = entries.filter((entry) => entry.alias === alias);
    if (candidates.length === 0) {
      return undefined;
    }
    if (!cwd) {
      return candidates.find((entry) => entry.scope === "global") ?? candidates[0];
    }
    const projectMatches = candidates
      .filter((entry) => this.matchesScopeForCwd(entry, cwd))
      .sort((a, b) => (b.projectRoot?.length ?? 0) - (a.projectRoot?.length ?? 0));
    return projectMatches[0] ?? candidates.find((entry) => entry.scope === "global");
  }
}

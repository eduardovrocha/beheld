import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { runWizard } from "../ui/wizard";
import { installClaudeCodeHooks, installContinueDevMcp, installClaudeSlashCommand, installClaudeMcpServer, migrateProjectScopedRegistrations } from "../config/hooks";
import * as daemonManager from "../daemon-manager";
import { ensureSecurePermissions } from "../daemon-manager";
import type { DevProfileConfig } from "../types";

const VERSION = "0.1.1";

function configPath(): string {
  return join(homedir(), ".devprofile", "config.json");
}

function readConfig(): DevProfileConfig | null {
  const p = configPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as DevProfileConfig;
  } catch {
    return null;
  }
}

async function askReinit(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("DevProfile já está configurado. Reinicializar? [s/N] ", (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase() === "s");
    });
  });
}

export async function initCommand(opts: { force?: boolean } = {}): Promise<void> {
  ensureSecurePermissions();
  // Generate Ed25519 signing keys on first run (silent if already present).
  // Required for `devprofile snapshot` (Phase 5 — signed .dpbundle).
  const { ensureKeysSilent } = await import("./keys");
  await ensureKeysSilent();

  const existing = readConfig();
  if (existing && !opts.force) {
    const reinit = await askReinit();
    if (!reinit) {
      console.log("Abortado.");
      return;
    }
  }

  const result = await runWizard(
    {
      migrateProjectScoped: () => migrateProjectScopedRegistrations(),
      installClaudeHooks: async () => {
        await installClaudeCodeHooks();
        await installClaudeMcpServer();
        await installClaudeSlashCommand();
      },
      installContinueMcp: async () => {
        await installContinueDevMcp();
      },
      extractEngine: async () => {
        const { ensureEngine } = await import("../engine-extractor");
        return ensureEngine();
      },
      startDaemons: async () => {
        const result = await daemonManager.start();
        if (result.alreadyRunning) return "Daemons já em execução";
        if (result.mcp && result.engine) return "Daemons iniciados";
        return `Falha parcial — MCP:${result.mcp} Engine:${result.engine}`;
      },
      installAutostart: async () => {
        await daemonManager.installAutostart();
      },
      runBootstrapImport: async (authorEmail: string) => {
        // Persist email immediately so the import loop can pick it up,
        // then enter the interactive loop. The author_email is also returned
        // up the call chain so the final config.json write below preserves it.
        const { runImport, defaultConfigStore } = await import("./import");
        defaultConfigStore.setAuthorEmail(authorEmail);
        await runImport({});
      },
    },
  );

  const config: DevProfileConfig = {
    version: VERSION,
    initialized_at: new Date().toISOString(),
    dimensions: result.dimensions,
    environments: result.environments,
    ...(result.author_email ? { author_email: result.author_email } : {}),
  };

  mkdirSync(join(homedir(), ".devprofile"), { recursive: true, mode: 0o700 });
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n");
}

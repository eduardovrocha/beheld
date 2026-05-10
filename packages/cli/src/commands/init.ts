import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { runWizard } from "../ui/wizard";
import { installClaudeCodeHooks, installContinueDevMcp, installClaudeSlashCommand, installClaudeMcpServer } from "../config/hooks";
import * as daemonManager from "../daemon-manager";
import type { DevProfileConfig } from "../types";

const VERSION = "0.1.0";

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

export async function initCommand(): Promise<void> {
  const existing = readConfig();
  if (existing) {
    const reinit = await askReinit();
    if (!reinit) {
      console.log("Abortado.");
      return;
    }
  }

  const result = await runWizard(
    {
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
        await daemonManager.start();
      },
      installAutostart: async () => {
        await daemonManager.installAutostart();
      },
    },
  );

  const config: DevProfileConfig = {
    version: VERSION,
    initialized_at: new Date().toISOString(),
    dimensions: result.dimensions,
    environments: result.environments,
  };

  mkdirSync(join(homedir(), ".devprofile"), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n");
}

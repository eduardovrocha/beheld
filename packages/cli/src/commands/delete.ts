import { rmSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { removeAllHooks } from "../config/hooks";
import * as daemonManager from "../daemon-manager";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function devprofileDir(): string {
  return process.env.DEVPROFILE_DATA_DIR
    ? join(process.env.DEVPROFILE_DATA_DIR, ".devprofile")
    : join(homedir(), ".devprofile");
}

async function askConfirmPhrase(phrase: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`  Digite "${phrase}" para confirmar: `, (ans) => {
      rl.close();
      resolve(ans.trim() === phrase);
    });
  });
}

interface DeleteOptions {
  local?: boolean;
  remote?: boolean;
  all?: boolean;
}

export async function deleteCommand(opts: DeleteOptions): Promise<void> {
  const { local, remote, all } = opts;

  if (!local && !remote && !all) {
    console.error("  Especifique --local, --remote ou --all");
    process.exit(1);
  }

  if (local || all) {
    const dir = devprofileDir();
    const totalSessions = countSessions(dir);
    console.log(
      `\n  ${RED}Isso apagará ${totalSessions} sessões de dados locais. Não pode ser desfeito.${RESET}`,
    );
    const confirmed = await askConfirmPhrase("apagar tudo");
    if (!confirmed) {
      console.log("Abortado.");
      return;
    }

    process.stdout.write("  Parando daemon…");
    try {
      await daemonManager.stop();
      process.stdout.write(`\r  ${GREEN}✓${RESET}  Parando daemon\n`);
    } catch {
      process.stdout.write(`\r  ${DIM}~${RESET}  Daemon não estava em execução\n`);
    }

    if (all) {
      process.stdout.write("  Removendo hooks…");
      try {
        await removeAllHooks();
        process.stdout.write(`\r  ${GREEN}✓${RESET}  Removendo hooks\n`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stdout.write(`\r  ${RED}✗${RESET}  ${msg}\n`);
      }
    }

    process.stdout.write("  Apagando ~/.devprofile/…");
    try {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      process.stdout.write(`\r  ${GREEN}✓${RESET}  Apagando ~/.devprofile/\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`\r  ${RED}✗${RESET}  ${msg}\n`);
    }

    console.log(`\n  ${BOLD}DevProfile removido.${RESET}`);
  }

  if (remote && !all) {
    console.log(`  ${DIM}Conta remota: não implementado nesta versão.${RESET}`);
  }
}

function countSessions(dir: string): number {
  const sessionsDir = join(dir, "sessions");
  if (!existsSync(sessionsDir)) return 0;
  try {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    return readdirSync(sessionsDir).filter((f: string) => f.endsWith(".jsonl")).length;
  } catch {
    return 0;
  }
}

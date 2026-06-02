/**
 * `beheld share` — publish the most recent local .beheld to the portal.
 *
 * Reads the newest bundle from `~/.beheld/snapshots/`, signs nothing further
 * (the bundle already carries its Ed25519 signature), and POSTs it to
 * `/api/v1/bundles`. The portal verifies the signature and stores the
 * payload + assigns a public URL slug — which we cache in `config.json`.
 *
 * Dependency-injectable for tests — see `ShareDeps`. The real implementation
 * defaults to filesystem + stdin + fetch.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import type { Bundle } from "../bundle/types";
import { publishBundle, renderQr, slugFromUrl, type PublishResult } from "../bundle/share";
import type { BeheldConfig } from "../types";
import { ok, fail, warn, bold, DIM, RESET, meta, brand } from "../ui/styles";

const SNAPSHOT_EXT = ".beheld";

function beheldDir(): string {
  return process.env.BEHELD_DATA_DIR
    ? join(process.env.BEHELD_DATA_DIR, ".beheld")
    : join(homedir(), ".beheld");
}

export function snapshotsDir(): string {
  return join(beheldDir(), "snapshots");
}

export function configPath(): string {
  return join(beheldDir(), "config.json");
}

/** Most recently modified `.beheld` file in `~/.beheld/snapshots/`, or null
 *  when none has been generated yet. */
export function findLatestBundlePath(dir: string = snapshotsDir()): string | null {
  if (!existsSync(dir)) return null;
  const entries = readdirSync(dir)
    .filter((f) => f.endsWith(SNAPSHOT_EXT))
    .map((f) => {
      const full = join(dir, f);
      return { path: full, mtime: statSync(full).mtimeMs };
    });
  if (entries.length === 0) return null;
  entries.sort((a, b) => b.mtime - a.mtime);
  return entries[0].path;
}

export function loadBundle(path: string): Bundle {
  return JSON.parse(readFileSync(path, "utf8")) as Bundle;
}

export function readConfig(path: string = configPath()): BeheldConfig | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as BeheldConfig;
  } catch {
    return null;
  }
}

export function writeConfig(config: BeheldConfig, path: string = configPath()): void {
  mkdirSync(beheldDir(), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
}

// ── prompt helpers (dependency-injectable) ──────────────────────────────────

export interface Prompter {
  ask(question: string): Promise<string>;
  close(): void;
}

export function nodeReadlinePrompter(): Prompter {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask: (question) => new Promise((resolve) => rl.question(question, (a) => resolve(a))),
    close: () => rl.close(),
  };
}

/** Single-letter affirmative ("s" / "y", case-insensitive). Empty input
 *  returns false — default is N per the product spec. */
export function isAffirmative(answer: string): boolean {
  const a = answer.trim().toLowerCase();
  return a === "s" || a === "y" || a === "sim" || a === "yes";
}

// ── shared runtime ──────────────────────────────────────────────────────────

export interface ShareDeps {
  /** Override fetch (tests inject a mock). */
  fetcher?: typeof fetch;
  /** Override stdout writer (tests capture lines). */
  out?: (line: string) => void;
  /** Prompt provider (tests inject scripted answers). */
  prompter?: Prompter;
  /** Override snapshot directory (tests use a temp dir). */
  snapshotsDir?: string;
  /** Override config path (tests use a temp file). */
  configPath?: string;
}

export interface ShareOutcome {
  ok: boolean;
  exitCode: number;
  result?: PublishResult;
}

/** Heart of `beheld share`: read latest bundle → prompt for email_recovery if
 *  this is the first publish → POST → save slug. Returns an outcome so the
 *  outer command can call `process.exit` cleanly. */
export async function runShare(deps: ShareDeps = {}): Promise<ShareOutcome> {
  const out = deps.out ?? ((line) => console.log(line));
  const cfgPath = deps.configPath ?? configPath();
  const snapDir = deps.snapshotsDir ?? snapshotsDir();

  const bundlePath = findLatestBundlePath(snapDir);
  if (bundlePath === null) {
    out(fail("Nenhum bundle encontrado. Execute: beheld snapshot"));
    return { ok: false, exitCode: 1 };
  }

  let bundle: Bundle;
  try {
    bundle = loadBundle(bundlePath);
  } catch (e) {
    out(fail(`Falha ao ler bundle local: ${(e as Error).message}`));
    return { ok: false, exitCode: 1 };
  }

  const config = readConfig(cfgPath);
  const firstPublish = !config?.last_published_slug;

  let emailRecovery: string | null = null;
  // Skip the email_recovery prompt when:
  //   - this isn't the first publish (already settled);
  //   - the caller injected a prompter (tests want explicit control);
  //   - stdin isn't a TTY (CI / piped input → no human to answer).
  const promptCallerInjected = deps.prompter !== undefined;
  const shouldPromptEmail = firstPublish && (promptCallerInjected || process.stdin.isTTY);
  if (shouldPromptEmail) {
    const prompter = deps.prompter ?? nodeReadlinePrompter();
    try {
      out("→ Registrar email para recuperação de conta? [s/N]");
      out("  (recomendado — necessário para recuperar acesso se perder o equipamento)");
      const yn = await prompter.ask("> ");
      if (isAffirmative(yn)) {
        const email = (await prompter.ask("Email: ")).trim();
        if (email.length > 0) emailRecovery = email;
      }
    } finally {
      prompter.close();
    }
  }

  const result = await publishBundle(bundle, {
    fetcher:       deps.fetcher,
    emailRecovery,
  });

  if (!result.ok) {
    out(fail("Falha no upload — bundle salvo localmente"));
    if (result.error.kind === "network") {
      out(`  ${DIM}rede: ${result.error.message}${RESET}`);
    } else {
      out(`  ${DIM}HTTP ${result.error.status}:${RESET} ${result.error.body.slice(0, 200)}`);
    }
    out(`  ${DIM}Tente novamente: beheld share${RESET}`);
    return { ok: false, exitCode: 1, result };
  }

  const slug = slugFromUrl(result.data.url);
  const merged: BeheldConfig = {
    ...(config ?? {
      version:        "0",
      initialized_at: new Date().toISOString(),
      dimensions: {
        prompt_quality: true, test_maturity: true, tech_breadth: true,
        work_hours: false, project_type: false,
      },
      environments: { claudeCode: false, continueDev: false },
    }),
  };
  if (slug) merged.last_published_slug = slug;
  if (emailRecovery) merged.email_recovery = emailRecovery;
  writeConfig(merged, cfgPath);

  out(ok(result.data.url));
  if (result.data.account_created) {
    out(`  ${meta("conta criada")}`);
  }

  return { ok: true, exitCode: 0, result };
}

/** Render the publish result for the `snapshot --share` flow — keeps the
 *  legacy QR + URL output the dev expects after a snapshot. */
export async function renderShareSuccess(url: string, out: (line: string) => void = (l) => console.log(l)): Promise<void> {
  const qr = await renderQr(url, { small: true });
  out(qr);
  out(`  ${bold(url)}`);
  out("");
}

/** Entry point wired into `index.ts`. */
export async function shareCommand(): Promise<void> {
  console.log(brand("publicando perfil"));
  const outcome = await runShare();
  if (!outcome.ok) process.exit(outcome.exitCode);
  if (outcome.result?.ok) {
    await renderShareSuccess(outcome.result.data.url);
  }
}

// keep `warn` import used by tests / future flows
void warn;

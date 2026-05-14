import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

import {
  deleteL1Repository as defaultDeleteL1Repository,
  getImportStatus as defaultGetImportStatus,
  getL1Repositories as defaultGetL1Repositories,
  importRepository as defaultImportRepository,
} from "../client/engine-client";
import type {
  DevProfileConfig,
  L1ImportResponse,
  L1ImportStatus,
  L1Repository,
} from "../types";

// ── IO + dependency injection (drives the command and makes it testable) ─────

export interface ImportIO {
  prompt(label: string): Promise<string>;
  promptSecret(label: string): Promise<string>;
  confirm(label: string): Promise<boolean>;
  log(msg: string): void;
  sleep(ms: number): Promise<void>;
}

export interface ImportClient {
  importRepository: (
    repoUrl: string,
    authorEmail: string,
    pat?: string | null,
  ) => Promise<L1ImportResponse | null>;
  getImportStatus: () => Promise<L1ImportStatus | null>;
  getL1Repositories: () => Promise<L1Repository[] | null>;
  deleteL1Repository: (rootHash: string) => Promise<boolean>;
}

export interface ImportConfigStore {
  getAuthorEmail: () => string | null;
  setAuthorEmail: (email: string) => void;
}

export interface ImportDeps {
  io?: ImportIO;
  client?: ImportClient;
  config?: ImportConfigStore;
  /** Poll interval in ms (default 1000). Tests shrink this to keep runs fast. */
  pollIntervalMs?: number;
}

export interface ImportFlags {
  github?: boolean;
  gitlab?: boolean;
  list?: boolean;
  remove?: string;
  url?: string;
}

// ── default IO + config + client (real terminal / fs / network) ──────────────

function configPath(): string {
  const base = process.env.DEVPROFILE_DATA_DIR
    ? join(process.env.DEVPROFILE_DATA_DIR, ".devprofile")
    : join(homedir(), ".devprofile");
  return join(base, "config.json");
}

function readDevProfileConfig(): DevProfileConfig | null {
  const p = configPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as DevProfileConfig;
  } catch {
    return null;
  }
}

function writeDevProfileConfig(cfg: DevProfileConfig): void {
  const p = configPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(cfg, null, 2));
}

export const defaultConfigStore: ImportConfigStore = {
  getAuthorEmail(): string | null {
    return readDevProfileConfig()?.author_email ?? null;
  },
  setAuthorEmail(email: string): void {
    const existing =
      readDevProfileConfig() ?? {
        version: "0.1.0",
        initialized_at: new Date().toISOString(),
        dimensions: { code: true, prompts: true, workflow: true } as DevProfileConfig["dimensions"],
        environments: { claudeCode: false, continueDev: false },
      };
    writeDevProfileConfig({ ...existing, author_email: email });
  },
};

function defaultPrompt(label: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(label, (ans) => {
      rl.close();
      resolve(ans);
    });
  });
}

/** Read a password-style line without echoing it. Falls back to plain prompt
 *  if stdin is not a TTY (e.g. piped input). The captured string is returned
 *  to the caller and should be cleared from memory as soon as it's been used. */
function defaultPromptSecret(label: string): Promise<string> {
  if (!process.stdin.isTTY) return defaultPrompt(label);
  process.stdout.write(label);
  return new Promise((resolve) => {
    let buf = "";
    const onData = (chunk: Buffer): void => {
      const s = chunk.toString("utf8");
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.removeListener("data", onData);
          process.stdin.setRawMode?.(false);
          process.stdin.pause();
          process.stdout.write("\n");
          resolve(buf);
          return;
        }
        const code = ch.charCodeAt(0);
        if (code === 0x03) {  // Ctrl+C
          process.stdout.write("\n");
          process.exit(130);
        }
        if (code === 0x7f || code === 0x08) {  // Backspace / DEL
          if (buf.length > 0) buf = buf.slice(0, -1);
          continue;
        }
        buf += ch;
      }
    };
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

async function defaultConfirm(label: string): Promise<boolean> {
  const ans = (await defaultPrompt(label)).trim().toLowerCase();
  return ans === "s" || ans === "sim" || ans === "y" || ans === "yes";
}

export const defaultIO: ImportIO = {
  prompt: defaultPrompt,
  promptSecret: defaultPromptSecret,
  confirm: defaultConfirm,
  log: (msg) => console.log(msg),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export const defaultClient: ImportClient = {
  importRepository: defaultImportRepository,
  getImportStatus: defaultGetImportStatus,
  getL1Repositories: defaultGetL1Repositories,
  deleteL1Repository: defaultDeleteL1Repository,
};

// ── helpers ──────────────────────────────────────────────────────────────────

function shortHash(h: string): string {
  return h.length > 8 ? h.slice(0, 8) : h;
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

export function formatRepoTable(repos: L1Repository[]): string {
  if (repos.length === 0) return "Nenhum repositório importado.";
  const header = "HASH      DATA DE IMPORT    COMMITS";
  const rows = repos.map((r) => {
    const h = shortHash(r.root_commit_hash).padEnd(10);
    const d = dateOnly(r.imported_at).padEnd(18);
    return `${h}${d}${r.commit_count}`;
  });
  return [header, ...rows].join("\n");
}

async function ensureAuthorEmail(io: ImportIO, cfg: ImportConfigStore): Promise<string> {
  const existing = cfg.getAuthorEmail();
  if (existing) return existing;
  const email = (await io.prompt("Qual o seu email de commit no git? (ex: eduardo@exemplo.com) ")).trim();
  if (!email) throw new Error("Email do git é obrigatório para importar.");
  cfg.setAuthorEmail(email);
  return email;
}

// ── single-repo import pipeline (polling + PAT prompt) ───────────────────────

async function pollUntilTerminal(
  io: ImportIO,
  client: ImportClient,
  pollIntervalMs: number,
): Promise<L1ImportStatus> {
  // Cap the polling time so a stuck engine doesn't hang the CLI forever.
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await io.sleep(pollIntervalMs);
    const s = await client.getImportStatus();
    if (!s) continue;
    if (s.status === "done" || s.status === "error") return s;
  }
  throw new Error("Timeout aguardando ingestão do repositório.");
}

/** Run one repo through the importer + status polling, prompting for a PAT
 *  if the engine reports `needs_pat`. Returns the terminal result. */
async function importOne(
  repoUrl: string,
  authorEmail: string,
  io: ImportIO,
  client: ImportClient,
  pollIntervalMs: number,
): Promise<{ kind: "imported"; commits: number } | { kind: "skipped"; reason: string }> {
  // First attempt — no PAT.
  const accepted = await client.importRepository(repoUrl, authorEmail, null);
  if (!accepted) {
    return { kind: "skipped", reason: "Engine indisponível. Verifique se o daemon está rodando." };
  }

  let terminal = await pollUntilTerminal(io, client, pollIntervalMs);

  // needs_pat → ask for the token and re-submit, then poll again.
  if (terminal.result?.status === "needs_pat") {
    io.log("Autenticação necessária para este repositório.");
    io.log("Gere um token em github.com/settings/tokens (escopo: repo — somente leitura).");
    let pat: string | null = (await io.promptSecret("PAT: ")).trim() || null;
    const reaccepted = await client.importRepository(repoUrl, authorEmail, pat);
    // Discard PAT from local memory immediately after handing it to the engine.
    pat = null;
    if (!reaccepted) {
      return { kind: "skipped", reason: "Falha ao reenviar com token." };
    }
    terminal = await pollUntilTerminal(io, client, pollIntervalMs);
  }

  const r = terminal.result;
  if (!r) return { kind: "skipped", reason: "Resposta vazia do engine." };

  switch (r.status) {
    case "imported":
      io.log(`✓ ${r.commit_count ?? 0} commits importados.`);
      io.log("Adicionado ao L1.");
      return { kind: "imported", commits: r.commit_count ?? 0 };
    case "already_imported":
      io.log(`Repositório já presente no L1 (hash ${shortHash(r.root_commit_hash ?? "")}). Pulando.`);
      return { kind: "skipped", reason: "already_imported" };
    case "author_not_found":
      io.log("Nenhum commit seu encontrado neste repositório. Pulando.");
      return { kind: "skipped", reason: "author_not_found" };
    case "clone_error":
      io.log(`Erro ao acessar o repositório: ${r.detail ?? "desconhecido"}. Verifique a URL e tente novamente.`);
      return { kind: "skipped", reason: "clone_error" };
    case "needs_pat":
      // Reached only if the second attempt still asks for a PAT.
      io.log("Autenticação ainda necessária. Pulando.");
      return { kind: "skipped", reason: "needs_pat" };
    default:
      return { kind: "skipped", reason: `unknown:${String(r.status)}` };
  }
}

// ── public entry point ───────────────────────────────────────────────────────

export async function runImport(flags: ImportFlags, deps: ImportDeps = {}): Promise<void> {
  const io = deps.io ?? defaultIO;
  const client = deps.client ?? defaultClient;
  const config = deps.config ?? defaultConfigStore;
  const pollIntervalMs = deps.pollIntervalMs ?? 1000;

  // --list — render imported repos as a table.
  if (flags.list) {
    const repos = await client.getL1Repositories();
    io.log(formatRepoTable(repos ?? []));
    return;
  }

  // --remove <hash> — confirm + delete one repo.
  if (flags.remove) {
    const hash = flags.remove;
    const confirmed = await io.confirm(
      `Remover repositório ${shortHash(hash)} do L1? Esta ação não pode ser desfeita. [s/N] `,
    );
    if (!confirmed) {
      io.log("Operação cancelada.");
      return;
    }
    const ok = await client.deleteL1Repository(hash);
    io.log(ok ? "Repositório removido do L1." : "Repositório não encontrado.");
    return;
  }

  // For the import flows we need an author email.
  const authorEmail = await ensureAuthorEmail(io, config);

  // --github / --gitlab — provider-driven listing.
  if (flags.github || flags.gitlab) {
    const provider = flags.github ? "github" : "gitlab";
    const urls = await listProviderRepoUrls(provider, io);
    if (urls.length === 0) {
      io.log("Nenhum repositório selecionado.");
      return;
    }
    let importedCount = 0;
    let totalCommits = 0;
    for (const url of urls) {
      io.log(`\n→ ${url}`);
      const r = await importOne(url, authorEmail, io, client, pollIntervalMs);
      if (r.kind === "imported") {
        importedCount += 1;
        totalCommits += r.commits;
      }
    }
    io.log(`\nBootstrap concluído. ${importedCount} repositórios · ${totalCommits} commits analisados.`);
    return;
  }

  // Single-URL invocation: `devprofile import <url>`
  if (flags.url) {
    const r = await importOne(flags.url, authorEmail, io, client, pollIntervalMs);
    const commits = r.kind === "imported" ? r.commits : 0;
    const count = r.kind === "imported" ? 1 : 0;
    io.log(`\nBootstrap concluído. ${count} repositórios · ${commits} commits analisados.`);
    return;
  }

  // Interactive loop.
  let importedCount = 0;
  let totalCommits = 0;
  while (true) {
    const url = (await io.prompt("Informe o repositório (ou Enter para finalizar): ")).trim();
    if (!url) break;
    const r = await importOne(url, authorEmail, io, client, pollIntervalMs);
    if (r.kind === "imported") {
      importedCount += 1;
      totalCommits += r.commits;
    }
  }
  io.log(`\nBootstrap concluído. ${importedCount} repositórios · ${totalCommits} commits analisados.`);
}

// ── provider listing (minimal — delegates auth to gh/glab CLIs) ──────────────

async function listProviderRepoUrls(
  provider: "github" | "gitlab",
  io: ImportIO,
): Promise<string[]> {
  const cmd = provider === "github"
    ? ["gh", "repo", "list", "--limit", "100", "--json", "url,name,primaryLanguage,updatedAt"]
    : ["glab", "repo", "list", "--per-page", "100", "--output", "json"];

  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const exit = await proc.exited;
  if (exit !== 0) {
    io.log(
      `Não foi possível listar repositórios via ${provider === "github" ? "gh" : "glab"} CLI. Faça login (\`${provider === "github" ? "gh auth login" : "glab auth login"}\`) e tente novamente.`,
    );
    return [];
  }

  type GhRepo = { url: string; name: string; primaryLanguage?: { name?: string }; updatedAt?: string };
  type GlabRepo = { web_url: string; name: string; last_activity_at?: string };

  let entries: { url: string; label: string }[] = [];
  try {
    const parsed = JSON.parse(stdout);
    if (provider === "github") {
      entries = (parsed as GhRepo[]).map((r) => ({
        url: r.url,
        label: `${r.name}  (${r.primaryLanguage?.name ?? "—"} · último commit: ${(r.updatedAt ?? "").slice(0, 10)})`,
      }));
    } else {
      entries = (parsed as GlabRepo[]).map((r) => ({
        url: r.web_url,
        label: `${r.name}  (último commit: ${(r.last_activity_at ?? "").slice(0, 10)})`,
      }));
    }
  } catch {
    io.log("Resposta inválida da CLI do provedor.");
    return [];
  }

  if (entries.length === 0) {
    io.log("Nenhum repositório encontrado.");
    return [];
  }

  io.log("Repositórios disponíveis:");
  entries.forEach((e, i) => io.log(`  [${i + 1}] ${e.label}`));
  const sel = (await io.prompt("Quais importar? (ex: 1,3,5 ou 'all') ")).trim();
  if (!sel) return [];

  if (sel.toLowerCase() === "all") return entries.map((e) => e.url);

  const indices = sel
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= entries.length);
  return [...new Set(indices)].map((n) => entries[n - 1].url);
}

import type { HostName, HostToken } from "../types";

// ── IO / spawn injection for testability ────────────────────────────────────

/** Result of running an auth-helper CLI (`gh auth token`, `glab auth token`). */
export interface SpawnResult {
  exit: number;
  stdout: string;
}

export interface HostAuthDeps {
  /** Run a command and capture its stdout. Tests stub this. */
  spawn: (cmd: string[]) => Promise<SpawnResult>;
  /** Plain-echo prompt (used for usernames). */
  prompt: (label: string) => Promise<string>;
  /** No-echo prompt (used for tokens / app passwords). */
  promptSecret: (label: string) => Promise<string>;
  /** Print user-facing line. */
  log: (msg: string) => void;
  /** Read previously-cached Bitbucket username (public id — safe to persist). */
  getCachedBitbucketUsername?: () => string | null;
  /** Persist the Bitbucket username so the user doesn't retype it. */
  setCachedBitbucketUsername?: (username: string) => void;
}

// ── default impls — wired to Bun.spawn + readline by the import command ─────

async function defaultSpawn(cmd: string[]): Promise<SpawnResult> {
  try {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    return { exit, stdout };
  } catch {
    // command not found → treat as failed exit
    return { exit: 127, stdout: "" };
  }
}

// ── error type for clean handling upstream ──────────────────────────────────

export class HostAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostAuthError";
  }
}

// ── per-host resolvers ──────────────────────────────────────────────────────

async function resolveGitHub(deps: HostAuthDeps): Promise<HostToken> {
  const cli = await deps.spawn(["gh", "auth", "token"]);
  if (cli.exit === 0) {
    const token = cli.stdout.trim();
    if (token) return { method: "cli", token, host: "github" };
  }

  deps.log("Token GitHub não encontrado. Gere em: github.com/settings/tokens");
  deps.log("Escopos necessários: repo (somente leitura)");
  const token = (await deps.promptSecret("PAT: ")).trim();
  if (!token) {
    throw new HostAuthError("Nenhum token informado. Operação cancelada.");
  }
  return { method: "pat", token, host: "github" };
}

async function resolveGitLab(deps: HostAuthDeps): Promise<HostToken> {
  const cli = await deps.spawn(["glab", "auth", "token"]);
  if (cli.exit === 0) {
    const token = cli.stdout.trim();
    if (token) return { method: "cli", token, host: "gitlab" };
  }

  deps.log(
    "Token GitLab não encontrado. Gere em: gitlab.com/-/user_settings/personal_access_tokens",
  );
  deps.log("Escopos necessários: read_api");
  const token = (await deps.promptSecret("PAT: ")).trim();
  if (!token) {
    throw new HostAuthError("Nenhum token informado. Operação cancelada.");
  }
  return { method: "pat", token, host: "gitlab" };
}

async function resolveBitbucket(deps: HostAuthDeps): Promise<HostToken> {
  deps.log("Bitbucket usa App Passwords para acesso à API.");
  deps.log("Gere em: bitbucket.org/account/settings/app-passwords");
  deps.log("Permissões necessárias: Repositories — Read");

  const cached = deps.getCachedBitbucketUsername?.() ?? null;
  const label = cached
    ? `Usuário Bitbucket [${cached}]: `
    : "Usuário Bitbucket: ";
  const entered = (await deps.prompt(label)).trim();
  const username = entered || cached || "";
  if (!username) {
    throw new HostAuthError("Usuário Bitbucket é obrigatório.");
  }
  if (username !== cached) {
    deps.setCachedBitbucketUsername?.(username);
  }

  const app_password = (await deps.promptSecret("App Password: ")).trim();
  if (!app_password) {
    throw new HostAuthError("App Password é obrigatório.");
  }

  return { method: "app_password", username, app_password, host: "bitbucket" };
}

// ── public entry point ──────────────────────────────────────────────────────

export async function resolveListingToken(
  host: HostName,
  deps: Partial<HostAuthDeps> & {
    prompt: HostAuthDeps["prompt"];
    promptSecret: HostAuthDeps["promptSecret"];
    log: HostAuthDeps["log"];
  },
): Promise<HostToken> {
  const filled: HostAuthDeps = {
    spawn: deps.spawn ?? defaultSpawn,
    prompt: deps.prompt,
    promptSecret: deps.promptSecret,
    log: deps.log,
    getCachedBitbucketUsername: deps.getCachedBitbucketUsername,
    setCachedBitbucketUsername: deps.setCachedBitbucketUsername,
  };

  switch (host) {
    case "github":
      return resolveGitHub(filled);
    case "gitlab":
      return resolveGitLab(filled);
    case "bitbucket":
      return resolveBitbucket(filled);
  }
}

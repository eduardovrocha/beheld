import type { HostName, RemoteRepo } from "../types";

// ── shared types + errors ───────────────────────────────────────────────────

const MAX_PAGES = 10;
const PAGE_TIMEOUT_MS = 15_000;

export class HostListError extends Error {
  constructor(
    message: string,
    public readonly host: HostName,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "HostListError";
  }
}

export interface HostListDeps {
  fetch?: typeof fetch;
  /** Per-page timeout. Tests shrink this to keep the suite fast. */
  pageTimeoutMs?: number;
  /** Cap on pages walked. Tests set this lower to exercise the cap path. */
  maxPages?: number;
}

interface ResolvedDeps {
  fetch: typeof fetch;
  pageTimeoutMs: number;
  maxPages: number;
}

function resolve(deps?: HostListDeps): ResolvedDeps {
  return {
    fetch: deps?.fetch ?? globalThis.fetch.bind(globalThis),
    pageTimeoutMs: deps?.pageTimeoutMs ?? PAGE_TIMEOUT_MS,
    maxPages: deps?.maxPages ?? MAX_PAGES,
  };
}

// ── one fetch with timeout + uniform error mapping ──────────────────────────

async function fetchPage(
  url: string,
  init: RequestInit,
  host: HostName,
  deps: ResolvedDeps,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.pageTimeoutMs);
  let res: Response;
  try {
    res = await deps.fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new HostListError("Tempo esgotado ao listar repositórios.", host);
    }
    throw new HostListError(
      `Erro de rede ao contatar ${host}: ${(err as Error).message}`,
      host,
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.ok) return res;

  switch (res.status) {
    case 401:
      throw new HostListError(
        "Credenciais inválidas. Verifique o token e tente novamente.",
        host,
        401,
      );
    case 403:
      throw new HostListError(
        "Permissão insuficiente. Verifique os escopos do token.",
        host,
        403,
      );
    case 404:
      throw new HostListError("Usuário não encontrado.", host, 404);
    case 429:
      throw new HostListError(
        "Limite de requisições atingido. Aguarde alguns minutos.",
        host,
        429,
      );
    default:
      if (res.status >= 500) {
        throw new HostListError(
          `Erro no servidor do ${host}. Tente novamente mais tarde.`,
          host,
          res.status,
        );
      }
      throw new HostListError(
        `Resposta inesperada do ${host} (HTTP ${res.status}).`,
        host,
        res.status,
      );
  }
}

// ── GitHub ──────────────────────────────────────────────────────────────────

interface GitHubItem {
  full_name: string;
  clone_url: string;
  ssh_url: string;
  language: string | null;
  pushed_at: string;
  private: boolean;
}

export async function fetchGitHubRepos(
  token: string,
  deps?: HostListDeps,
): Promise<RemoteRepo[]> {
  const r = resolve(deps);
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const out: RemoteRepo[] = [];
  for (let page = 1; page <= r.maxPages; page++) {
    const url =
      "https://api.github.com/user/repos" +
      `?per_page=100&page=${page}&type=owner&sort=pushed&direction=desc`;
    const res = await fetchPage(url, { headers }, "github", r);
    const items = (await res.json()) as GitHubItem[];
    for (const it of items) {
      out.push({
        full_name: it.full_name,
        clone_url_https: it.clone_url,
        clone_url_ssh: it.ssh_url,
        language: it.language,
        last_pushed_at: it.pushed_at,
        is_private: it.private,
      });
    }
    if (items.length < 100) return out;
  }
  return out; // hit MAX_PAGES — caller may warn
}

// ── GitLab ──────────────────────────────────────────────────────────────────

interface GitLabItem {
  path_with_namespace: string;
  http_url_to_repo: string;
  ssh_url_to_repo: string;
  last_activity_at: string;
  visibility: string;
}

export async function fetchGitLabRepos(
  token: string,
  deps?: HostListDeps,
): Promise<RemoteRepo[]> {
  const r = resolve(deps);
  const headers = { "PRIVATE-TOKEN": token };

  const out: RemoteRepo[] = [];
  let page = 1;
  while (page <= r.maxPages) {
    const url =
      "https://gitlab.com/api/v4/projects" +
      `?membership=true&per_page=100&page=${page}&order_by=last_activity_at&sort=desc`;
    const res = await fetchPage(url, { headers }, "gitlab", r);
    const items = (await res.json()) as GitLabItem[];
    for (const it of items) {
      out.push({
        full_name: it.path_with_namespace,
        clone_url_https: it.http_url_to_repo,
        clone_url_ssh: it.ssh_url_to_repo,
        language: null,
        last_pushed_at: it.last_activity_at,
        is_private: it.visibility !== "public",
      });
    }
    const next = res.headers.get("X-Next-Page") ?? res.headers.get("x-next-page");
    if (!next || next.trim() === "") return out;
    const parsed = parseInt(next, 10);
    if (!Number.isFinite(parsed) || parsed <= page) return out;
    page = parsed;
  }
  return out;
}

// ── Bitbucket ───────────────────────────────────────────────────────────────

interface BitbucketCloneLink {
  name: string;
  href: string;
}
interface BitbucketItem {
  full_name: string;
  language: string | null;
  updated_on: string;
  is_private: boolean;
  links: { clone: BitbucketCloneLink[] };
}
interface BitbucketPage {
  values: BitbucketItem[];
  next?: string;
}

export async function fetchBitbucketRepos(
  username: string,
  app_password: string,
  deps?: HostListDeps,
): Promise<RemoteRepo[]> {
  const r = resolve(deps);
  const basic = btoa(`${username}:${app_password}`);
  const headers = {
    Authorization: `Basic ${basic}`,
    Accept: "application/json",
  };

  const out: RemoteRepo[] = [];
  let url: string | null =
    `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(username)}` +
    `?role=member&pagelen=100&sort=-updated_on`;
  for (let page = 0; page < r.maxPages && url; page++) {
    const res = await fetchPage(url, { headers }, "bitbucket", r);
    const body = (await res.json()) as BitbucketPage;
    for (const it of body.values ?? []) {
      const links = it.links?.clone ?? [];
      const https = links.find((l) => l.name === "https")?.href ?? "";
      const ssh = links.find((l) => l.name === "ssh")?.href ?? "";
      out.push({
        full_name: it.full_name,
        clone_url_https: https,
        clone_url_ssh: ssh,
        language: it.language ?? null,
        last_pushed_at: it.updated_on,
        is_private: it.is_private,
      });
    }
    url = body.next ?? null;
  }
  return out;
}

// ── unified dispatch (used by import-host orchestrator) ─────────────────────

export async function fetchHostRepos(
  host: HostName,
  cred:
    | { method: "cli" | "pat"; token: string }
    | { method: "app_password"; username: string; app_password: string },
  deps?: HostListDeps,
): Promise<RemoteRepo[]> {
  if (host === "bitbucket") {
    if (cred.method !== "app_password") {
      throw new HostListError(
        "Bitbucket requer username + app password.",
        "bitbucket",
      );
    }
    return fetchBitbucketRepos(cred.username, cred.app_password, deps);
  }
  if (cred.method === "app_password") {
    throw new HostListError(
      `${host} não usa app password.`,
      host,
    );
  }
  return host === "github"
    ? fetchGitHubRepos(cred.token, deps)
    : fetchGitLabRepos(cred.token, deps);
}

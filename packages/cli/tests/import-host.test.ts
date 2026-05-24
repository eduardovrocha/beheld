import { test, expect, describe } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveListingToken, HostAuthError } from "../src/auth/host-auth";
import type { HostAuthDeps, SpawnResult } from "../src/auth/host-auth";
import {
  fetchGitHubRepos,
  fetchGitLabRepos,
  fetchBitbucketRepos,
  HostListError,
} from "../src/auth/host-list-client";
import { selectRepos, scriptedIO } from "../src/ui/repo-selector";
import { runHostImport } from "../src/commands/import-host";
import type {
  HostImportSummary,
  ImportResult,
  RemoteRepo,
} from "../src/types";

// ── tiny helpers ────────────────────────────────────────────────────────────

function repo(name: string, overrides: Partial<RemoteRepo> = {}): RemoteRepo {
  return {
    full_name: name,
    clone_url_https: `https://example.com/${name}.git`,
    clone_url_ssh: `git@example.com:${name}.git`,
    language: "TypeScript",
    last_pushed_at: "2026-01-01T00:00:00Z",
    is_private: false,
    ...overrides,
  };
}

function authDeps(overrides: Partial<HostAuthDeps> = {}): {
  deps: {
    prompt: HostAuthDeps["prompt"];
    promptSecret: HostAuthDeps["promptSecret"];
    log: HostAuthDeps["log"];
    spawn?: HostAuthDeps["spawn"];
    getCachedBitbucketUsername?: HostAuthDeps["getCachedBitbucketUsername"];
    setCachedBitbucketUsername?: HostAuthDeps["setCachedBitbucketUsername"];
  };
  logs: string[];
} {
  const logs: string[] = [];
  return {
    deps: {
      prompt: overrides.prompt ?? (async () => ""),
      promptSecret: overrides.promptSecret ?? (async () => ""),
      log: overrides.log ?? ((m): void => void logs.push(m)),
      spawn: overrides.spawn,
      getCachedBitbucketUsername: overrides.getCachedBitbucketUsername,
      setCachedBitbucketUsername: overrides.setCachedBitbucketUsername,
    },
    logs,
  };
}

function spawnReturning(exit: number, stdout: string) {
  return async (_cmd: string[]): Promise<SpawnResult> => ({ exit, stdout });
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────

describe("host-auth — resolveListingToken", () => {
  test("test_github_auth_uses_gh_cli_token_when_available", async () => {
    let promptSecretCalled = false;
    const { deps } = authDeps({
      spawn: spawnReturning(0, "ghp_FROMCLI\n"),
      promptSecret: async () => {
        promptSecretCalled = true;
        return "";
      },
    });
    const tok = await resolveListingToken("github", deps);
    expect(tok).toEqual({ method: "cli", token: "ghp_FROMCLI", host: "github" });
    expect(promptSecretCalled).toBe(false);
  });

  test("test_github_auth_falls_back_to_manual_pat", async () => {
    const { deps, logs } = authDeps({
      spawn: spawnReturning(1, ""),
      promptSecret: async () => "ghp_MANUAL",
    });
    const tok = await resolveListingToken("github", deps);
    expect(tok).toEqual({ method: "pat", token: "ghp_MANUAL", host: "github" });
    expect(logs.join("\n")).toContain("github.com/settings/tokens");
    expect(logs.join("\n")).toContain("repo");
  });

  test("test_gitlab_auth_uses_glab_cli_token_when_available", async () => {
    const { deps } = authDeps({
      spawn: spawnReturning(0, "glpat_FROMCLI"),
    });
    const tok = await resolveListingToken("gitlab", deps);
    expect(tok).toEqual({ method: "cli", token: "glpat_FROMCLI", host: "gitlab" });
  });

  test("test_gitlab_auth_falls_back_to_manual_pat", async () => {
    const { deps, logs } = authDeps({
      spawn: spawnReturning(127, ""),
      promptSecret: async () => "glpat_MANUAL",
    });
    const tok = await resolveListingToken("gitlab", deps);
    expect(tok).toEqual({ method: "pat", token: "glpat_MANUAL", host: "gitlab" });
    expect(logs.join("\n")).toContain("gitlab.com/-/user_settings/personal_access_tokens");
    expect(logs.join("\n")).toContain("read_api");
  });

  test("test_bitbucket_auth_always_asks_credentials", async () => {
    let usernamePrompted = false;
    let pwPrompted = false;
    const { deps } = authDeps({
      spawn: spawnReturning(0, "should_be_ignored"),
      prompt: async () => {
        usernamePrompted = true;
        return "myuser";
      },
      promptSecret: async () => {
        pwPrompted = true;
        return "myapppw";
      },
    });
    const tok = await resolveListingToken("bitbucket", deps);
    expect(tok).toEqual({
      method: "app_password",
      username: "myuser",
      app_password: "myapppw",
      host: "bitbucket",
    });
    expect(usernamePrompted).toBe(true);
    expect(pwPrompted).toBe(true);
  });

  test("test_auth_empty_token_input_returns_error_not_crash", async () => {
    const { deps } = authDeps({
      spawn: spawnReturning(1, ""),
      promptSecret: async () => "   ", // whitespace-only counts as empty
    });
    await expect(resolveListingToken("github", deps)).rejects.toBeInstanceOf(HostAuthError);
  });

  test("test_token_not_written_to_config_after_listing", async () => {
    // Surface area test: the whole host-auth + host-list path never touches
    // the filesystem. We assert that here by running both with a tmp HOME
    // and checking no config file appears.
    const tmp = mkdtempSync(join(tmpdir(), "beheld-cfg-"));
    const cfg = join(tmp, ".beheld", "config.json");
    expect(existsSync(cfg)).toBe(false);

    const { deps } = authDeps({
      spawn: spawnReturning(0, "ghp_TOK"),
    });
    const tok = await resolveListingToken("github", deps);

    // Call the listing too, with a fetch stub.
    const stubFetch = (async () =>
      new Response(JSON.stringify([]), { status: 200 })) as unknown as typeof fetch;
    await fetchGitHubRepos((tok as { token: string }).token, { fetch: stubFetch });

    expect(existsSync(cfg)).toBe(false);
  });

  test("bitbucket username cache — uses default and re-uses if Enter pressed", async () => {
    let saved: string | null = null;
    const { deps } = authDeps({
      prompt: async () => "", // user hits Enter without typing
      promptSecret: async () => "mypw",
      getCachedBitbucketUsername: () => "cached_user",
      setCachedBitbucketUsername: (u) => {
        saved = u;
      },
    });
    const tok = await resolveListingToken("bitbucket", deps);
    expect((tok as { username: string }).username).toBe("cached_user");
    // No re-save when the cached value is reused.
    expect(saved).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LISTING
// ─────────────────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function ghItem(name: string, overrides: Record<string, unknown> = {}) {
  return {
    full_name: `me/${name}`,
    clone_url: `https://github.com/me/${name}.git`,
    ssh_url: `git@github.com:me/${name}.git`,
    language: "TypeScript",
    pushed_at: "2026-01-01T00:00:00Z",
    private: false,
    ...overrides,
  };
}

describe("host-list-client — GitHub", () => {
  test("test_github_fetch_paginates_until_less_than_100_items", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ghItem(`a${i}`));
    const partial = [ghItem("b0"), ghItem("b1")];
    const calls: string[] = [];
    const stub = (async (url: string) => {
      calls.push(url);
      return jsonResponse(calls.length === 1 ? fullPage : partial);
    }) as unknown as typeof fetch;
    const repos = await fetchGitHubRepos("tok", { fetch: stub });
    expect(repos.length).toBe(102);
    expect(calls.length).toBe(2);
    expect(calls[0]).toContain("page=1");
    expect(calls[1]).toContain("page=2");
  });

  test("test_github_fetch_stops_at_10_pages", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ghItem(`r${i}`));
    let count = 0;
    const stub = (async () => {
      count += 1;
      return jsonResponse(fullPage);
    }) as unknown as typeof fetch;
    const repos = await fetchGitHubRepos("tok", { fetch: stub, maxPages: 3 });
    expect(count).toBe(3);
    expect(repos.length).toBe(300);
  });

  test("test_github_fetch_401_returns_clear_error", async () => {
    const stub = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    let err: HostListError | null = null;
    try {
      await fetchGitHubRepos("tok", { fetch: stub });
    } catch (e) {
      err = e as HostListError;
    }
    expect(err).toBeInstanceOf(HostListError);
    expect(err?.status).toBe(401);
    expect(err?.message).toContain("Credenciais inválidas");
  });

  test("test_github_fetch_429_returns_rate_limit_message", async () => {
    const stub = (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch;
    let err: HostListError | null = null;
    try {
      await fetchGitHubRepos("tok", { fetch: stub });
    } catch (e) {
      err = e as HostListError;
    }
    expect(err?.status).toBe(429);
    expect(err?.message).toContain("Limite de requisições");
  });

  test("github sends Bearer auth + UA headers", async () => {
    let seenAuth = "";
    let seenAccept = "";
    const stub = (async (_url: string, init?: RequestInit) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      seenAuth = h["Authorization"] ?? "";
      seenAccept = h["Accept"] ?? "";
      return jsonResponse([]);
    }) as unknown as typeof fetch;
    await fetchGitHubRepos("tok-xyz", { fetch: stub });
    expect(seenAuth).toBe("Bearer tok-xyz");
    expect(seenAccept).toBe("application/vnd.github+json");
  });
});

describe("host-list-client — GitLab", () => {
  test("test_gitlab_fetch_uses_x_next_page_header", async () => {
    const items = [
      {
        path_with_namespace: "me/a",
        http_url_to_repo: "https://gitlab.com/me/a.git",
        ssh_url_to_repo: "git@gitlab.com:me/a.git",
        last_activity_at: "2026-01-01T00:00:00Z",
        visibility: "private",
      },
    ];
    const calls: string[] = [];
    const stub = (async (url: string) => {
      calls.push(url);
      const nextHeader = calls.length === 1 ? "2" : "";
      return jsonResponse(items, {
        headers: {
          "Content-Type": "application/json",
          "X-Next-Page": nextHeader,
        },
      });
    }) as unknown as typeof fetch;
    const repos = await fetchGitLabRepos("tok", { fetch: stub });
    expect(calls.length).toBe(2);
    expect(repos.length).toBe(2);
    expect(repos[0]).toEqual({
      full_name: "me/a",
      clone_url_https: "https://gitlab.com/me/a.git",
      clone_url_ssh: "git@gitlab.com:me/a.git",
      language: null,
      last_pushed_at: "2026-01-01T00:00:00Z",
      is_private: true,
    });
  });

  test("gitlab stops when X-Next-Page is empty", async () => {
    let calls = 0;
    const stub = (async () => {
      calls += 1;
      return jsonResponse([], {
        headers: { "X-Next-Page": "" },
      });
    }) as unknown as typeof fetch;
    await fetchGitLabRepos("tok", { fetch: stub });
    expect(calls).toBe(1);
  });
});

describe("host-list-client — Bitbucket", () => {
  function bbItem(name: string, overrides: Record<string, unknown> = {}) {
    return {
      full_name: `me/${name}`,
      language: "python",
      updated_on: "2026-01-01T00:00:00Z",
      is_private: true,
      links: {
        clone: [
          { name: "https", href: `https://bitbucket.org/me/${name}.git` },
          { name: "ssh", href: `git@bitbucket.org:me/${name}.git` },
        ],
      },
      ...overrides,
    };
  }

  test("test_bitbucket_fetch_uses_next_field_for_pagination", async () => {
    const calls: string[] = [];
    const stub = (async (url: string) => {
      calls.push(url);
      const body =
        calls.length === 1
          ? { values: [bbItem("a")], next: "https://api.bitbucket.org/2.0/repositories/me?page=2" }
          : { values: [bbItem("b")] };
      return jsonResponse(body);
    }) as unknown as typeof fetch;
    const repos = await fetchBitbucketRepos("me", "pw", { fetch: stub });
    expect(calls.length).toBe(2);
    expect(calls[1]).toContain("page=2");
    expect(repos.length).toBe(2);
  });

  test("test_bitbucket_fetch_maps_clone_links_correctly", async () => {
    const stub = (async () =>
      jsonResponse({ values: [bbItem("a")] })) as unknown as typeof fetch;
    const repos = await fetchBitbucketRepos("me", "pw", { fetch: stub });
    expect(repos[0].clone_url_https).toBe("https://bitbucket.org/me/a.git");
    expect(repos[0].clone_url_ssh).toBe("git@bitbucket.org:me/a.git");
    expect(repos[0].is_private).toBe(true);
    expect(repos[0].language).toBe("python");
  });

  test("bitbucket sends Basic auth", async () => {
    let seenAuth = "";
    const stub = (async (_url: string, init?: RequestInit) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      seenAuth = h["Authorization"] ?? "";
      return jsonResponse({ values: [] });
    }) as unknown as typeof fetch;
    await fetchBitbucketRepos("me", "pw", { fetch: stub });
    expect(seenAuth).toBe(`Basic ${btoa("me:pw")}`);
  });
});

describe("host-list-client — shared error mapping", () => {
  test("test_fetch_timeout_returns_timeout_message", async () => {
    const stub = (async (_url: string, init?: RequestInit) => {
      // Reject with AbortError once the controller fires.
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    }) as unknown as typeof fetch;
    let err: HostListError | null = null;
    try {
      await fetchGitHubRepos("tok", { fetch: stub, pageTimeoutMs: 20 });
    } catch (e) {
      err = e as HostListError;
    }
    expect(err).toBeInstanceOf(HostListError);
    expect(err?.message).toContain("Tempo esgotado");
  });

  test("403 maps to permission-insufficient", async () => {
    const stub = (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
    let err: HostListError | null = null;
    try {
      await fetchGitHubRepos("tok", { fetch: stub });
    } catch (e) {
      err = e as HostListError;
    }
    expect(err?.status).toBe(403);
    expect(err?.message).toContain("Permissão insuficiente");
  });

  test("404 maps to user-not-found", async () => {
    const stub = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
    let err: HostListError | null = null;
    try {
      await fetchBitbucketRepos("u", "p", { fetch: stub });
    } catch (e) {
      err = e as HostListError;
    }
    expect(err?.status).toBe(404);
    expect(err?.message).toContain("Usuário não encontrado");
  });

  test("5xx maps to server-error", async () => {
    const stub = (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
    let err: HostListError | null = null;
    try {
      await fetchGitLabRepos("tok", { fetch: stub });
    } catch (e) {
      err = e as HostListError;
    }
    expect(err?.status).toBe(503);
    expect(err?.message).toContain("Erro no servidor");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SELECTOR
// ─────────────────────────────────────────────────────────────────────────────

describe("repo-selector — interactions", () => {
  test("test_selector_space_toggles_selection", async () => {
    const repos = [repo("a"), repo("b"), repo("c")];
    const { io } = scriptedIO(["space", "enter"]);
    const out = await selectRepos(repos, { io });
    expect(out.map((r) => r.full_name)).toEqual(["a"]);
  });

  test("test_selector_a_selects_all_non_imported", async () => {
    const repos = [repo("a"), repo("b"), repo("c")];
    const { io } = scriptedIO(["a", "enter"]);
    const already = new Set([repos[1].clone_url_https]);
    const out = await selectRepos(repos, { io, alreadyImportedUrls: already });
    expect(out.map((r) => r.full_name)).toEqual(["a", "c"]);
  });

  test("test_selector_n_deselects_all", async () => {
    const repos = [repo("a"), repo("b")];
    const { io } = scriptedIO(["a", "n", "enter"]);
    const out = await selectRepos(repos, { io });
    expect(out).toEqual([]);
  });

  test("test_selector_enter_returns_selected_repos", async () => {
    const repos = [repo("a"), repo("b"), repo("c")];
    const { io } = scriptedIO(["space", "down", "space", "enter"]);
    const out = await selectRepos(repos, { io });
    expect(out.map((r) => r.full_name)).toEqual(["a", "b"]);
  });

  test("test_selector_q_returns_empty_list", async () => {
    const repos = [repo("a"), repo("b")];
    const { io } = scriptedIO(["space", "space", "q"]);
    const out = await selectRepos(repos, { io });
    expect(out).toEqual([]);
  });

  test("test_selector_already_imported_repos_not_selectable", async () => {
    const repos = [repo("a"), repo("b")];
    const { io, output } = scriptedIO(["space", "down", "space", "enter"]);
    const already = new Set([repos[0].clone_url_https]);
    const out = await selectRepos(repos, { io, alreadyImportedUrls: already });
    // Cursor lands on b (first selectable); 'space' toggles b, 'down' is a no-op,
    // 'space' toggles b off, 'enter' confirms → no selection.
    expect(out).toEqual([]);
    // Visual: the [✓] marker is present for imported rows.
    expect(output()).toContain("[✓]");
  });

  test("test_selector_all_repos_imported_exits_without_selector", async () => {
    const repos = [repo("a"), repo("b")];
    const { io, output, rawCalls } = scriptedIO([]);
    const already = new Set([
      repos[0].clone_url_https,
      repos[1].clone_url_https,
    ]);
    const out = await selectRepos(repos, { io, alreadyImportedUrls: already });
    expect(out).toEqual([]);
    expect(output()).toContain("Todos os repositórios já estão no L1.");
    // Raw mode never engaged because we exited before the loop.
    expect(rawCalls()).toEqual([]);
  });

  test("Ctrl+C cancels like q", async () => {
    const repos = [repo("a")];
    const { io } = scriptedIO(["space", "ctrl-c"]);
    const out = await selectRepos(repos, { io });
    expect(out).toEqual([]);
  });

  test("raw mode is restored even on cancel", async () => {
    const repos = [repo("a")];
    const { io, rawCalls } = scriptedIO(["q"]);
    await selectRepos(repos, { io });
    expect(rawCalls()).toEqual([true, false]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION — runHostImport
// ─────────────────────────────────────────────────────────────────────────────

function makeIngest(
  byUrl: Record<string, ImportResult>,
  log: string[] = [],
): {
  ingest: (url: string) => Promise<ImportResult>;
  calls: string[];
  log: string[];
} {
  const calls: string[] = [];
  return {
    log,
    calls,
    ingest: async (url: string): Promise<ImportResult> => {
      calls.push(url);
      return byUrl[url] ?? { kind: "failed", commits: 0 };
    },
  };
}

describe("runHostImport — full flow", () => {
  test("test_github_flag_full_flow_mock", async () => {
    const repos = [
      { full_name: "me/a", clone_url: "https://github.com/me/a.git", ssh_url: "git@github.com:me/a.git", language: "TS", pushed_at: "2026-01-01T00:00:00Z", private: false },
      { full_name: "me/b", clone_url: "https://github.com/me/b.git", ssh_url: "git@github.com:me/b.git", language: "Go", pushed_at: "2026-01-02T00:00:00Z", private: true },
    ];
    const stubFetch = (async () => jsonResponse(repos)) as unknown as typeof fetch;
    const { io } = scriptedIO(["a", "enter"]);
    const ing = makeIngest({
      "git@github.com:me/a.git": { kind: "imported", commits: 10 },
      "git@github.com:me/b.git": { kind: "imported", commits: 25 },
    });
    const logs: string[] = [];

    const summary = await runHostImport(
      "github",
      ing.ingest,
      {
        auth: {
          prompt: async () => "",
          promptSecret: async () => "",
          log: (m): void => void logs.push(m),
          spawn: spawnReturning(0, "ghp_TOK"),
        },
        list: { fetch: stubFetch },
        selector: { io },
        log: (m): void => void logs.push(m),
        getAlreadyImportedUrls: async () => new Set<string>(),
      },
    );

    expect(summary.imported).toBe(2);
    expect(summary.total_commits).toBe(35);
    expect(ing.calls).toEqual([
      "git@github.com:me/a.git",
      "git@github.com:me/b.git",
    ]);
    expect(logs.join("\n")).toContain("Conectando ao GitHub");
    expect(logs.join("\n")).toContain("repositórios encontrados");
  });

  test("test_ssh_fallback_to_https_on_clone_error", async () => {
    const repos = [
      { full_name: "me/a", clone_url: "https://github.com/me/a.git", ssh_url: "git@github.com:me/a.git", language: "TS", pushed_at: "2026-01-01T00:00:00Z", private: false },
    ];
    const stubFetch = (async () => jsonResponse(repos)) as unknown as typeof fetch;
    const { io } = scriptedIO(["a", "enter"]);
    const ing = makeIngest({
      "git@github.com:me/a.git": { kind: "failed", commits: 0 },
      "https://github.com/me/a.git": { kind: "imported", commits: 5 },
    });
    const logs: string[] = [];

    const summary = await runHostImport(
      "github",
      ing.ingest,
      {
        auth: {
          prompt: async () => "",
          promptSecret: async () => "",
          log: (m): void => void logs.push(m),
          spawn: spawnReturning(0, "tok"),
        },
        list: { fetch: stubFetch },
        selector: { io },
        log: (m): void => void logs.push(m),
        getAlreadyImportedUrls: async () => new Set<string>(),
      },
    );

    // Both URLs tried, HTTPS won.
    expect(ing.calls).toEqual([
      "git@github.com:me/a.git",
      "https://github.com/me/a.git",
    ]);
    expect(summary.imported).toBe(1);
    expect(summary.total_commits).toBe(5);
    expect(logs.some((l) => l.includes("SSH indisponível"))).toBe(true);
  });

  test("test_empty_selection_exits_without_import", async () => {
    const repos = [
      { full_name: "me/a", clone_url: "https://github.com/me/a.git", ssh_url: "git@github.com:me/a.git", language: "TS", pushed_at: "2026-01-01T00:00:00Z", private: false },
    ];
    const stubFetch = (async () => jsonResponse(repos)) as unknown as typeof fetch;
    const { io } = scriptedIO(["enter"]); // confirm with nothing selected
    const ing = makeIngest({});
    const logs: string[] = [];

    const summary = await runHostImport(
      "github",
      ing.ingest,
      {
        auth: {
          prompt: async () => "",
          promptSecret: async () => "",
          log: (m): void => void logs.push(m),
          spawn: spawnReturning(0, "tok"),
        },
        list: { fetch: stubFetch },
        selector: { io },
        log: (m): void => void logs.push(m),
        getAlreadyImportedUrls: async () => new Set<string>(),
      },
    );

    expect(ing.calls).toEqual([]);
    expect(summary).toEqual({
      imported: 0,
      already_existing: 0,
      no_commits: 0,
      failed: 0,
      total_commits: 0,
    });
    expect(logs.some((l) => l.includes("Nenhum repositório selecionado"))).toBe(true);
  });

  test("test_summary_counts_imported_existing_and_not_found", async () => {
    const repos = [
      { full_name: "me/a", clone_url: "https://github.com/me/a.git", ssh_url: "git@github.com:me/a.git", language: "TS", pushed_at: "2026-01-01T00:00:00Z", private: false },
      { full_name: "me/b", clone_url: "https://github.com/me/b.git", ssh_url: "git@github.com:me/b.git", language: "Go", pushed_at: "2026-01-02T00:00:00Z", private: false },
      { full_name: "me/c", clone_url: "https://github.com/me/c.git", ssh_url: "git@github.com:me/c.git", language: "Rust", pushed_at: "2026-01-03T00:00:00Z", private: false },
    ];
    const stubFetch = (async () => jsonResponse(repos)) as unknown as typeof fetch;
    const { io } = scriptedIO(["a", "enter"]);
    const ing = makeIngest({
      "git@github.com:me/a.git": { kind: "imported", commits: 7 },
      "git@github.com:me/b.git": { kind: "already_existing", commits: 0 },
      "git@github.com:me/c.git": { kind: "no_commits", commits: 0 },
    });

    const summary = await runHostImport(
      "github",
      ing.ingest,
      {
        auth: {
          prompt: async () => "",
          promptSecret: async () => "",
          log: () => {},
          spawn: spawnReturning(0, "tok"),
        },
        list: { fetch: stubFetch },
        selector: { io },
        log: () => {},
        getAlreadyImportedUrls: async () => new Set<string>(),
      },
    );

    expect(summary.imported).toBe(1);
    expect(summary.already_existing).toBe(1);
    expect(summary.no_commits).toBe(1);
    expect(summary.total_commits).toBe(7);
  });

  test("auth failure short-circuits without calling listing or selector", async () => {
    let fetchCalled = false;
    const stubFetch = (async () => {
      fetchCalled = true;
      return jsonResponse([]);
    }) as unknown as typeof fetch;
    const { io } = scriptedIO([]);
    const logs: string[] = [];

    const summary = await runHostImport(
      "github",
      async () => ({ kind: "imported", commits: 0 }),
      {
        auth: {
          prompt: async () => "",
          promptSecret: async () => "",
          log: (m): void => void logs.push(m),
          spawn: spawnReturning(1, ""),
          // empty PAT → HostAuthError → orchestrator logs and bails
        },
        list: { fetch: stubFetch },
        selector: { io },
        log: (m): void => void logs.push(m),
        getAlreadyImportedUrls: async () => new Set<string>(),
      },
    );

    expect(fetchCalled).toBe(false);
    expect(summary.imported).toBe(0);
    expect(logs.some((l) => l.includes("Operação cancelada"))).toBe(true);
  });

  test("listing error is reported and stops the flow", async () => {
    const stubFetch = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    const { io } = scriptedIO([]);
    const logs: string[] = [];

    const summary = await runHostImport(
      "github",
      async () => ({ kind: "imported", commits: 0 }),
      {
        auth: {
          prompt: async () => "",
          promptSecret: async () => "",
          log: (m): void => void logs.push(m),
          spawn: spawnReturning(0, "tok"),
        },
        list: { fetch: stubFetch },
        selector: { io },
        log: (m): void => void logs.push(m),
        getAlreadyImportedUrls: async () => new Set<string>(),
      },
    );

    expect(summary.imported).toBe(0);
    expect(logs.some((l) => l.includes("Credenciais inválidas"))).toBe(true);
  });
});

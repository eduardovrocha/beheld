import { resolveListingToken } from "../auth/host-auth";
import type { HostAuthDeps } from "../auth/host-auth";
import {
  fetchHostRepos,
  HostListError,
  type HostListDeps,
} from "../auth/host-list-client";
import { selectRepos, type SelectorDeps } from "../ui/repo-selector";
import { arrow, bold, brand, fail, meta, ok, warn, DIM, RESET } from "../ui/styles";
import type {
  HostImportSummary,
  HostName,
  HostToken,
  ImportResult,
  RemoteRepo,
} from "../types";

// ── deps surface — everything tests need to drive without a real TTY ────────

export interface HostImportDeps {
  /** Auth resolver injection — defaults to the real cascade. */
  auth: {
    prompt: HostAuthDeps["prompt"];
    promptSecret: HostAuthDeps["promptSecret"];
    log: HostAuthDeps["log"];
    spawn?: HostAuthDeps["spawn"];
    getCachedBitbucketUsername?: HostAuthDeps["getCachedBitbucketUsername"];
    setCachedBitbucketUsername?: HostAuthDeps["setCachedBitbucketUsername"];
  };
  list?: HostListDeps;
  selector?: SelectorDeps;
  log: (msg: string) => void;
  /** Query the engine for the URLs of already-imported repos.
   *  Used to surface [✓] in the selector and to count "already_existing". */
  getAlreadyImportedUrls: () => Promise<Set<string>>;
}

/** Callback that drives one repo through the existing F6.6 ingest pipeline.
 *  The orchestrator calls this once per selected repo, in sequence. */
export type IngestOne = (cloneUrl: string) => Promise<ImportResult>;

const HOST_LABEL: Record<HostName, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
};

// ── main entry ──────────────────────────────────────────────────────────────

export async function runHostImport(
  host: HostName,
  ingest: IngestOne,
  deps: HostImportDeps,
): Promise<HostImportSummary> {
  const summary: HostImportSummary = {
    imported: 0,
    already_existing: 0,
    no_commits: 0,
    failed: 0,
    total_commits: 0,
  };

  deps.log(arrow(`Conectando ao ${HOST_LABEL[host]}...`));

  let token: HostToken;
  try {
    token = await resolveListingToken(host, deps.auth);
  } catch (e) {
    deps.log(fail((e as Error).message));
    return summary;
  }

  deps.log(arrow("Buscando repositórios..."));

  let repos: RemoteRepo[];
  try {
    repos = await fetchHostRepos(host, asCred(token), deps.list);
  } catch (e) {
    if (e instanceof HostListError) {
      deps.log(fail(e.message));
    } else {
      deps.log(fail(`Falha inesperada: ${(e as Error).message}`));
    }
    scrubToken(token);
    return summary;
  } finally {
    // Token's job is done once the listing API has been called.
    scrubToken(token);
  }

  deps.log(ok(`${bold(String(repos.length))} repositórios encontrados.`));
  if (repos.length === 0) return summary;

  const already = await deps.getAlreadyImportedUrls();
  const selected = await selectRepos(repos, {
    ...deps.selector,
    alreadyImportedUrls: already,
  });

  if (selected.length === 0) {
    deps.log(warn("Nenhum repositório selecionado."));
    return summary;
  }

  for (const repo of selected) {
    deps.log("");
    deps.log(arrow(`Importando ${bold(repo.full_name)}...`));
    const result = await ingestWithSshFallback(repo, ingest, deps.log);
    bump(summary, result);
  }

  deps.log("");
  deps.log(
    ok(
      `Bootstrap concluído. ${meta(
        `${summary.imported} importados · ${summary.already_existing} já existiam · ${summary.no_commits} sem commits seus`,
      )}`,
    ),
  );
  return summary;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function asCred(
  token: HostToken,
):
  | { method: "cli" | "pat"; token: string }
  | { method: "app_password"; username: string; app_password: string } {
  if (token.method === "app_password") {
    return {
      method: "app_password",
      username: token.username,
      app_password: token.app_password,
    };
  }
  return { method: token.method, token: token.token };
}

/**
 * Try SSH first; on a `clone_error` (auth/permission/host), retry with HTTPS
 * silently. Anything else is the terminal result. No PAT discovery here —
 * the engine's F6.3 cascade owns clone-time auth.
 */
async function ingestWithSshFallback(
  repo: RemoteRepo,
  ingest: IngestOne,
  log: (msg: string) => void,
): Promise<ImportResult> {
  const hasSsh = repo.clone_url_ssh && repo.clone_url_ssh.length > 0;
  const hasHttps = repo.clone_url_https && repo.clone_url_https.length > 0;

  if (hasSsh) {
    const first = await ingest(repo.clone_url_ssh);
    if (first.kind !== "failed" || !hasHttps) return first;
    log(`     ${DIM}→ SSH indisponível, usando HTTPS.${RESET}`);
    return ingest(repo.clone_url_https);
  }
  if (hasHttps) return ingest(repo.clone_url_https);
  return { kind: "failed", commits: 0 };
}

function bump(summary: HostImportSummary, r: ImportResult): void {
  switch (r.kind) {
    case "imported":
      summary.imported += 1;
      summary.total_commits += r.commits;
      break;
    case "already_existing":
      summary.already_existing += 1;
      break;
    case "no_commits":
      summary.no_commits += 1;
      break;
    case "failed":
      summary.failed += 1;
      break;
  }
}

/** Defensive: zero out the token fields right after they're consumed. The
 *  caller may still hold the reference, but the secret bytes are gone. */
function scrubToken(token: HostToken): void {
  // Best-effort — JS strings are immutable, so we can only drop the live
  // references on the object we hand out.
  if (token.method === "app_password") {
    (token as { app_password: string }).app_password = "";
  } else {
    (token as { token: string }).token = "";
  }
}

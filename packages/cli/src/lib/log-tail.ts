/**
 * Generic log-tail loop, extracted from cursor-tail.ts so the R2.4
 * (Copilot CLI) and R2.5 (Copilot VS Code) adapters can reuse the same
 * offset-persistence, log-rotation, and retry-on-failure semantics.
 *
 * The contract is intentionally narrow: a caller supplies an adapter
 * config (where to find logs, how to parse one line, where to POST) and
 * `pollOnce(config)` runs one tick. No long-lived process, no socket,
 * no exclusive lock — the daemon's existing supervisor invokes pollOnce
 * once per 60-second cycle for every registered tail.
 *
 * Design invariants carried forward from cursor-tail.ts:
 *
 *   1. **Position cursor on disk**, one byte offset per source. State
 *      file lives at ~/.beheld/.{name}-tail.cursor — the leading dot
 *      keeps the state file out of `ls` listings; the {name} prefix
 *      keeps two adapters from clobbering each other.
 *
 *   2. **One file at a time**. The tail always reads from the newest
 *      log under the configured discovery root. Log rotation (newer
 *      file appears) resets the offset to 0 on the new file; no
 *      backfill of older files.
 *
 *   3. **Forgiving line parser**. The adapter's `parseLine` returns
 *      either a wire payload to POST or `null` to silently drop. The
 *      tail loop never crashes a tick because of one malformed line.
 *
 *   4. **Sanitisation lives server-side**. The tail forwards the raw
 *      parsed object; the mcp-server's `sanitize` chain handles
 *      redaction. Privacy boundary stays in one place.
 *
 *   5. **POST failure mid-batch leaves offset unchanged**. The same
 *      lines are re-read on the next tick. Never lose an event to a
 *      transient network blip.
 */
import {
  existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export interface TailState {
  /** Absolute path of the log file we're currently following. */
  log_file: string;
  /** Byte offset of the next byte to read from `log_file`. */
  offset: number;
}

/**
 * Closed contract every adapter implements. Generic over the wire
 * payload type so adapters keep their type safety end-to-end.
 */
export interface TailConfig<TPayload> {
  /** Short adapter name; used for the state-file filename. Must be a
   *  stable, kebab-cased identifier (e.g. "cursor", "copilot-vscode"). */
  name: string;

  /** Absolute path to the directory tree to scan, or null when the
   *  adapter's editor is not installed (tail tick becomes a no-op). */
  logsDir: string | null;

  /** Filename suffixes that count as candidate log files (e.g.
   *  [".log", ".jsonl"]). Files outside this allowlist are ignored. */
  fileSuffixes: readonly string[];

  /** Parse one raw line into a wire payload, or null to silently drop. */
  parseLine: (line: string) => TPayload | null;

  /** POST the payload to the local mcp-server. Implementations should
   *  throw on transient failure so the tail leaves the offset unchanged
   *  for next-tick retry. */
  post: (payload: TPayload) => Promise<void>;

  /** Override the state-file path (used by tests). Defaults to
   *  ~/.beheld/.{name}-tail.cursor. */
  stateFile?: string;
}

const DEFAULT_BEHELD_DIR = join(homedir(), ".beheld");

function defaultStateFile(name: string): string {
  return join(DEFAULT_BEHELD_DIR, `.${name}-tail.cursor`);
}

/** Newest entry under `logsDir` (recursive) whose suffix passes the
 *  adapter's allowlist. Picks the largest mtime. */
export function findNewestLogFile(
  logsDir: string,
  suffixes: readonly string[],
): string | null {
  const candidates: { path: string; mtimeMs: number }[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      const p = join(dir, name);
      try {
        const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else if (suffixes.some((s) => name.endsWith(s))) {
          candidates.push({ path: p, mtimeMs: st.mtimeMs });
        }
      } catch { /* permission denied / vanished — skip */ }
    }
  };
  walk(logsDir);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0].path;
}

export function loadState(stateFile: string): TailState | null {
  if (!existsSync(stateFile)) return null;
  try {
    const raw = readFileSync(stateFile, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.log_file === "string" && typeof parsed?.offset === "number") {
      return { log_file: parsed.log_file, offset: parsed.offset };
    }
  } catch { /* corrupt state — fall through */ }
  return null;
}

export function saveState(state: TailState, stateFile: string): void {
  const dir = dirname(stateFile);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
}

/**
 * One tail-loop tick. Returns the number of events POSTed in this tick
 * (zero is the common case after a quiet 60 seconds; a one-off restart
 * may flush a backlog).
 *
 * Idempotent across daemon restarts: re-running with an unchanged log
 * file emits zero events.
 */
export async function pollOnce<TPayload>(config: TailConfig<TPayload>): Promise<number> {
  if (!config.logsDir) return 0;
  const newest = findNewestLogFile(config.logsDir, config.fileSuffixes);
  if (!newest) return 0;

  const stateFile = config.stateFile ?? defaultStateFile(config.name);
  let state = loadState(stateFile);
  // Log rotation — start over at offset 0 if we're now reading a new file.
  if (!state || state.log_file !== newest) state = { log_file: newest, offset: 0 };

  let contents: string;
  try { contents = readFileSync(newest, "utf-8"); } catch { return 0; }
  if (contents.length <= state.offset) return 0; // nothing new
  const slice = contents.slice(state.offset);
  const lines = slice.split("\n").filter(Boolean);

  let emitted = 0;
  for (const line of lines) {
    const payload = config.parseLine(line);
    if (!payload) continue;
    try {
      await config.post(payload);
      emitted++;
    } catch {
      // Transient failure — bail without persisting, so the same lines
      // are re-read on the next tick. The single most important
      // correctness gate of the tail loop.
      return emitted;
    }
  }

  state.offset = contents.length;
  saveState(state, stateFile);
  return emitted;
}

/**
 * Build a POST sink that hits a localhost mcp-server route. Convenience
 * wrapper so each adapter doesn't reinvent the fetch boilerplate.
 */
export function makeLocalPost<TPayload>(
  route: string,
): (payload: TPayload) => Promise<void> {
  const base = process.env.BEHELD_MCP_URL ?? "http://127.0.0.1:7337";
  return async (payload: TPayload) => {
    const res = await fetch(`${base}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`POST ${route} → ${res.status}`);
  };
}

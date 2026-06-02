/**
 * R2.2 — Cursor log tail loop.
 *
 * Cursor (cursor.com) has no public hook API. This module locates the
 * editor's local log directory, follows new lines from the most recent
 * log file, parses each JSON line into a `CursorEventPayload`, and POSTs
 * it to the local mcp-server's `/hook/cursor/event` route — which in turn
 * ingests it as a BeheldEvent with `source: "cursor"`.
 *
 * Design choices:
 *
 *   1. **Position cursor on disk**. The tail loop persists its read offset
 *      to `~/.beheld/.cursor-tail.cursor` so a daemon restart doesn't
 *      replay events. Cursor log files are append-only; the offset is a
 *      single byte position into the most recent log file.
 *
 *   2. **One file at a time**. Cursor rotates logs daily-ish; the tail
 *      always reads from the newest file. When a new log file appears,
 *      the cursor is reset (we don't backfill — the daemon was offline,
 *      so the events would have already been late by hours).
 *
 *   3. **Forgiving line parser**. Cursor's log lines aren't a public
 *      contract. The parser drops malformed lines silently (no JSON, no
 *      `type` field, no recognised `type` value) and only emits a wire
 *      payload when the shape passes a structural check.
 *
 *   4. **Sanitisation lives server-side**. We POST the raw parsed object
 *      (no secret stripping) and let the mcp-server's `sanitize` chain
 *      handle redaction. This keeps the privacy boundary in one place
 *      (the writer pipeline), so the tail is a pure pass-through.
 *
 *   5. **No daemon process here**. This module exports `pollOnce` and
 *      `tailLoop` as plain async functions. The supervisor wires it into
 *      the existing 60-second poll cycle. No new long-lived process, no
 *      new socket.
 *
 * Capture fidelity: `local_log_tail` — see harness_registry.py.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export interface CursorEventPayload {
  session_id?: string;
  event_type: string;
  timestamp?: string;
  tool_name?: string;
  command?: string;
  file_path?: string;
  prompt_length?: number;
  workspace?: string;
  total_turns?: number;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
}

export interface CursorTailState {
  /** Absolute path of the log file we're currently following. */
  log_file: string;
  /** Byte offset of the next byte to read from `log_file`. */
  offset: number;
}

export interface CursorTailDeps {
  /** Override path discovery (used by tests). */
  logsDir?: string;
  /** Override state-file path (used by tests). */
  stateFile?: string;
  /** Override the POST sink (used by tests; default posts to localhost:7337). */
  post?: (payload: CursorEventPayload) => Promise<void>;
}

const DEFAULT_STATE_FILE = join(homedir(), ".beheld", ".cursor-tail.cursor");

/**
 * Resolve the Cursor logs directory by platform. Returns null when Cursor
 * is not installed on the host — the caller treats null as "skip this
 * tick, nothing to tail".
 */
export function defaultCursorLogsDir(): string | null {
  const home = homedir();
  switch (platform()) {
    case "darwin": {
      const d = join(home, "Library", "Application Support", "Cursor", "logs");
      return existsSync(d) ? d : null;
    }
    case "linux": {
      const d = join(home, ".config", "Cursor", "logs");
      return existsSync(d) ? d : null;
    }
    default:
      // Windows is post-MVP per CLAUDE.md distribution targets.
      return null;
  }
}

/** Newest entry in the logs dir (recursive, picks the largest mtime). */
function findNewestLogFile(logsDir: string): string | null {
  const candidates: { path: string; mtimeMs: number }[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      const p = join(dir, name);
      try {
        const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else if (name.endsWith(".log") || name.endsWith(".jsonl")) {
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

export function loadState(stateFile = DEFAULT_STATE_FILE): CursorTailState | null {
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

export function saveState(state: CursorTailState, stateFile = DEFAULT_STATE_FILE): void {
  const dir = stateFile.substring(0, stateFile.lastIndexOf("/"));
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
}

/**
 * Parse a single raw log line into a wire-shaped CursorEventPayload, or
 * return null if the line is unusable. Forgiving on purpose — Cursor's
 * line schema is not a public contract, so any field can be absent.
 */
export function parseLogLine(line: string): CursorEventPayload | null {
  if (!line || line.length < 2) return null;
  let obj: unknown;
  try { obj = JSON.parse(line); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  // The line MUST surface either an explicit event_type or a recognisable
  // `type` field — otherwise it's noise (heartbeat, debug, telemetry ping).
  const rawType =
    typeof o.event_type === "string" ? o.event_type :
    typeof o.type       === "string" ? o.type       :
    null;
  if (!rawType) return null;

  // Map Cursor's type strings to our event_type vocabulary. Unknown types
  // collapse to a single `tool_use` event so the timeline isn't fully lost
  // when Cursor adds new categories between releases.
  const mapped =
    rawType === "tool_use"     || rawType === "tool"     ? "tool_use" :
    rawType === "chat_request" || rawType === "prompt"   ? "chat_request" :
    rawType === "edit_apply"   || rawType === "edit"     ? "edit_apply" :
    rawType === "stop"         || rawType === "end"      ? "stop" :
    null;
  if (!mapped) return null;

  return {
    event_type:    mapped,
    session_id:    typeof o.session_id    === "string" ? o.session_id    : undefined,
    timestamp:     typeof o.timestamp     === "string" ? o.timestamp     : undefined,
    tool_name:     typeof o.tool_name     === "string" ? o.tool_name     : undefined,
    command:       typeof o.command       === "string" ? o.command       : undefined,
    file_path:     typeof o.file_path     === "string" ? o.file_path     : undefined,
    prompt_length: typeof o.prompt_length === "number" ? o.prompt_length : undefined,
    workspace:     typeof o.workspace     === "string" ? o.workspace     : undefined,
    total_turns:   typeof o.total_turns   === "number" ? o.total_turns   : undefined,
    duration_ms:   typeof o.duration_ms   === "number" ? o.duration_ms   : undefined,
    metadata:      typeof o.metadata      === "object" && o.metadata !== null
                    ? o.metadata as Record<string, unknown>
                    : undefined,
  };
}

/**
 * One tail-loop tick: locate the newest log, resume from the persisted
 * offset, parse and POST every new line, persist the new offset, return.
 * Idempotent across daemon restarts — re-running with an unchanged log
 * file emits zero events.
 */
export async function pollOnce(deps: CursorTailDeps = {}): Promise<number> {
  const logsDir = deps.logsDir ?? defaultCursorLogsDir();
  if (!logsDir) return 0;
  const newest = findNewestLogFile(logsDir);
  if (!newest) return 0;

  const stateFile = deps.stateFile ?? DEFAULT_STATE_FILE;
  let state = loadState(stateFile);
  // Log rotation — start over at offset 0 if we're now reading a new file.
  if (!state || state.log_file !== newest) state = { log_file: newest, offset: 0 };

  let contents: string;
  try { contents = readFileSync(newest, "utf-8"); } catch { return 0; }
  if (contents.length <= state.offset) return 0; // nothing new
  const slice = contents.slice(state.offset);
  const lines = slice.split("\n").filter(Boolean);

  const post = deps.post ?? defaultPost;
  let emitted = 0;
  for (const line of lines) {
    const payload = parseLogLine(line);
    if (!payload) continue;
    try {
      await post(payload);
      emitted++;
    } catch {
      // Server transient failure — break out so we re-read the same lines
      // next tick. NOT advancing the offset is the only correctness gate.
      return emitted;
    }
  }

  state.offset = contents.length;
  saveState(state, stateFile);
  return emitted;
}

const SERVER_URL =
  process.env.BEHELD_MCP_URL ?? "http://127.0.0.1:7337";

async function defaultPost(payload: CursorEventPayload): Promise<void> {
  const res = await fetch(`${SERVER_URL}/hook/cursor/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`POST /hook/cursor/event → ${res.status}`);
}

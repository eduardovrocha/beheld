/**
 * R2.2 — Cursor log tail loop.
 *
 * Cursor (cursor.com) has no public hook API. This module locates the
 * editor's local log directory, follows new lines from the most recent
 * log file, parses each JSON line into a `CursorEventPayload`, and POSTs
 * it to the local mcp-server's `/hook/cursor/event` route — which in turn
 * ingests it as a BeheldEvent with `source: "cursor"`.
 *
 * The mechanical heavy lifting (offset persistence, log rotation,
 * retry-on-failure, file discovery) lives in `lib/log-tail.ts` so the
 * R2.4/R2.5 adapters can share the same battle-tested loop. This module
 * carries the Cursor-specific knowledge: where the logs live, how to
 * decode one line into a wire payload, and which mcp-server route to POST.
 *
 * Capture fidelity: `local_log_tail` — see harness_registry.py.
 */
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

import {
  makeLocalPost,
  pollOnce as genericPollOnce,
  type TailConfig,
} from "./log-tail";

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

/** Re-export the generic state shape for any caller that still imports it. */
export type { TailState as CursorTailState } from "./log-tail";

export interface CursorTailDeps {
  /** Override path discovery (used by tests). */
  logsDir?: string;
  /** Override state-file path (used by tests). */
  stateFile?: string;
  /** Override the POST sink (used by tests). */
  post?: (payload: CursorEventPayload) => Promise<void>;
}

/** Re-exports so the existing test surface keeps working unchanged. */
export { loadState, saveState } from "./log-tail";

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

  const rawType =
    typeof o.event_type === "string" ? o.event_type :
    typeof o.type       === "string" ? o.type       :
    null;
  if (!rawType) return null;

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

const DEFAULT_POST = makeLocalPost<CursorEventPayload>("/hook/cursor/event");

/**
 * One tail-loop tick — delegates to the generic loop with a Cursor-shaped
 * config. Idempotent across daemon restarts: re-running with an unchanged
 * log file emits zero events.
 */
export async function pollOnce(deps: CursorTailDeps = {}): Promise<number> {
  const config: TailConfig<CursorEventPayload> = {
    name: "cursor",
    logsDir: deps.logsDir ?? defaultCursorLogsDir(),
    fileSuffixes: [".log", ".jsonl"],
    parseLine: parseLogLine,
    post: deps.post ?? DEFAULT_POST,
    stateFile: deps.stateFile,
  };
  return genericPollOnce(config);
}

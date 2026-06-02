/**
 * R2.4 — GitHub Copilot CLI log tail.
 *
 * Copilot CLI (gh copilot subcommand) caches conversation transcripts
 * locally under:
 *
 *   macOS:  ~/Library/Application Support/gh-copilot/transcripts/
 *           ~/Library/Caches/gh-copilot/
 *   Linux:  ~/.local/share/gh-copilot/transcripts/
 *           ~/.cache/gh-copilot/
 *
 * The registry classifies copilot-cli as `statusline` — Copilot CLI's
 * canonical signal surface is the one-line status emitted at completion
 * time, supplemented by a transcript line tail. We capture both via this
 * tail loop; the per-event metadata flags which surface produced each
 * entry so the engine can downgrade fidelity for inferred events.
 *
 * Source: `"copilot-cli"` — capture fidelity `statusline` (per
 * harness_registry; per-event surface lives in metadata).
 */
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

import {
  makeLocalPost,
  pollOnce as genericPollOnce,
  type TailConfig,
} from "./log-tail";

export interface CopilotCliEventPayload {
  event_type: string;
  session_id?: string;
  timestamp?: string;
  /** "explain" | "suggest" | "shell-completion" — Copilot CLI subcommand. */
  subcommand?: string;
  /** Length only — text never travels. */
  prompt_length?: number;
  response_length?: number;
  duration_ms?: number;
  /** Origin surface, used by the engine to downgrade fidelity. */
  surface?: "statusline" | "transcript";
  exit_code?: number;
  metadata?: Record<string, unknown>;
}

export interface CopilotCliTailDeps {
  logsDir?: string;
  stateFile?: string;
  post?: (payload: CopilotCliEventPayload) => Promise<void>;
}

export { loadState, saveState } from "./log-tail";

/**
 * Resolve Copilot CLI's transcript root. Returns null when neither the
 * cache nor the share dir exists (Copilot CLI not installed).
 */
export function defaultCopilotCliLogsDir(): string | null {
  const home = homedir();
  const candidates =
    platform() === "darwin"
      ? [
          join(home, "Library", "Application Support", "gh-copilot"),
          join(home, "Library", "Caches", "gh-copilot"),
        ]
      : platform() === "linux"
      ? [
          join(home, ".local", "share", "gh-copilot"),
          join(home, ".cache", "gh-copilot"),
        ]
      : [];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

/**
 * Parse a single transcript line into a wire payload, or null when the
 * line carries no recognised event. Forgiving: Copilot CLI's transcript
 * format isn't a public contract and varies between gh versions.
 */
export function parseLogLine(line: string): CopilotCliEventPayload | null {
  if (!line || line.length < 2) return null;
  let obj: unknown;
  try { obj = JSON.parse(line); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  const rawType =
    typeof o.event_type === "string" ? o.event_type :
    typeof o.event      === "string" ? o.event      :
    typeof o.type       === "string" ? o.type       :
    null;
  if (!rawType) return null;

  const mapped =
    rawType === "suggestion"      || rawType === "suggest"  ? "suggestion" :
    rawType === "explain_request" || rawType === "explain"  ? "explain_request" :
    rawType === "shell_complete"  || rawType === "complete" ? "shell_complete" :
    rawType === "session_end"     || rawType === "end"      ? "session_end" :
    null;
  if (!mapped) return null;

  const rawSurface = typeof o.surface === "string" ? o.surface : undefined;
  const surface =
    rawSurface === "statusline" || rawSurface === "transcript" ? rawSurface : undefined;

  return {
    event_type:      mapped,
    session_id:      typeof o.session_id      === "string" ? o.session_id      : undefined,
    timestamp:       typeof o.timestamp       === "string" ? o.timestamp       : undefined,
    subcommand:      typeof o.subcommand      === "string" ? o.subcommand      : undefined,
    prompt_length:   typeof o.prompt_length   === "number" ? o.prompt_length   : undefined,
    response_length: typeof o.response_length === "number" ? o.response_length : undefined,
    duration_ms:     typeof o.duration_ms     === "number" ? o.duration_ms     : undefined,
    surface,
    exit_code:       typeof o.exit_code       === "number" ? o.exit_code       : undefined,
    metadata:        typeof o.metadata === "object" && o.metadata !== null
                      ? o.metadata as Record<string, unknown>
                      : undefined,
  };
}

const DEFAULT_POST = makeLocalPost<CopilotCliEventPayload>("/hook/copilot-cli/event");

export async function pollOnce(deps: CopilotCliTailDeps = {}): Promise<number> {
  const config: TailConfig<CopilotCliEventPayload> = {
    name: "copilot-cli",
    logsDir: deps.logsDir ?? defaultCopilotCliLogsDir(),
    fileSuffixes: [".log", ".jsonl", ".transcript"],
    parseLine: parseLogLine,
    post: deps.post ?? DEFAULT_POST,
    stateFile: deps.stateFile,
  };
  return genericPollOnce(config);
}

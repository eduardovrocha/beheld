/**
 * R2.5 — GitHub Copilot VS Code log tail.
 *
 * VS Code stores extension host logs under a per-session directory:
 *
 *   macOS:   ~/Library/Application Support/Code/logs/<YYYYMMDDTHHMMSS>/exthost{N}/GitHub.copilot/
 *   Linux:   ~/.config/Code/logs/<YYYYMMDDTHHMMSS>/exthost{N}/GitHub.copilot/
 *
 * Each VS Code launch creates a new timestamped dir; Copilot writes
 * structured log files inside. The tail recursively walks the logs root
 * and picks the newest matching file regardless of which session dir
 * holds it (the generic `findNewestLogFile` already does this via mtime).
 *
 * Source: `"copilot-vscode"` — capture fidelity `local_log_tail`
 * (per R2.5; tokens are estimated chars/4 at handler-side).
 *
 * Privacy posture (matches the handler): tail forwards parsed objects
 * unchanged; the mcp-server sanitiser strips secrets; the handler caps
 * the surface to char counts (prompt_length / response_length) before
 * any disk write.
 */
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

import {
  makeLocalPost,
  pollOnce as genericPollOnce,
  type TailConfig,
} from "./log-tail";

export interface CopilotVscodeEventPayload {
  event_type: string;
  session_id?: string;
  timestamp?: string;
  prompt_length?: number;
  response_length?: number;
  file_path?: string;
  workspace?: string;
  duration_ms?: number;
  total_turns?: number;
  model?: string;
  metadata?: Record<string, unknown>;
}

export interface CopilotVscodeTailDeps {
  logsDir?: string;
  stateFile?: string;
  post?: (payload: CopilotVscodeEventPayload) => Promise<void>;
}

export { loadState, saveState } from "./log-tail";

/**
 * Resolve VS Code's logs root by platform. Copilot writes inside this
 * dir under per-session subfolders; the generic tail walks recursively
 * so the per-session layer is transparent.
 */
export function defaultCopilotVscodeLogsDir(): string | null {
  const home = homedir();
  switch (platform()) {
    case "darwin": {
      const d = join(home, "Library", "Application Support", "Code", "logs");
      return existsSync(d) ? d : null;
    }
    case "linux": {
      const d = join(home, ".config", "Code", "logs");
      return existsSync(d) ? d : null;
    }
    default:
      return null; // Windows post-MVP.
  }
}

/**
 * Parse one log line. Copilot's VS Code log lines are NOT a public
 * contract — the parser is intentionally forgiving and only emits when
 * the line carries a recognised `event` (or `type`) field that maps to
 * one of the four canonical Copilot VS Code event types.
 */
export function parseLogLine(line: string): CopilotVscodeEventPayload | null {
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
    rawType === "inline_suggestion" || rawType === "ghost_text"      ? "inline_suggestion" :
    rawType === "code_completion"   || rawType === "completion"      ? "code_completion" :
    rawType === "chat_request"      || rawType === "chat" || rawType === "chat_panel_request" ? "chat_request" :
    rawType === "session_end"       || rawType === "end" || rawType === "shutdown" ? "session_end" :
    null;
  if (!mapped) return null;

  return {
    event_type:      mapped,
    session_id:      typeof o.session_id      === "string" ? o.session_id      : undefined,
    timestamp:       typeof o.timestamp       === "string" ? o.timestamp       : undefined,
    prompt_length:   typeof o.prompt_length   === "number" ? o.prompt_length   : undefined,
    response_length: typeof o.response_length === "number" ? o.response_length : undefined,
    file_path:       typeof o.file_path       === "string" ? o.file_path       : undefined,
    workspace:       typeof o.workspace       === "string" ? o.workspace       : undefined,
    duration_ms:     typeof o.duration_ms     === "number" ? o.duration_ms     : undefined,
    total_turns:     typeof o.total_turns     === "number" ? o.total_turns     : undefined,
    model:           typeof o.model           === "string" ? o.model           : undefined,
    metadata:        typeof o.metadata === "object" && o.metadata !== null
                      ? o.metadata as Record<string, unknown>
                      : undefined,
  };
}

const DEFAULT_POST = makeLocalPost<CopilotVscodeEventPayload>("/hook/copilot-vscode/event");

export async function pollOnce(deps: CopilotVscodeTailDeps = {}): Promise<number> {
  const config: TailConfig<CopilotVscodeEventPayload> = {
    name: "copilot-vscode",
    logsDir: deps.logsDir ?? defaultCopilotVscodeLogsDir(),
    fileSuffixes: [".log", ".jsonl"],
    parseLine: parseLogLine,
    post: deps.post ?? DEFAULT_POST,
    stateFile: deps.stateFile,
  };
  return genericPollOnce(config);
}

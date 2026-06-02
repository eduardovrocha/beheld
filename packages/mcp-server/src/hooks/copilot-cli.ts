/**
 * R2.4 — GitHub Copilot CLI adapter (statusline + local_log_tail blend).
 *
 * Copilot CLI has no public hook API. Two parallel signals exist:
 *
 *   1. STATUSLINE — Copilot writes a short status banner to stderr while
 *      running (the "🤖 Suggestion · Explain · Execute · Revise" prompt).
 *      A CLI-side watcher polls `copilot status --machine` (or scrapes
 *      stderr from the supervised process) to detect when a session is
 *      live, and POSTs one `statusline_poll` event per tick.
 *
 *   2. LOG TAIL — Copilot writes a structured log at
 *      `~/.config/github-copilot/cli.log` (Linux) /
 *      `~/Library/Application Support/GitHub Copilot/cli.log` (macOS).
 *      Each tool-class action (suggestion shown, command executed,
 *      explain requested) becomes one log line. The tail loop (similar
 *      to cursor-tail.ts) parses each line and POSTs a `tool_use` event.
 *
 * Both channels POST to a single endpoint `/hook/copilot-cli/event` with
 * a `channel` discriminator in the payload — the handler maps it to the
 * canonical BeheldEvent shape and stamps `metadata.channel` so downstream
 * classifiers can weight differently if they ever care.
 *
 * Capture fidelity (engine-side): `statusline` is the headline tier —
 * the dominant deterministic signal. Per-event `channel` lives in
 * metadata, not in the closed enum (which would explode if every blend
 * needed its own value).
 *
 * Privacy invariants:
 *   - statusline polls carry only the banner state (e.g. "running",
 *     "idle", "suggesting") and a timestamp — no prompt text.
 *   - log-tail lines run through the standard sanitiser; commands are
 *     bounded at 500 chars; file paths reduce to extensions.
 *   - cwd / workspace hashed; never raw.
 */
import { createHash, randomUUID } from "crypto";
import { sanitize, sanitizeCommand, sanitizeMetadata } from "../sanitizer";
import type { BeheldEvent } from "../types";

/**
 * Closed enum of recognised statusline states. Unknown values from
 * future Copilot CLI releases still ingest but tag as "unknown" so the
 * downstream signal stays consistent.
 */
export type CopilotStatuslineState =
  | "idle"
  | "running"
  | "suggesting"
  | "explaining"
  | "executing"
  | "unknown";

export interface CopilotCliEventPayload {
  /** Either "statusline_poll" or "log_line" — discriminator. */
  channel: string;
  session_id?: string;
  timestamp?: string;
  /** statusline_poll only: the current banner state. */
  state?: string;
  /** log_line only: tool category from the log entry. */
  tool_name?: string;
  /** log_line only: bash-like command (if the tool was "execute"). */
  command?: string;
  /** log_line only: file the suggestion targeted. */
  file_path?: string;
  /** log_line only: prompt char count (never the text). */
  prompt_length?: number;
  workspace?: string;
  total_turns?: number;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
}

const TEST_KEYWORDS = ["rspec", "jest", "pytest", "playwright", "vitest", "go test"];

function hasTestContext(command?: string): boolean | undefined {
  if (!command) return undefined;
  const c = command.toLowerCase();
  return TEST_KEYWORDS.some((kw) => c.includes(kw));
}

function fileExtension(filePath?: string): string | undefined {
  if (!filePath || typeof filePath !== "string") return undefined;
  const parts = filePath.split(".");
  if (parts.length < 2) return undefined;
  const ext = parts[parts.length - 1];
  return ext.length > 0 && ext.length < 12 ? ext : undefined;
}

function cwdHash(cwd?: string): string | undefined {
  if (!cwd) return undefined;
  return createHash("sha256").update(cwd).digest("hex");
}

const STATUSLINE_STATES: ReadonlySet<string> = new Set([
  "idle", "running", "suggesting", "explaining", "executing",
]);

function normalizeState(raw?: string): CopilotStatuslineState {
  if (!raw) return "unknown";
  const v = raw.toLowerCase();
  return STATUSLINE_STATES.has(v) ? (v as CopilotStatuslineState) : "unknown";
}

/**
 * Maps a Copilot CLI event (either channel) to a BeheldEvent. Returns
 * null when the channel is unrecognised so the writer can drop without
 * advancing the source counter.
 */
export function handleCopilotCliEvent(body: unknown): BeheldEvent | null {
  const safe = sanitize(body) as CopilotCliEventPayload;
  if (!safe || typeof safe.channel !== "string") return null;

  const base = {
    event_id: randomUUID(),
    session_id: safe.session_id ?? "copilot-cli-session",
    source: "copilot-cli" as const,
    timestamp: safe.timestamp ?? new Date().toISOString(),
    cwd_hash: cwdHash(safe.workspace),
  };

  switch (safe.channel) {
    case "statusline_poll": {
      const state = normalizeState(safe.state);
      return {
        ...base,
        event_type: "statusline_poll",
        metadata: {
          channel: "statusline",
          state,
        },
      };
    }

    case "log_line": {
      const isExecute = safe.tool_name === "execute" || safe.tool_name === "Bash";
      return {
        ...base,
        event_type: "pre_tool_use",
        tool_name: safe.tool_name,
        file_extension: fileExtension(safe.file_path),
        command_sanitized: isExecute && typeof safe.command === "string"
          ? sanitizeCommand(safe.command.slice(0, 500))
          : undefined,
        has_test_context: isExecute ? hasTestContext(safe.command) : undefined,
        prompt_length: typeof safe.prompt_length === "number" ? safe.prompt_length : undefined,
        duration_ms: safe.duration_ms,
        metadata: {
          channel: "log_tail",
          ...sanitizeMetadata(safe.metadata ?? {}),
        },
      };
    }

    case "session_end": {
      return {
        ...base,
        event_type: "stop",
        metadata: {
          channel: "statusline",
          total_turns: safe.total_turns,
        },
      };
    }

    default:
      return null;
  }
}

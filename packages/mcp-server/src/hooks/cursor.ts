/**
 * R2.2 — Cursor adapter (local_log_tail).
 *
 * Cursor (cursor.com) ships no public hook API. The capture path is:
 *
 *   ┌─ packages/cli/src/lib/cursor-tail.ts  (tail loop, future R2.2 PR)
 *   │  reads ~/Library/Application Support/Cursor/logs/main.log etc.
 *   ↓
 *   POST /hook/cursor/event  ← this handler — one JSON line per parsed event
 *   ↓
 *   handleCursorEvent → BeheldEvent with source="cursor"
 *
 * Why a single route instead of pre/post/stop: Cursor's logs don't
 * always pair tool invocations cleanly (a chat-completion line might
 * appear without a matching tool span). One generic ingestion route per
 * sanitised line is the smallest surface that still preserves a faithful
 * timeline.
 *
 * Capture fidelity: `local_log_tail` (engine harness_registry.py). Lower
 * than `native_hook` because log lines lag the in-editor action and the
 * upstream schema isn't guaranteed stable.
 *
 * Privacy invariants:
 *   - All four event shapes below sanitise via the existing `sanitize`
 *     pipeline (secrets, env values, tokens redacted).
 *   - file_path is NEVER stored raw — only the extension survives. The
 *     cwd / workspace path is hashed.
 *   - Cursor logs occasionally embed prompt fragments; we ingest the
 *     character count (prompt_length) only — never the text.
 */
import { createHash, randomUUID } from "crypto";
import { sanitize, sanitizeCommand, sanitizeMetadata } from "../sanitizer";
import type { BeheldEvent } from "../types";

/**
 * Wire payload — produced by the tail loop in packages/cli. The
 * `event_type` is the discriminator; everything else is optional and
 * shape-dependent. Unknown event_types ingest as null (dropped).
 */
export interface CursorEventPayload {
  /** Stable Cursor session id (sourced from the log line's contextId). */
  session_id?: string;
  /** One of: "tool_use" | "chat_request" | "edit_apply" | "stop". */
  event_type: string;
  /** ISO-8601 from the log line; fall back to now() if absent. */
  timestamp?: string;
  /** Tool name when event_type=tool_use ("terminal", "edit", "read"). */
  tool_name?: string;
  /** Bash-like command when tool_name=terminal. */
  command?: string;
  /** Path of the file the action touched (extension extracted, path discarded). */
  file_path?: string;
  /** Character count of the user message; never the message itself. */
  prompt_length?: number;
  /** Workspace folder absolute path (hashed before write). */
  workspace?: string;
  /** Total tool/chat turns reported in the log so far. */
  total_turns?: number;
  /** Round-trip duration of the action, if the log line includes it. */
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

/**
 * Maps a sanitised Cursor log line to a BeheldEvent.
 * Returns null for unknown event_types so the tail loop can drop them
 * without bumping the JSONL counter.
 */
export function handleCursorEvent(body: unknown): BeheldEvent | null {
  const safe = sanitize(body) as CursorEventPayload;
  if (!safe || typeof safe.event_type !== "string") return null;

  const base = {
    event_id: randomUUID(),
    session_id: safe.session_id ?? "cursor-session",
    source: "cursor" as const,
    timestamp: safe.timestamp ?? new Date().toISOString(),
    cwd_hash: cwdHash(safe.workspace),
  };

  switch (safe.event_type) {
    case "tool_use": {
      const isTerminal = safe.tool_name === "terminal" || safe.tool_name === "Bash";
      return {
        ...base,
        event_type: "pre_tool_use",
        tool_name: safe.tool_name,
        file_extension: fileExtension(safe.file_path),
        command_sanitized: isTerminal && typeof safe.command === "string"
          ? sanitizeCommand(safe.command.slice(0, 500))
          : undefined,
        has_test_context: isTerminal ? hasTestContext(safe.command) : undefined,
        duration_ms: safe.duration_ms,
        metadata: sanitizeMetadata(safe.metadata ?? {}),
      };
    }

    case "chat_request": {
      return {
        ...base,
        event_type: "chat_request",
        prompt_length: typeof safe.prompt_length === "number" ? safe.prompt_length : undefined,
        file_extension: fileExtension(safe.file_path),
        metadata: sanitizeMetadata(safe.metadata ?? {}),
      };
    }

    case "edit_apply": {
      return {
        ...base,
        event_type: "edit_apply",
        file_extension: fileExtension(safe.file_path),
        duration_ms: safe.duration_ms,
        metadata: sanitizeMetadata(safe.metadata ?? {}),
      };
    }

    case "stop": {
      return {
        ...base,
        event_type: "stop",
        metadata: { total_turns: safe.total_turns },
      };
    }

    default:
      return null;
  }
}

/**
 * R3.1 — Windsurf adapter (native_hook · Cascade Hooks).
 *
 * Windsurf's Cascade agent ships 12 documented hook events delivered as
 * well-formed JSON via stdin. See docs/r3-windsurf-spike.md for the full
 * decision/capture analysis. This handler is the single ingestion point
 * — the server route discriminates by `event` query param, and we map
 * each Cascade event to canonical Beheld vocabulary.
 *
 * Mapping (locked in R3.0 §3):
 *
 *   Cascade event                          → Beheld event_type   tool_name
 *   ─────────────────────────────────────────────────────────────────────
 *   pre_read_code                          → pre_tool_use        "Read"
 *   post_read_code                         → post_tool_use       "Read"
 *   pre_write_code                         → pre_tool_use        "Write"
 *   post_write_code                        → post_tool_use       "Write"
 *   pre_run_command                        → pre_tool_use        "Bash"
 *   post_run_command                       → post_tool_use       "Bash"
 *   pre_mcp_tool_use                       → pre_tool_use        mcp_tool_name
 *   post_mcp_tool_use                      → post_tool_use       mcp_tool_name
 *   pre_user_prompt                        → chat_request        —
 *   post_cascade_response                  → chat_response       —
 *   post_cascade_response_with_transcript  → null (DROP — transcript_path is a fs path)
 *   post_setup_worktree                    → worktree_setup      —
 *
 * Privacy invariants (non-negotiable, see spike doc §4):
 *
 *   - `user_prompt` text from pre_user_prompt is DROPPED in this handler;
 *     only `prompt_length` (character count) reaches the BeheldEvent.
 *   - `response` markdown from post_cascade_response is DROPPED; only
 *     `response_length` (character count) survives.
 *   - `edits[]` (old_string / new_string) from post_write_code is
 *     DROPPED; only `metadata.edits_count` survives.
 *   - `mcp_result` from post_mcp_tool_use is DROPPED; only
 *     `metadata.has_result` survives.
 *   - `command_line` is sanitised via the standard chain + bounded at
 *     500 chars (same as every other Bash-class event in Beheld).
 *   - `cwd` / `root_workspace_path` SHA-256 hashed; never raw on disk.
 *
 * Session id: Cascade's `trajectory_id` (a stable per-conversation id).
 */
import { createHash, randomUUID } from "crypto";
import { sanitize, sanitizeCommand, sanitizeMetadata } from "../sanitizer";
import type { BeheldEvent } from "../types";

const TEST_KEYWORDS = ["rspec", "jest", "pytest", "playwright", "vitest", "go test"];

/** Closed set of Cascade event names recognised by the handler. */
export const WINDSURF_EVENTS = [
  "pre_read_code",
  "post_read_code",
  "pre_write_code",
  "post_write_code",
  "pre_run_command",
  "post_run_command",
  "pre_mcp_tool_use",
  "post_mcp_tool_use",
  "pre_user_prompt",
  "post_cascade_response",
  "post_cascade_response_with_transcript",
  "post_setup_worktree",
] as const;
export type WindsurfEventName = typeof WINDSURF_EVENTS[number];

interface CascadeEnvelope {
  agent_action_name?: string;
  trajectory_id?: string;
  execution_id?: string;
  timestamp?: string;
  model_name?: string;
  tool_info?: Record<string, unknown>;
}

function hasTestContext(command?: unknown): boolean {
  if (typeof command !== "string") return false;
  const c = command.toLowerCase();
  return TEST_KEYWORDS.some((kw) => c.includes(kw));
}

function fileExtension(filePath: unknown): string | undefined {
  if (typeof filePath !== "string") return undefined;
  const parts = filePath.split(".");
  if (parts.length < 2) return undefined;
  const ext = parts[parts.length - 1];
  return ext.length > 0 && ext.length < 12 ? ext : undefined;
}

function cwdHash(cwd: unknown): string | undefined {
  if (typeof cwd !== "string" || cwd.length === 0) return undefined;
  return createHash("sha256").update(cwd).digest("hex");
}

function isKnownEvent(event: string): event is WindsurfEventName {
  return (WINDSURF_EVENTS as readonly string[]).includes(event);
}

/**
 * Map a Cascade hook invocation to a BeheldEvent. `event` is the
 * Cascade event name (delivered by the server route via query param).
 * Returns null when the event is unrecognised, is the dropped
 * `post_cascade_response_with_transcript` (we already captured the
 * per-turn events), or the payload is structurally invalid.
 */
export function handleWindsurfEvent(event: string, body: unknown): BeheldEvent | null {
  if (!isKnownEvent(event)) return null;
  if (event === "post_cascade_response_with_transcript") return null;

  const safe = sanitize(body) as CascadeEnvelope;
  if (!safe || typeof safe !== "object") return null;

  const toolInfo = (safe.tool_info ?? {}) as Record<string, unknown>;
  const trajectoryId = typeof safe.trajectory_id === "string" ? safe.trajectory_id : "windsurf-session";
  const timestamp    = typeof safe.timestamp === "string" ? safe.timestamp : new Date().toISOString();
  const modelName    = typeof safe.model_name === "string" ? safe.model_name : undefined;

  const base = {
    event_id: randomUUID(),
    session_id: trajectoryId,
    source: "windsurf" as const,
    timestamp,
  };

  switch (event) {
    case "pre_read_code":
      return {
        ...base,
        event_type: "pre_tool_use",
        tool_name: "Read",
        file_extension: fileExtension(toolInfo.file_path),
        metadata: { model: modelName, execution_id: safe.execution_id },
      };

    case "post_read_code":
      return {
        ...base,
        event_type: "post_tool_use",
        tool_name: "Read",
        metadata: { model: modelName, execution_id: safe.execution_id },
      };

    case "pre_write_code":
      return {
        ...base,
        event_type: "pre_tool_use",
        tool_name: "Write",
        file_extension: fileExtension(toolInfo.file_path),
        metadata: { model: modelName, execution_id: safe.execution_id },
      };

    case "post_write_code": {
      // edits[] carries old_string / new_string — DROP. Keep only the
      // count so downstream classifiers know "an edit landed" without
      // ever seeing the code itself.
      const edits = Array.isArray(toolInfo.edits) ? toolInfo.edits : [];
      return {
        ...base,
        event_type: "post_tool_use",
        tool_name: "Write",
        file_extension: fileExtension(toolInfo.file_path),
        metadata: {
          model: modelName,
          execution_id: safe.execution_id,
          edits_count: edits.length,
        },
      };
    }

    case "pre_run_command": {
      const cmd = toolInfo.command_line;
      const cmdStr = typeof cmd === "string" ? cmd : "";
      return {
        ...base,
        event_type: "pre_tool_use",
        tool_name: "Bash",
        command_sanitized: cmdStr ? sanitizeCommand(cmdStr.slice(0, 500)) : undefined,
        has_test_context: hasTestContext(cmd),
        cwd_hash: cwdHash(toolInfo.cwd),
        metadata: { model: modelName, execution_id: safe.execution_id },
      };
    }

    case "post_run_command":
      return {
        ...base,
        event_type: "post_tool_use",
        tool_name: "Bash",
        cwd_hash: cwdHash(toolInfo.cwd),
        metadata: { model: modelName, execution_id: safe.execution_id },
      };

    case "pre_mcp_tool_use": {
      const mcpToolName = typeof toolInfo.mcp_tool_name === "string" ? toolInfo.mcp_tool_name : undefined;
      const mcpServer   = typeof toolInfo.mcp_server_name === "string" ? toolInfo.mcp_server_name : undefined;
      const args = (toolInfo.mcp_tool_arguments ?? {}) as Record<string, unknown>;
      return {
        ...base,
        event_type: "pre_tool_use",
        tool_name: mcpToolName,
        metadata: {
          model: modelName,
          execution_id: safe.execution_id,
          mcp_server: mcpServer,
          ...sanitizeMetadata(args),
        },
      };
    }

    case "post_mcp_tool_use": {
      // mcp_result MAY contain arbitrary content — drop. Carry only the
      // existence flag so we know the call completed with a payload.
      const mcpToolName = typeof toolInfo.mcp_tool_name === "string" ? toolInfo.mcp_tool_name : undefined;
      const mcpServer   = typeof toolInfo.mcp_server_name === "string" ? toolInfo.mcp_server_name : undefined;
      return {
        ...base,
        event_type: "post_tool_use",
        tool_name: mcpToolName,
        metadata: {
          model: modelName,
          execution_id: safe.execution_id,
          mcp_server: mcpServer,
          has_result: toolInfo.mcp_result != null,
        },
      };
    }

    case "pre_user_prompt": {
      // Privacy gate — user_prompt text DROPPED. Only the char count
      // (computed in-memory, never written to JSONL alongside the text)
      // survives onto the BeheldEvent.
      const promptText = typeof toolInfo.user_prompt === "string" ? toolInfo.user_prompt : "";
      const promptLength = promptText.length;
      return {
        ...base,
        event_type: "chat_request",
        prompt_length: promptLength,
        metadata: { model: modelName, execution_id: safe.execution_id },
      };
    }

    case "post_cascade_response": {
      // Privacy gate — response markdown DROPPED. Only response length.
      const respText = typeof toolInfo.response === "string" ? toolInfo.response : "";
      return {
        ...base,
        event_type: "chat_response",
        metadata: {
          model: modelName,
          execution_id: safe.execution_id,
          response_length: respText.length,
        },
      };
    }

    case "post_setup_worktree": {
      const root = toolInfo.root_workspace_path ?? toolInfo.worktree_path;
      return {
        ...base,
        event_type: "worktree_setup",
        cwd_hash: cwdHash(root),
        metadata: { model: modelName, execution_id: safe.execution_id },
      };
    }
  }
}

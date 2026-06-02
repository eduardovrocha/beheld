// R2 — adapter wave widens the source union. The engine's harness_registry
// (packages/engine/src/harness_registry.py) is the cross-language source of
// truth; any addition here MUST be mirrored there in the same commit.
export type BeheldSource =
  | "claude-code"        // Phase 5 — native_hook
  | "continue-vscode"    // Phase 5 — editor_extension
  | "gemini-cli"         // R2.1 — native_hook
  | "cursor"             // R2.2 — local_log_tail
  | "codex-cli"          // R2.3 — native_hook
  | "copilot-cli"        // R2.4 — statusline (+ local_log_tail blend)
  | "copilot-vscode"     // R2.5 — local_log_tail (tokens estimados)
  | "windsurf";          // R3.1 — native_hook (Cascade Hooks, 12 events)

export interface BeheldEvent {
  event_id: string;
  session_id: string;
  source: BeheldSource;
  event_type: string;
  timestamp: string;
  duration_ms?: number;
  tool_name?: string;
  file_extension?: string;
  command_sanitized?: string;
  prompt_length?: number;
  has_test_context?: boolean;
  cwd_hash?: string;
  metadata: Record<string, unknown>;
}

export type HookType = "pre_tool_use" | "post_tool_use" | "stop";

export interface ClaudeCodeHookPayload {
  session_id: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  timestamp?: string;
  total_turns?: number;
  cwd?: string;
  hook_event_name?: string;
}

/**
 * R2.3 — Codex CLI hook payload.
 *
 * Codex CLI (OpenAI's `codex` binary) exposes a Claude-Code-style hook
 * surface: a `before_command` / `after_command` / `session_end` triplet
 * that fires on tool boundaries. Shape kept independent of Gemini and
 * Claude Code so the three native_hook adapters can evolve at their own
 * pace.
 *
 * Source string: `"codex-cli"`.
 */
export interface CodexCliHookPayload {
  session_id: string;
  /** Tool name (Codex calls it `command_name` on the wire — accept either). */
  tool_name?: string;
  command_name?: string;
  /** Codex's structured input object — tool-specific shape. */
  tool_input?: Record<string, unknown>;
  /** ISO-8601 from the hook. */
  timestamp?: string;
  /** Number of conversational turns reported at session_end. */
  total_turns?: number;
  /** Codex's working directory. */
  cwd?: string;
  /** Round-trip duration in ms. */
  duration_ms?: number;
  hook_event_name?: string;
}

/**
 * R2.1 — Gemini CLI hook payload.
 *
 * Gemini CLI ships hooks under the same shape as Claude Code (PreToolUse /
 * PostToolUse / Stop firing on tool invocation boundaries). The struct
 * declares its own type because the wire schema can drift independently
 * once Gemini's hook spec stabilises; keeping the shapes split lets us
 * absorb that drift without touching the Claude Code branch.
 *
 * Source string: `"gemini-cli"` (kebab-case wire identifier — see
 * harness_registry.py for the snake_case portal mapping).
 */
export interface GeminiCliHookPayload {
  session_id: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  timestamp?: string;
  total_turns?: number;
  cwd?: string;
  duration_ms?: number;
  /** Mirrors Claude Code's `hook_event_name`; informational only. */
  hook_event_name?: string;
}

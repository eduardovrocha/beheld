// R2 — adapter wave widens the source union. The engine's harness_registry
// (packages/engine/src/harness_registry.py) is the cross-language source of
// truth; any addition here MUST be mirrored there in the same commit.
export type BeheldSource =
  | "claude-code"        // Phase 5 — native_hook
  | "continue-vscode"    // Phase 5 — editor_extension
  | "gemini-cli";        // R2.1 — native_hook

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

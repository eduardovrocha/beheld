export interface DevProfileEvent {
  event_id: string;
  session_id: string;
  source: "claude-code" | "continue-vscode";
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
}

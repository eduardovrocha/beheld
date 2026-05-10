import { randomUUID } from "crypto";
import { sanitize, sanitizeCommand, sanitizeObject } from "../sanitizer";
import type { ClaudeCodeHookPayload, DevProfileEvent } from "../types";

const TEST_INDICATORS = [
  /\.(test|spec)\.[a-z]+/i,
  /_spec\.(rb|py|ts|js|tsx|jsx)/,
  /\/tests?\//,
  /\/spec\//,
  /\/test_/,
  /\b(rspec|jest|pytest|vitest|playwright|mocha|jasmine)\b/,
  /\bgo test\b/,
  /npm (run )?test/,
  /bun test/,
  /yarn test/,
];

function isTestContext(input?: Record<string, unknown>): boolean {
  if (!input) return false;
  const combined = JSON.stringify(input);
  return TEST_INDICATORS.some((p) => p.test(combined));
}

function extractFileExtension(input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  const candidate =
    input.file_path ?? input.path ?? input.relative_path ?? input.filename;
  if (typeof candidate !== "string") return undefined;
  const parts = candidate.split(".");
  if (parts.length < 2) return undefined;
  const ext = parts[parts.length - 1];
  return ext.length > 0 && ext.length < 12 ? ext : undefined;
}

function extractCommand(
  toolName?: string,
  input?: Record<string, unknown>,
): string | undefined {
  if (toolName !== "Bash") return undefined;
  if (!input) return undefined;
  const cmd = input.command ?? input.cmd;
  if (typeof cmd !== "string") return undefined;
  return sanitizeCommand(cmd.slice(0, 500));
}

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).slice(0, 8);
}

export function handlePreTool(payload: ClaudeCodeHookPayload): DevProfileEvent {
  const sanitizedInput = sanitizeObject(payload.tool_input ?? {});
  return {
    event_id: randomUUID(),
    session_id: payload.session_id,
    source: "claude-code",
    event_type: "pre_tool_use",
    timestamp: payload.timestamp ?? new Date().toISOString(),
    tool_name: payload.tool_name,
    file_extension: extractFileExtension(payload.tool_input),
    command_sanitized: extractCommand(payload.tool_name, payload.tool_input),
    has_test_context: isTestContext(payload.tool_input),
    cwd_hash: payload.cwd ? hashString(payload.cwd) : undefined,
    metadata: sanitizedInput,
  };
}

export function handlePostTool(payload: ClaudeCodeHookPayload): DevProfileEvent {
  return {
    event_id: randomUUID(),
    session_id: payload.session_id,
    source: "claude-code",
    event_type: "post_tool_use",
    timestamp: new Date().toISOString(),
    tool_name: payload.tool_name,
    duration_ms: (payload as Record<string, unknown>).duration_ms as
      | number
      | undefined,
    metadata: {},
  };
}

export function handleStop(payload: ClaudeCodeHookPayload): DevProfileEvent {
  return {
    event_id: randomUUID(),
    session_id: payload.session_id,
    source: "claude-code",
    event_type: "stop",
    timestamp: payload.timestamp ?? new Date().toISOString(),
    metadata: {
      total_turns: payload.total_turns,
    },
  };
}

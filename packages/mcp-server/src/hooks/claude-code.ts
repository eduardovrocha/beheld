import { createHash, randomUUID } from "crypto";
import { sanitize, sanitizeCommand, sanitizeMetadata } from "../sanitizer";
import type { ClaudeCodeHookPayload, BeheldEvent } from "../types";

const TEST_KEYWORDS = ["rspec", "jest", "pytest", "playwright", "vitest"];

function hasTestContext(input?: Record<string, unknown>): boolean {
  if (!input) return false;
  const command = typeof input.command === "string" ? input.command.toLowerCase() : "";
  return TEST_KEYWORDS.some((kw) => command.includes(kw));
}

function fileExtension(input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;
  const fp =
    (input.file_path ?? input.path ?? input.relative_path ?? input.filename) as
      | string
      | undefined;
  if (typeof fp !== "string") return undefined;
  const parts = fp.split(".");
  if (parts.length < 2) return undefined;
  const ext = parts[parts.length - 1];
  return ext.length > 0 && ext.length < 12 ? ext : undefined;
}

function cwdHash(cwd?: string): string | undefined {
  if (!cwd) return undefined;
  return createHash("sha256").update(cwd).digest("hex");
}

export function handlePreToolUse(body: unknown): BeheldEvent {
  const safe = sanitize(body) as ClaudeCodeHookPayload;
  const input = safe.tool_input ?? {};
  return {
    event_id: randomUUID(),
    session_id: safe.session_id,
    source: "claude-code",
    event_type: "pre_tool_use",
    timestamp: safe.timestamp ?? new Date().toISOString(),
    tool_name: safe.tool_name,
    file_extension: fileExtension(input),
    command_sanitized:
      safe.tool_name === "Bash" && typeof input.command === "string"
        ? sanitizeCommand(input.command.slice(0, 500))
        : undefined,
    has_test_context:
      safe.tool_name === "Bash" ? hasTestContext(input) : undefined,
    cwd_hash: cwdHash(safe.cwd),
    metadata: sanitizeMetadata(input as Record<string, unknown>),
  };
}

export function handlePostToolUse(body: unknown): BeheldEvent {
  const safe = sanitize(body) as ClaudeCodeHookPayload & { duration_ms?: number };
  return {
    event_id: randomUUID(),
    session_id: safe.session_id,
    source: "claude-code",
    event_type: "post_tool_use",
    timestamp: new Date().toISOString(),
    tool_name: safe.tool_name,
    duration_ms: safe.duration_ms,
    metadata: {},
  };
}

export function handleStop(body: unknown): BeheldEvent {
  const safe = sanitize(body) as ClaudeCodeHookPayload;
  return {
    event_id: randomUUID(),
    session_id: safe.session_id,
    source: "claude-code",
    event_type: "stop",
    timestamp: safe.timestamp ?? new Date().toISOString(),
    metadata: { total_turns: safe.total_turns },
  };
}

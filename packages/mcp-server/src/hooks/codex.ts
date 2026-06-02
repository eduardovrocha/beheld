/**
 * R2.3 — Codex CLI adapter (native_hook).
 *
 * Codex CLI exposes a Claude-Code-style hook surface:
 *   - `before_command` fires before tool execution → pre_tool_use
 *   - `after_command`  fires after tool execution  → post_tool_use
 *   - `session_end`    fires on session close      → stop
 *
 * Codex's payload calls the tool field `command_name`; we accept either
 * `tool_name` or `command_name` so the wire stays forgiving across Codex
 * minor versions. The output BeheldEvent shape is canonical.
 *
 * Capture fidelity: `native_hook` (engine harness_registry.py).
 *
 * Privacy invariants (carried in unchanged):
 *   - `sanitize` strips secrets from every event before any write.
 *   - Bash `command` is bounded to 500 chars and re-sanitised.
 *   - `cwd` is SHA-256 hashed; never the raw path.
 */
import { createHash, randomUUID } from "crypto";
import { sanitize, sanitizeCommand, sanitizeMetadata } from "../sanitizer";
import type { CodexCliHookPayload, BeheldEvent } from "../types";

const TEST_KEYWORDS = ["rspec", "jest", "pytest", "playwright", "vitest", "go test"];

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

/** Codex sometimes spells the tool field `command_name`; accept either. */
function pickToolName(safe: CodexCliHookPayload): string | undefined {
  return safe.tool_name ?? safe.command_name;
}

export function handleCodexBeforeCommand(body: unknown): BeheldEvent {
  const safe = sanitize(body) as CodexCliHookPayload;
  const input = safe.tool_input ?? {};
  const toolName = pickToolName(safe);
  return {
    event_id: randomUUID(),
    session_id: safe.session_id,
    source: "codex-cli",
    event_type: "pre_tool_use",
    timestamp: safe.timestamp ?? new Date().toISOString(),
    tool_name: toolName,
    file_extension: fileExtension(input),
    command_sanitized:
      toolName === "Bash" && typeof input.command === "string"
        ? sanitizeCommand(input.command.slice(0, 500))
        : undefined,
    has_test_context: toolName === "Bash" ? hasTestContext(input) : undefined,
    cwd_hash: cwdHash(safe.cwd),
    metadata: sanitizeMetadata(input as Record<string, unknown>),
  };
}

export function handleCodexAfterCommand(body: unknown): BeheldEvent {
  const safe = sanitize(body) as CodexCliHookPayload;
  return {
    event_id: randomUUID(),
    session_id: safe.session_id,
    source: "codex-cli",
    event_type: "post_tool_use",
    timestamp: new Date().toISOString(),
    tool_name: pickToolName(safe),
    duration_ms: safe.duration_ms,
    metadata: {},
  };
}

export function handleCodexSessionEnd(body: unknown): BeheldEvent {
  const safe = sanitize(body) as CodexCliHookPayload;
  return {
    event_id: randomUUID(),
    session_id: safe.session_id,
    source: "codex-cli",
    event_type: "stop",
    timestamp: safe.timestamp ?? new Date().toISOString(),
    metadata: { total_turns: safe.total_turns },
  };
}

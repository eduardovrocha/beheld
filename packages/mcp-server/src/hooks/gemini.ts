/**
 * R2.1 — Gemini CLI adapter (native_hook).
 *
 * Mirrors `claude-code.ts`: Gemini CLI emits PreToolUse / PostToolUse / Stop
 * hooks at tool-invocation boundaries, and the resulting BeheldEvent shape
 * is identical to Claude Code's. The only differences are the source
 * stamp (`"gemini-cli"`) and an isolated type (`GeminiCliHookPayload`) so
 * future hook-schema drift on the Gemini side doesn't ripple into the
 * Claude Code handler.
 *
 * Privacy invariants (carried in unchanged from claude-code.ts):
 *   - `sanitize` strips secrets (env values, ghp_*, sk-*, bearer tokens)
 *     from every event before any write.
 *   - Bash `command` field is bounded to 500 chars and re-sanitised — no
 *     full shell history in the bundle.
 *   - `cwd` is hashed (SHA-256) — never the raw path.
 *
 * Capture fidelity: `native_hook` (engine harness_registry.py).
 */
import { createHash, randomUUID } from "crypto";
import { sanitize, sanitizeCommand, sanitizeMetadata } from "../sanitizer";
import type { GeminiCliHookPayload, BeheldEvent } from "../types";

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

export function handleGeminiPreToolUse(body: unknown): BeheldEvent {
  const safe = sanitize(body) as GeminiCliHookPayload;
  const input = safe.tool_input ?? {};
  return {
    event_id: randomUUID(),
    session_id: safe.session_id,
    source: "gemini-cli",
    event_type: "pre_tool_use",
    timestamp: safe.timestamp ?? new Date().toISOString(),
    tool_name: safe.tool_name,
    file_extension: fileExtension(input),
    // Gemini CLI's bash-equivalent tool is also named "Bash" in current
    // builds; the conditional matches the Claude Code handler to keep the
    // pre/post pair symmetric for downstream classifiers.
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

export function handleGeminiPostToolUse(body: unknown): BeheldEvent {
  const safe = sanitize(body) as GeminiCliHookPayload;
  return {
    event_id: randomUUID(),
    session_id: safe.session_id,
    source: "gemini-cli",
    event_type: "post_tool_use",
    timestamp: new Date().toISOString(),
    tool_name: safe.tool_name,
    duration_ms: safe.duration_ms,
    metadata: {},
  };
}

export function handleGeminiStop(body: unknown): BeheldEvent {
  const safe = sanitize(body) as GeminiCliHookPayload;
  return {
    event_id: randomUUID(),
    session_id: safe.session_id,
    source: "gemini-cli",
    event_type: "stop",
    timestamp: safe.timestamp ?? new Date().toISOString(),
    metadata: { total_turns: safe.total_turns },
  };
}

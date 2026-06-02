/**
 * R2.1 — Gemini CLI adapter tests.
 *
 * Mirrors the shape of `hooks.test.ts` (Claude Code) so future divergence
 * is loud: any new behaviour we add to Claude Code that Gemini must also
 * support shows up as a missing assertion here.
 *
 * Pinned invariants:
 *   - source stamp is the literal kebab-case `"gemini-cli"` (matches
 *     harness_registry.py exactly)
 *   - sanitiser stays in the path (Bearer / sk-/ ghp_ patterns redacted)
 *   - cwd_hash is a SHA-256 hex (no raw paths leak)
 *   - test-keyword detection covers the same harness-agnostic toolkit
 */
import { test, expect, describe } from "bun:test";
import { createHash } from "crypto";
import {
  handleGeminiPreToolUse,
  handleGeminiPostToolUse,
  handleGeminiStop,
} from "../src/hooks/gemini";

describe("handleGeminiPreToolUse — R2.1", () => {
  test("creates pre_tool_use event stamped with source='gemini-cli'", () => {
    const event = handleGeminiPreToolUse({
      session_id: "g-sess-1",
      tool_name: "Bash",
      tool_input: { command: "npm run build" },
      timestamp: "2026-06-01T12:00:00Z",
    });
    expect(event.event_type).toBe("pre_tool_use");
    expect(event.session_id).toBe("g-sess-1");
    expect(event.source).toBe("gemini-cli");
    expect(event.tool_name).toBe("Bash");
    expect(event.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.timestamp).toBe("2026-06-01T12:00:00Z");
  });

  test("detects has_test_context for the harness-agnostic test toolkit", () => {
    for (const cmd of ["rspec spec/", "jest --watch", "pytest -q", "playwright test", "vitest run", "go test ./..."]) {
      const event = handleGeminiPreToolUse({
        session_id: "s",
        tool_name: "Bash",
        tool_input: { command: cmd },
      });
      expect(event.has_test_context).toBe(true);
    }
  });

  test("non-Bash tools never carry command_sanitized / has_test_context", () => {
    const event = handleGeminiPreToolUse({
      session_id: "s",
      tool_name: "Edit",
      tool_input: { file_path: "src/main.ts", new_str: "" },
    });
    expect(event.command_sanitized).toBeUndefined();
    expect(event.has_test_context).toBeUndefined();
    expect(event.file_extension).toBe("ts");
  });

  test("cwd is hashed, never echoed raw", () => {
    const cwd = "/Users/eduardo/private-project";
    const expected = createHash("sha256").update(cwd).digest("hex");
    const event = handleGeminiPreToolUse({
      session_id: "s",
      tool_name: "Bash",
      tool_input: { command: "ls" },
      cwd,
    });
    expect(event.cwd_hash).toBe(expected);
    expect(JSON.stringify(event)).not.toContain(cwd);
  });

  test("sanitiser still redacts secrets inside Bash command", () => {
    const event = handleGeminiPreToolUse({
      session_id: "s",
      tool_name: "Bash",
      tool_input: {
        command: "curl -H 'Authorization: Bearer sk-abc123secrettoken' https://api",
      },
    });
    expect(event.command_sanitized).toBeDefined();
    expect(event.command_sanitized!).not.toContain("sk-abc123secrettoken");
  });

  test("bounded command length at 500 chars", () => {
    const long = "echo " + "x".repeat(800);
    const event = handleGeminiPreToolUse({
      session_id: "s",
      tool_name: "Bash",
      tool_input: { command: long },
    });
    expect(event.command_sanitized!.length).toBeLessThanOrEqual(500);
  });
});

describe("handleGeminiPostToolUse — R2.1", () => {
  test("creates post_tool_use event with duration", () => {
    const event = handleGeminiPostToolUse({
      session_id: "g-sess-2",
      tool_name: "Bash",
      duration_ms: 420,
    });
    expect(event.event_type).toBe("post_tool_use");
    expect(event.source).toBe("gemini-cli");
    expect(event.duration_ms).toBe(420);
  });
});

describe("handleGeminiStop — R2.1", () => {
  test("creates stop event with total_turns in metadata", () => {
    const event = handleGeminiStop({
      session_id: "g-sess-3",
      total_turns: 17,
      timestamp: "2026-06-01T13:00:00Z",
    });
    expect(event.event_type).toBe("stop");
    expect(event.source).toBe("gemini-cli");
    expect(event.metadata.total_turns).toBe(17);
    expect(event.timestamp).toBe("2026-06-01T13:00:00Z");
  });

  test("falls back to current ISO timestamp when payload omits it", () => {
    const event = handleGeminiStop({ session_id: "s" });
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

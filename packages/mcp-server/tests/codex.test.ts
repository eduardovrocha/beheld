/**
 * R2.3 — Codex CLI adapter tests.
 *
 * Mirrors the Gemini suite, with one extra group ("command_name alias")
 * because Codex spells the tool field two ways on the wire.
 */
import { test, expect, describe } from "bun:test";
import { createHash } from "crypto";
import {
  handleCodexBeforeCommand,
  handleCodexAfterCommand,
  handleCodexSessionEnd,
} from "../src/hooks/codex";

describe("handleCodexBeforeCommand — R2.3", () => {
  test("creates pre_tool_use event stamped with source='codex-cli'", () => {
    const event = handleCodexBeforeCommand({
      session_id: "codex-sess-1",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      timestamp: "2026-06-01T10:00:00Z",
    });
    expect(event.event_type).toBe("pre_tool_use");
    expect(event.source).toBe("codex-cli");
    expect(event.tool_name).toBe("Bash");
    expect(event.has_test_context).toBe(false); // "npm test" without test runner kw
    expect(event.event_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("detects test context for harness-agnostic keywords", () => {
    for (const cmd of ["rspec spec/", "jest", "pytest", "vitest", "playwright test", "go test"]) {
      const e = handleCodexBeforeCommand({
        session_id: "s", tool_name: "Bash", tool_input: { command: cmd },
      });
      expect(e.has_test_context).toBe(true);
    }
  });

  test("sanitises bash secrets + bounds at 500 chars", () => {
    const cmd = "curl -H 'Authorization: Bearer ghp_LeakedToken123456' " + "x".repeat(700);
    const e = handleCodexBeforeCommand({
      session_id: "s", tool_name: "Bash", tool_input: { command: cmd },
    });
    expect(e.command_sanitized!.length).toBeLessThanOrEqual(500);
    expect(e.command_sanitized!).not.toContain("ghp_LeakedToken123456");
  });

  test("cwd hashed, never echoed raw", () => {
    const cwd = "/Users/eduardo/private-codex-project";
    const expected = createHash("sha256").update(cwd).digest("hex");
    const e = handleCodexBeforeCommand({
      session_id: "s", tool_name: "Bash", tool_input: { command: "ls" }, cwd,
    });
    expect(e.cwd_hash).toBe(expected);
    expect(JSON.stringify(e)).not.toContain(cwd);
  });

  test("non-Bash tool: file extension only, no command, no test ctx", () => {
    const e = handleCodexBeforeCommand({
      session_id: "s",
      tool_name: "Read",
      tool_input: { path: "src/index.go" },
    });
    expect(e.file_extension).toBe("go");
    expect(e.command_sanitized).toBeUndefined();
    expect(e.has_test_context).toBeUndefined();
  });
});

describe("handleCodexBeforeCommand — R2.3 command_name alias", () => {
  test("accepts `command_name` as a synonym for `tool_name`", () => {
    const e = handleCodexBeforeCommand({
      session_id: "s",
      command_name: "Bash",
      tool_input: { command: "pytest" },
    });
    expect(e.tool_name).toBe("Bash");
    expect(e.has_test_context).toBe(true);
  });

  test("tool_name wins when both are present", () => {
    const e = handleCodexBeforeCommand({
      session_id: "s",
      tool_name: "Edit",
      command_name: "Bash",
      tool_input: { file_path: "x.ts" },
    });
    expect(e.tool_name).toBe("Edit");
    expect(e.file_extension).toBe("ts");
  });
});

describe("handleCodexAfterCommand — R2.3", () => {
  test("creates post_tool_use with duration + source", () => {
    const e = handleCodexAfterCommand({
      session_id: "s", tool_name: "Bash", duration_ms: 99,
    });
    expect(e.event_type).toBe("post_tool_use");
    expect(e.source).toBe("codex-cli");
    expect(e.duration_ms).toBe(99);
  });
});

describe("handleCodexSessionEnd — R2.3", () => {
  test("emits stop with total_turns", () => {
    const e = handleCodexSessionEnd({
      session_id: "s", total_turns: 9, timestamp: "2026-06-01T11:00:00Z",
    });
    expect(e.event_type).toBe("stop");
    expect(e.source).toBe("codex-cli");
    expect(e.metadata.total_turns).toBe(9);
    expect(e.timestamp).toBe("2026-06-01T11:00:00Z");
  });
});

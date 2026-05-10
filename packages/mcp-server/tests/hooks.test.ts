import { test, expect, describe } from "bun:test";
import { handlePreToolUse, handlePostToolUse, handleStop } from "../src/hooks/claude-code";
import { createHash } from "crypto";

describe("handlePreToolUse", () => {
  test("creates pre_tool_use event from Bash tool", () => {
    const event = handlePreToolUse({
      session_id: "sess-1",
      tool_name: "Bash",
      tool_input: { command: "npm run build" },
      timestamp: "2026-05-10T12:00:00Z",
    });
    expect(event.event_type).toBe("pre_tool_use");
    expect(event.session_id).toBe("sess-1");
    expect(event.tool_name).toBe("Bash");
    expect(event.source).toBe("claude-code");
    expect(event.event_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("detects has_test_context when command contains rspec", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "rspec spec/models/user_spec.rb" },
    });
    expect(event.has_test_context).toBe(true);
  });

  test("detects has_test_context when command contains jest", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "jest --watch" },
    });
    expect(event.has_test_context).toBe(true);
  });

  test("detects has_test_context when command contains pytest", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "pytest tests/ -v" },
    });
    expect(event.has_test_context).toBe(true);
  });

  test("detects has_test_context when command contains playwright", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "npx playwright test" },
    });
    expect(event.has_test_context).toBe(true);
  });

  test("detects has_test_context when command contains vitest", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "vitest run" },
    });
    expect(event.has_test_context).toBe(true);
  });

  test("has_test_context is false for non-test commands", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "git status" },
    });
    expect(event.has_test_context).toBe(false);
  });

  test("has_test_context is undefined for non-Bash tools", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Read",
      tool_input: { file_path: "/project/src/app.ts" },
    });
    expect(event.has_test_context).toBeUndefined();
  });

  test("extracts file_extension from Read tool path", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Read",
      tool_input: { file_path: "/project/src/app.ts" },
    });
    expect(event.file_extension).toBe("ts");
  });

  test("extracts file_extension from Write tool path", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Write",
      tool_input: { file_path: "/project/src/models/user.rb" },
    });
    expect(event.file_extension).toBe("rb");
  });

  test("command_sanitized is set for Bash tools", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    });
    expect(event.command_sanitized).toContain("npm test");
  });

  test("command_sanitized is undefined for non-Bash tools", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Read",
      tool_input: { file_path: "/project/src/app.ts" },
    });
    expect(event.command_sanitized).toBeUndefined();
  });

  test("cwd_hash is SHA256 hex of cwd", () => {
    const cwd = "/Users/john/secret-project";
    const expected = createHash("sha256").update(cwd).digest("hex");
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "ls" },
      cwd,
    });
    expect(event.cwd_hash).toBe(expected);
  });

  test("cwd_hash does not contain the raw path", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "ls" },
      cwd: "/Users/john/secret-project",
    });
    expect(event.cwd_hash).not.toContain("john");
    expect(event.cwd_hash).not.toContain("secret");
  });

  test("sanitizes API keys embedded in tool_input before storing", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: {
        command: "echo ok",
        env: "ANTHROPIC_API_KEY=sk-testABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      },
    });
    expect(JSON.stringify(event.metadata)).not.toContain("sk-test");
  });
});

describe("handlePostToolUse", () => {
  test("creates post_tool_use event", () => {
    const event = handlePostToolUse({
      session_id: "s1",
      tool_name: "Bash",
      duration_ms: 1234,
    });
    expect(event.event_type).toBe("post_tool_use");
    expect(event.tool_name).toBe("Bash");
    expect(event.duration_ms).toBe(1234);
    expect(event.source).toBe("claude-code");
  });

  test("duration_ms is optional", () => {
    const event = handlePostToolUse({ session_id: "s1", tool_name: "Read" });
    expect(event.duration_ms).toBeUndefined();
  });
});

describe("handleStop", () => {
  test("creates stop event with total_turns in metadata", () => {
    const event = handleStop({
      session_id: "s1",
      total_turns: 15,
      timestamp: "2026-05-10T12:30:00Z",
    });
    expect(event.event_type).toBe("stop");
    expect(event.session_id).toBe("s1");
    expect(event.metadata.total_turns).toBe(15);
    expect(event.timestamp).toBe("2026-05-10T12:30:00Z");
  });

  test("uses current timestamp when none provided", () => {
    const before = Date.now();
    const event = handleStop({ session_id: "s1" });
    const ts = new Date(event.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
  });
});

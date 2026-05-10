import { test, expect, describe } from "bun:test";
import {
  handlePreTool,
  handlePostTool,
  handleStop,
} from "../src/hooks/claude-code";

describe("handlePreTool", () => {
  test("creates pre_tool_use event from Bash tool", () => {
    const event = handlePreTool({
      session_id: "sess-1",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      timestamp: "2026-05-10T12:00:00Z",
    });
    expect(event.event_type).toBe("pre_tool_use");
    expect(event.session_id).toBe("sess-1");
    expect(event.tool_name).toBe("Bash");
    expect(event.source).toBe("claude-code");
    expect(event.command_sanitized).toContain("npm test");
    expect(event.event_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test("detects test context from rspec command", () => {
    const event = handlePreTool({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "rspec spec/models/user_spec.rb" },
    });
    expect(event.has_test_context).toBe(true);
  });

  test("detects test context from pytest command", () => {
    const event = handlePreTool({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "pytest tests/" },
    });
    expect(event.has_test_context).toBe(true);
  });

  test("detects test context from spec file path in Read tool", () => {
    const event = handlePreTool({
      session_id: "s1",
      tool_name: "Read",
      tool_input: { file_path: "/project/spec/user_spec.rb" },
    });
    expect(event.has_test_context).toBe(true);
  });

  test("detects test context from .test. file extension", () => {
    const event = handlePreTool({
      session_id: "s1",
      tool_name: "Write",
      tool_input: { file_path: "/project/src/utils.test.ts" },
    });
    expect(event.has_test_context).toBe(true);
  });

  test("extracts ts file extension from Read tool", () => {
    const event = handlePreTool({
      session_id: "s1",
      tool_name: "Read",
      tool_input: { file_path: "/project/src/app.ts" },
    });
    expect(event.file_extension).toBe("ts");
  });

  test("extracts rb file extension", () => {
    const event = handlePreTool({
      session_id: "s1",
      tool_name: "Read",
      tool_input: { file_path: "/project/app/models/user.rb" },
    });
    expect(event.file_extension).toBe("rb");
  });

  test("no command_sanitized for non-Bash tools", () => {
    const event = handlePreTool({
      session_id: "s1",
      tool_name: "Read",
      tool_input: { file_path: "/project/src/app.ts" },
    });
    expect(event.command_sanitized).toBeUndefined();
  });

  test("sanitizes API keys in bash commands", () => {
    const event = handlePreTool({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: {
        command:
          "curl -H 'Authorization: Bearer sk-abc12345678901234567890123456789012345' api.example.com",
      },
    });
    expect(event.command_sanitized).not.toContain("sk-abc");
    expect(event.command_sanitized).toContain("[REDACTED]");
  });

  test("hashes cwd without revealing path", () => {
    const event = handlePreTool({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "ls" },
      cwd: "/Users/john/secret-project",
    });
    expect(event.cwd_hash).toBeTruthy();
    expect(event.cwd_hash).not.toContain("john");
    expect(event.cwd_hash).not.toContain("secret-project");
  });

  test("no test context for non-test code", () => {
    const event = handlePreTool({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "git status" },
    });
    expect(event.has_test_context).toBe(false);
  });
});

describe("handlePostTool", () => {
  test("creates post_tool_use event", () => {
    const event = handlePostTool({
      session_id: "s1",
      tool_name: "Bash",
      duration_ms: 1234,
    } as Parameters<typeof handlePostTool>[0] & { duration_ms: number });
    expect(event.event_type).toBe("post_tool_use");
    expect(event.tool_name).toBe("Bash");
    expect(event.duration_ms).toBe(1234);
    expect(event.source).toBe("claude-code");
  });

  test("duration_ms is optional", () => {
    const event = handlePostTool({ session_id: "s1", tool_name: "Read" });
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

  test("uses current timestamp when not provided", () => {
    const before = new Date().toISOString();
    const event = handleStop({ session_id: "s1" });
    expect(event.timestamp >= before).toBe(true);
  });
});

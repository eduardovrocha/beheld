import { test, expect, describe } from "bun:test";
import { handleMcpRequest } from "../src/hooks/continue";

describe("handleMcpRequest — Continue.dev event extraction", () => {
  test("returns null for MCP initialize (protocol message)", () => {
    const result = handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(result).toBeNull();
  });

  test("returns null for tools/list", () => {
    expect(handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" })).toBeNull();
  });

  test("returns null for tools/call", () => {
    expect(
      handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "beheld" } }),
    ).toBeNull();
  });

  test("returns null for unknown event type", () => {
    expect(handleMcpRequest({ event_type: "unknown_event" })).toBeNull();
  });

  test("returns null for non-object input", () => {
    expect(handleMcpRequest(null)).toBeNull();
    expect(handleMcpRequest("string")).toBeNull();
    expect(handleMcpRequest(42)).toBeNull();
  });

  describe("chat_request", () => {
    test("extracts prompt_length from text length", () => {
      const event = handleMcpRequest({
        event_type: "chat_request",
        params: { text: "hello world", session_id: "s1" },
      });
      expect(event).not.toBeNull();
      expect(event!.event_type).toBe("chat_request");
      expect(event!.prompt_length).toBe(11);
      expect(event!.source).toBe("continue-vscode");
    });

    test("has_code_context is true when file_context is present", () => {
      const event = handleMcpRequest({
        event_type: "chat_request",
        params: {
          text: "explain this",
          session_id: "s1",
          file_context: { path: "/project/src/main.ts" },
        },
      });
      expect(event!.metadata.has_code_context).toBe(true);
    });

    test("has_code_context is false when no file_context", () => {
      const event = handleMcpRequest({
        event_type: "chat_request",
        params: { text: "hello", session_id: "s1" },
      });
      expect(event!.metadata.has_code_context).toBe(false);
    });

    test("extracts file_extension from file_context.path", () => {
      const event = handleMcpRequest({
        event_type: "chat_request",
        params: {
          text: "explain",
          session_id: "s1",
          file_context: { path: "/project/models/user.rb" },
        },
      });
      expect(event!.file_extension).toBe("rb");
    });
  });

  describe("chat_response", () => {
    test("extracts duration_ms and response_length", () => {
      const event = handleMcpRequest({
        event_type: "chat_response",
        params: {
          text: "Here is the answer.",
          session_id: "s1",
          duration_ms: 1500,
          model: "claude-sonnet-4-6",
        },
      });
      expect(event).not.toBeNull();
      expect(event!.event_type).toBe("chat_response");
      expect(event!.duration_ms).toBe(1500);
      expect(event!.metadata.response_length).toBe(19);
      expect(event!.metadata.model).toBe("claude-sonnet-4-6");
    });
  });

  describe("edit_apply", () => {
    test("extracts file_extension and lines_changed", () => {
      const event = handleMcpRequest({
        event_type: "edit_apply",
        params: {
          file_path: "/project/src/service.py",
          lines_changed: 12,
          session_id: "s1",
        },
      });
      expect(event).not.toBeNull();
      expect(event!.event_type).toBe("edit_apply");
      expect(event!.file_extension).toBe("py");
      expect(event!.metadata.lines_changed).toBe(12);
    });
  });

  describe("command_run", () => {
    test("extracts sanitized command, exit_code, duration_ms", () => {
      const event = handleMcpRequest({
        event_type: "command_run",
        params: {
          command: "npm test",
          exit_code: 0,
          duration_ms: 800,
          session_id: "s1",
        },
      });
      expect(event).not.toBeNull();
      expect(event!.event_type).toBe("command_run");
      expect(event!.command_sanitized).toContain("npm test");
      expect(event!.metadata.exit_code).toBe(0);
      expect(event!.duration_ms).toBe(800);
    });

    test("command_sanitized does not contain secrets", () => {
      const event = handleMcpRequest({
        event_type: "command_run",
        params: {
          command: "curl -H 'Authorization: Bearer sk-abc1234567890123456789012345678901234' api.com",
          session_id: "s1",
        },
      });
      expect(event!.command_sanitized).toContain("<redacted>");
      expect(event!.command_sanitized).not.toContain("sk-abc");
    });
  });
});

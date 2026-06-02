/**
 * R2.2 — Cursor adapter tests.
 *
 * Cursor lands as a four-way discriminated union (tool_use, chat_request,
 * edit_apply, stop). Each branch has its own pinned invariants so a future
 * refactor can't accidentally turn `chat_request` into a `tool_use` or
 * drop the sanitiser in the terminal branch.
 */
import { test, expect, describe } from "bun:test";
import { createHash } from "crypto";
import { handleCursorEvent } from "../src/hooks/cursor";

describe("handleCursorEvent — R2.2 tool_use", () => {
  test("emits pre_tool_use with source='cursor'", () => {
    const event = handleCursorEvent({
      event_type: "tool_use",
      session_id: "cur-1",
      tool_name: "terminal",
      command: "npm test",
      timestamp: "2026-06-01T10:00:00Z",
    });
    expect(event?.event_type).toBe("pre_tool_use");
    expect(event?.source).toBe("cursor");
    expect(event?.session_id).toBe("cur-1");
  });

  test("sanitises terminal command + bounds at 500 chars + detects test ctx", () => {
    const cmd = "pytest -k 'my Bearer abc-secret-leak' " + "x".repeat(800);
    const event = handleCursorEvent({
      event_type: "tool_use",
      tool_name: "terminal",
      command: cmd,
    });
    expect(event?.command_sanitized).toBeDefined();
    expect(event!.command_sanitized!.length).toBeLessThanOrEqual(500);
    expect(event?.has_test_context).toBe(true);
    expect(event?.command_sanitized!).not.toContain("abc-secret-leak");
  });

  test("non-terminal tool_use captures file_extension only, no command", () => {
    const event = handleCursorEvent({
      event_type: "tool_use",
      tool_name: "edit",
      file_path: "src/lib/x.ts",
    });
    expect(event?.tool_name).toBe("edit");
    expect(event?.file_extension).toBe("ts");
    expect(event?.command_sanitized).toBeUndefined();
    expect(event?.has_test_context).toBeUndefined();
  });
});

describe("handleCursorEvent — R2.2 chat_request", () => {
  test("ingests prompt_length without text, preserves source", () => {
    const event = handleCursorEvent({
      event_type: "chat_request",
      session_id: "cur-2",
      prompt_length: 287,
      file_path: "app/models/user.rb",
    });
    expect(event?.event_type).toBe("chat_request");
    expect(event?.source).toBe("cursor");
    expect(event?.prompt_length).toBe(287);
    expect(event?.file_extension).toBe("rb");
  });
});

describe("handleCursorEvent — R2.2 edit_apply", () => {
  test("captures duration_ms + extension, never raw path", () => {
    const event = handleCursorEvent({
      event_type: "edit_apply",
      file_path: "/Users/eduardo/secret-project/src/main.go",
      duration_ms: 134,
    });
    expect(event?.event_type).toBe("edit_apply");
    expect(event?.file_extension).toBe("go");
    expect(event?.duration_ms).toBe(134);
    expect(JSON.stringify(event)).not.toContain("/Users/eduardo/secret-project");
  });
});

describe("handleCursorEvent — R2.2 stop", () => {
  test("emits stop + total_turns + hashed workspace", () => {
    const ws = "/Users/eduardo/private";
    const expected = createHash("sha256").update(ws).digest("hex");
    const event = handleCursorEvent({
      event_type: "stop",
      session_id: "cur-3",
      total_turns: 14,
      workspace: ws,
    });
    expect(event?.event_type).toBe("stop");
    expect(event?.metadata.total_turns).toBe(14);
    expect(event?.cwd_hash).toBe(expected);
    expect(JSON.stringify(event)).not.toContain(ws);
  });
});

describe("handleCursorEvent — R2.2 unknown / malformed", () => {
  test("returns null for unknown event_type", () => {
    expect(handleCursorEvent({ event_type: "heartbeat" })).toBeNull();
  });

  test("returns null for missing event_type", () => {
    expect(handleCursorEvent({ session_id: "x" })).toBeNull();
  });

  test("returns null for non-object body", () => {
    expect(handleCursorEvent(null)).toBeNull();
    expect(handleCursorEvent(42)).toBeNull();
  });
});

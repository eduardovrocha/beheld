/**
 * R2.4 — Copilot CLI adapter tests.
 *
 * Three discriminated channels: statusline_poll, log_line, session_end.
 * Each branch is pinned, and the unknown-channel fallback is tested so
 * future Copilot CLI releases that invent new channels degrade safely.
 */
import { test, expect, describe } from "bun:test";
import { createHash } from "crypto";
import { handleCopilotCliEvent } from "../src/hooks/copilot-cli";

describe("handleCopilotCliEvent — R2.4 statusline_poll", () => {
  test("emits statusline_poll with normalised state", () => {
    const e = handleCopilotCliEvent({
      channel: "statusline_poll",
      session_id: "cop-1",
      state: "RUNNING",
      timestamp: "2026-06-01T12:00:00Z",
    });
    expect(e?.event_type).toBe("statusline_poll");
    expect(e?.source).toBe("copilot-cli");
    expect(e?.metadata.channel).toBe("statusline");
    expect(e?.metadata.state).toBe("running");
  });

  test("unknown statusline state collapses to 'unknown' (not dropped)", () => {
    const e = handleCopilotCliEvent({
      channel: "statusline_poll", state: "FUTURE-STATE-NOT-YET-DEFINED",
    });
    expect(e?.metadata.state).toBe("unknown");
  });

  test("missing state field still emits a poll with state='unknown'", () => {
    const e = handleCopilotCliEvent({ channel: "statusline_poll", session_id: "s" });
    expect(e?.event_type).toBe("statusline_poll");
    expect(e?.metadata.state).toBe("unknown");
  });
});

describe("handleCopilotCliEvent — R2.4 log_line", () => {
  test("execute tool → command sanitised + bounded + test ctx detected", () => {
    const cmd = "pytest -k 'leak' Bearer ghp_LeakedToken " + "x".repeat(700);
    const e = handleCopilotCliEvent({
      channel: "log_line",
      tool_name: "execute",
      command: cmd,
      session_id: "cop-2",
    });
    expect(e?.event_type).toBe("pre_tool_use");
    expect(e?.metadata.channel).toBe("log_tail");
    expect(e?.command_sanitized!.length).toBeLessThanOrEqual(500);
    expect(e?.command_sanitized!).not.toContain("ghp_LeakedToken");
    expect(e?.has_test_context).toBe(true);
  });

  test("non-execute tool → extension only, no command, no test ctx", () => {
    const e = handleCopilotCliEvent({
      channel: "log_line",
      tool_name: "suggest",
      file_path: "app/main.go",
    });
    expect(e?.file_extension).toBe("go");
    expect(e?.command_sanitized).toBeUndefined();
    expect(e?.has_test_context).toBeUndefined();
  });

  test("preserves prompt_length without text", () => {
    const e = handleCopilotCliEvent({
      channel: "log_line", tool_name: "explain", prompt_length: 124,
    });
    expect(e?.prompt_length).toBe(124);
  });
});

describe("handleCopilotCliEvent — R2.4 session_end", () => {
  test("emits stop with channel + total_turns + workspace hashed", () => {
    const ws = "/Users/eduardo/work-with-copilot";
    const expected = createHash("sha256").update(ws).digest("hex");
    const e = handleCopilotCliEvent({
      channel: "session_end", session_id: "cop-3", total_turns: 5, workspace: ws,
    });
    expect(e?.event_type).toBe("stop");
    expect(e?.metadata.channel).toBe("statusline");
    expect(e?.metadata.total_turns).toBe(5);
    expect(e?.cwd_hash).toBe(expected);
    expect(JSON.stringify(e)).not.toContain(ws);
  });
});

describe("handleCopilotCliEvent — R2.4 unknown / malformed", () => {
  test("unknown channel → null", () => {
    expect(handleCopilotCliEvent({ channel: "future_channel" })).toBeNull();
  });
  test("missing channel → null", () => {
    expect(handleCopilotCliEvent({})).toBeNull();
  });
  test("non-object body → null", () => {
    expect(handleCopilotCliEvent(null)).toBeNull();
    expect(handleCopilotCliEvent("hello")).toBeNull();
  });
});

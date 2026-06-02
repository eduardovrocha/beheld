/**
 * R2.2 — Cursor log tail tests.
 *
 * Exercises the four-piece pipeline: line parser, offset persistence,
 * newest-file selection, and end-to-end POST gating. All tests use
 * isolated tmp dirs + an injected `post` so nothing leaves the test
 * boundary.
 */
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseLogLine, loadState, saveState, pollOnce,
  type CursorEventPayload,
} from "../src/lib/cursor-tail";

describe("parseLogLine — R2.2", () => {
  test("maps Cursor's `type` field to canonical event_type", () => {
    expect(parseLogLine(JSON.stringify({ type: "tool"   }))?.event_type).toBe("tool_use");
    expect(parseLogLine(JSON.stringify({ type: "prompt" }))?.event_type).toBe("chat_request");
    expect(parseLogLine(JSON.stringify({ type: "edit"   }))?.event_type).toBe("edit_apply");
    expect(parseLogLine(JSON.stringify({ type: "end"    }))?.event_type).toBe("stop");
  });

  test("explicit event_type wins over `type` alias", () => {
    const p = parseLogLine(JSON.stringify({
      event_type: "tool_use", type: "prompt", session_id: "s",
    }));
    expect(p?.event_type).toBe("tool_use");
    expect(p?.session_id).toBe("s");
  });

  test("drops non-JSON lines silently", () => {
    expect(parseLogLine("not json at all")).toBeNull();
    expect(parseLogLine("")).toBeNull();
  });

  test("drops lines without a recognised type", () => {
    expect(parseLogLine(JSON.stringify({ type: "heartbeat" }))).toBeNull();
    expect(parseLogLine(JSON.stringify({ payload: 1 }))).toBeNull();
  });

  test("preserves the metadata object verbatim (sanitiser runs server-side)", () => {
    const p = parseLogLine(JSON.stringify({
      type: "tool",
      metadata: { project: "x", model: "claude-3-5" },
    }));
    expect(p?.metadata).toEqual({ project: "x", model: "claude-3-5" });
  });

  test("ignores numeric fields when wrong type", () => {
    const p = parseLogLine(JSON.stringify({
      type: "prompt", prompt_length: "lots", duration_ms: 12,
    }));
    expect(p?.prompt_length).toBeUndefined();
    expect(p?.duration_ms).toBe(12);
  });
});

// ── pollOnce + state I/O ────────────────────────────────────────────────

let root: string;
let logsDir: string;
let stateFile: string;
let received: CursorEventPayload[];

beforeEach(() => {
  root      = mkdtempSync(join(tmpdir(), "beheld-cursor-tail-"));
  logsDir   = join(root, "logs");
  mkdirSync(logsDir, { recursive: true });
  stateFile = join(root, ".cursor-tail.cursor");
  received  = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const sink = async (p: CursorEventPayload) => { received.push(p); };

describe("pollOnce — R2.2", () => {
  test("no logs → returns 0, no state file written", async () => {
    const n = await pollOnce({ logsDir, stateFile, post: sink });
    expect(n).toBe(0);
    expect(loadState(stateFile)).toBeNull();
  });

  test("emits each parseable line + advances offset to end of file", async () => {
    const log = join(logsDir, "main.log");
    const lines = [
      JSON.stringify({ type: "tool",   session_id: "s1", tool_name: "edit"    }),
      "not json",
      JSON.stringify({ type: "prompt", session_id: "s1", prompt_length: 14    }),
      JSON.stringify({ type: "end",    session_id: "s1", total_turns: 2      }),
    ];
    writeFileSync(log, lines.join("\n") + "\n");

    const n = await pollOnce({ logsDir, stateFile, post: sink });
    expect(n).toBe(3); // the "not json" line is dropped silently
    expect(received.map(r => r.event_type)).toEqual([
      "tool_use", "chat_request", "stop",
    ]);
    const s = loadState(stateFile);
    expect(s).not.toBeNull();
    expect(s!.log_file).toBe(log);
    expect(s!.offset).toBe(readFileSync(log).length);
  });

  test("re-running with no new lines is a no-op", async () => {
    const log = join(logsDir, "main.log");
    writeFileSync(log, JSON.stringify({ type: "tool" }) + "\n");
    await pollOnce({ logsDir, stateFile, post: sink });
    received.length = 0;
    const n = await pollOnce({ logsDir, stateFile, post: sink });
    expect(n).toBe(0);
    expect(received).toEqual([]);
  });

  test("log rotation: new log file appears → offset resets to 0", async () => {
    const oldLog = join(logsDir, "old.log");
    writeFileSync(oldLog, JSON.stringify({ type: "tool", session_id: "old" }) + "\n");
    await pollOnce({ logsDir, stateFile, post: sink });
    received.length = 0;

    // New log with a later mtime — touching the file after a small sleep
    // is fragile, so we just write a different file last (mtime ordering
    // is then deterministic on every reasonable filesystem).
    const newLog = join(logsDir, "newer.log");
    // Force newer mtime by writing after a measurable delay.
    await new Promise(r => setTimeout(r, 10));
    writeFileSync(newLog, JSON.stringify({ type: "tool", session_id: "new" }) + "\n");

    const n = await pollOnce({ logsDir, stateFile, post: sink });
    expect(n).toBe(1);
    expect(received[0].session_id).toBe("new");
    expect(loadState(stateFile)!.log_file).toBe(newLog);
  });

  test("POST failure mid-batch leaves offset unchanged for retry", async () => {
    const log = join(logsDir, "main.log");
    writeFileSync(log,
      JSON.stringify({ type: "tool" }) + "\n" +
      JSON.stringify({ type: "end"  }) + "\n",
    );

    let calls = 0;
    const flaky = async (_p: CursorEventPayload) => {
      calls++;
      if (calls === 2) throw new Error("network");
    };

    const n = await pollOnce({ logsDir, stateFile, post: flaky });
    expect(n).toBe(1);                       // only the first line landed
    expect(loadState(stateFile)).toBeNull(); // offset NOT persisted
  });
});

describe("saveState / loadState — R2.2", () => {
  test("round-trips structurally", () => {
    saveState({ log_file: "/a/b.log", offset: 42 }, stateFile);
    const s = loadState(stateFile);
    expect(s).toEqual({ log_file: "/a/b.log", offset: 42 });
  });

  test("returns null on corrupt state file", () => {
    writeFileSync(stateFile, "not json{");
    expect(loadState(stateFile)).toBeNull();
  });
});

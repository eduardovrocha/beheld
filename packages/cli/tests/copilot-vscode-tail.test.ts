/**
 * R2.5 — Copilot VS Code log tail tests.
 *
 * Same four-piece pipeline as cursor-tail, plus the alias-mapping tests
 * (Copilot's log uses several aliases for the same canonical event).
 */
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseLogLine, pollOnce, loadState,
  type CopilotVscodeEventPayload,
} from "../src/lib/copilot-vscode-tail";

describe("parseLogLine — copilot-vscode", () => {
  test("maps the documented aliases to canonical event_type", () => {
    expect(parseLogLine(JSON.stringify({ type: "ghost_text"          }))?.event_type).toBe("inline_suggestion");
    expect(parseLogLine(JSON.stringify({ event: "completion"          }))?.event_type).toBe("code_completion");
    expect(parseLogLine(JSON.stringify({ type: "chat_panel_request"  }))?.event_type).toBe("chat_request");
    expect(parseLogLine(JSON.stringify({ event: "shutdown"            }))?.event_type).toBe("session_end");
  });

  test("explicit event_type beats `event` / `type` aliases", () => {
    const p = parseLogLine(JSON.stringify({
      event_type: "code_completion", event: "shutdown", type: "ghost_text",
    }));
    expect(p?.event_type).toBe("code_completion");
  });

  test("drops non-JSON + unknown event types", () => {
    expect(parseLogLine("not json")).toBeNull();
    expect(parseLogLine("")).toBeNull();
    expect(parseLogLine(JSON.stringify({ type: "heartbeat" }))).toBeNull();
    expect(parseLogLine(JSON.stringify({ noise: 1 }))).toBeNull();
  });

  test("forwards numeric / object fields verbatim (sanitiser runs server-side)", () => {
    const p = parseLogLine(JSON.stringify({
      type: "ghost_text",
      prompt_length: 100,
      response_length: 24,
      duration_ms: 90,
      model: "copilot-codex",
      metadata: { language: "ts" },
    }));
    expect(p?.prompt_length).toBe(100);
    expect(p?.response_length).toBe(24);
    expect(p?.duration_ms).toBe(90);
    expect(p?.model).toBe("copilot-codex");
    expect(p?.metadata).toEqual({ language: "ts" });
  });
});

// ── pollOnce end-to-end ─────────────────────────────────────────────────

let root: string;
let logsDir: string;
let stateFile: string;
let received: CopilotVscodeEventPayload[];

beforeEach(() => {
  root      = mkdtempSync(join(tmpdir(), "beheld-copilot-vscode-tail-"));
  // Mirror VS Code's per-session layout: logsDir / <timestamp> / exthost1 / GitHub.copilot
  logsDir   = join(root, "logs");
  mkdirSync(join(logsDir, "20260601T100000", "exthost1", "GitHub.copilot"), { recursive: true });
  stateFile = join(root, ".copilot-vscode-tail.cursor");
  received  = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const sink = async (p: CopilotVscodeEventPayload) => { received.push(p); };

describe("pollOnce — copilot-vscode", () => {
  test("no logs (only empty dirs) → returns 0", async () => {
    const n = await pollOnce({ logsDir, stateFile, post: sink });
    expect(n).toBe(0);
    expect(loadState(stateFile)).toBeNull();
  });

  test("descends into per-session dirs, picks newest log via mtime", async () => {
    const log = join(logsDir, "20260601T100000", "exthost1", "GitHub.copilot", "main.log");
    writeFileSync(log, [
      JSON.stringify({ type: "ghost_text", prompt_length: 12 }),
      JSON.stringify({ event: "shutdown", total_turns: 4 }),
    ].join("\n") + "\n");

    const n = await pollOnce({ logsDir, stateFile, post: sink });
    expect(n).toBe(2);
    expect(received.map((r) => r.event_type)).toEqual(["inline_suggestion", "session_end"]);
    const s = loadState(stateFile);
    expect(s!.log_file).toBe(log);
    expect(s!.offset).toBe(readFileSync(log).length);
  });

  test("idempotent: second tick with no new lines does nothing", async () => {
    const log = join(logsDir, "20260601T100000", "exthost1", "GitHub.copilot", "main.log");
    writeFileSync(log, JSON.stringify({ type: "ghost_text" }) + "\n");
    await pollOnce({ logsDir, stateFile, post: sink });
    received.length = 0;
    const n = await pollOnce({ logsDir, stateFile, post: sink });
    expect(n).toBe(0);
    expect(received).toEqual([]);
  });

  test("new per-session dir → offset resets to 0 on the new file", async () => {
    const oldLog = join(logsDir, "20260601T100000", "exthost1", "GitHub.copilot", "old.log");
    writeFileSync(oldLog, JSON.stringify({ type: "ghost_text", session_id: "old" }) + "\n");
    await pollOnce({ logsDir, stateFile, post: sink });
    received.length = 0;

    // Newer VS Code session — distinct timestamped dir, later mtime.
    const newerDir = join(logsDir, "20260601T110000", "exthost1", "GitHub.copilot");
    mkdirSync(newerDir, { recursive: true });
    await new Promise((r) => setTimeout(r, 10));
    const newLog = join(newerDir, "new.log");
    writeFileSync(newLog, JSON.stringify({ type: "ghost_text", session_id: "new" }) + "\n");

    const n = await pollOnce({ logsDir, stateFile, post: sink });
    expect(n).toBe(1);
    expect(received[0].session_id).toBe("new");
    expect(loadState(stateFile)!.log_file).toBe(newLog);
  });

  test("POST failure mid-batch leaves offset unchanged for retry", async () => {
    const log = join(logsDir, "20260601T100000", "exthost1", "GitHub.copilot", "main.log");
    writeFileSync(log, [
      JSON.stringify({ type: "ghost_text" }),
      JSON.stringify({ type: "completion" }),
    ].join("\n") + "\n");

    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls === 2) throw new Error("network");
    };
    const n = await pollOnce({ logsDir, stateFile, post: flaky });
    expect(n).toBe(1);
    expect(loadState(stateFile)).toBeNull();
  });
});

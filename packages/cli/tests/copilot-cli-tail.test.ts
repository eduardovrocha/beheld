/**
 * R2.4 — Copilot CLI tail tests. Same shape as the VS Code tail tests.
 */
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseLogLine, pollOnce, loadState,
  type CopilotCliEventPayload,
} from "../src/lib/copilot-cli-tail";

describe("parseLogLine — copilot-cli", () => {
  test("maps subcommand aliases to canonical event_type", () => {
    expect(parseLogLine(JSON.stringify({ type: "suggest" }))?.event_type).toBe("suggestion");
    expect(parseLogLine(JSON.stringify({ event: "explain" }))?.event_type).toBe("explain_request");
    expect(parseLogLine(JSON.stringify({ type: "complete" }))?.event_type).toBe("shell_complete");
    expect(parseLogLine(JSON.stringify({ event: "end" }))?.event_type).toBe("session_end");
  });

  test("forwards surface field when it is one of the closed values", () => {
    expect(parseLogLine(JSON.stringify({
      type: "suggest", surface: "statusline",
    }))?.surface).toBe("statusline");
    expect(parseLogLine(JSON.stringify({
      type: "suggest", surface: "transcript",
    }))?.surface).toBe("transcript");
    // Unknown surface drops to undefined — keeps the engine's fidelity
    // downgrade rule clean.
    expect(parseLogLine(JSON.stringify({
      type: "suggest", surface: "twitter",
    }))?.surface).toBeUndefined();
  });

  test("drops malformed / unrecognised lines silently", () => {
    expect(parseLogLine("not json")).toBeNull();
    expect(parseLogLine(JSON.stringify({ type: "heartbeat" }))).toBeNull();
    expect(parseLogLine(JSON.stringify({ random: 1 }))).toBeNull();
  });

  test("forwards numeric metrics + subcommand + exit_code", () => {
    const p = parseLogLine(JSON.stringify({
      type: "suggest", subcommand: "explain",
      prompt_length: 80, response_length: 41, duration_ms: 220, exit_code: 0,
    }));
    expect(p?.subcommand).toBe("explain");
    expect(p?.prompt_length).toBe(80);
    expect(p?.response_length).toBe(41);
    expect(p?.duration_ms).toBe(220);
    expect(p?.exit_code).toBe(0);
  });
});

// ── pollOnce end-to-end ─────────────────────────────────────────────────

let root: string;
let logsDir: string;
let stateFile: string;
let received: CopilotCliEventPayload[];

beforeEach(() => {
  root      = mkdtempSync(join(tmpdir(), "beheld-copilot-cli-tail-"));
  logsDir   = join(root, "gh-copilot");
  mkdirSync(join(logsDir, "transcripts"), { recursive: true });
  stateFile = join(root, ".copilot-cli-tail.cursor");
  received  = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const sink = async (p: CopilotCliEventPayload) => { received.push(p); };

describe("pollOnce — copilot-cli", () => {
  test("missing logsDir → 0 emissions, no state file", async () => {
    const n = await pollOnce({ logsDir: undefined, stateFile, post: sink });
    expect(n).toBe(0);
    expect(loadState(stateFile)).toBeNull();
  });

  test("scans transcript files, emits one event per parsed line", async () => {
    const log = join(logsDir, "transcripts", "2026-06-01.transcript");
    writeFileSync(log, [
      JSON.stringify({ type: "suggest", subcommand: "explain",
                       surface: "transcript", prompt_length: 12 }),
      JSON.stringify({ type: "complete", surface: "statusline" }),
      JSON.stringify({ type: "end", session_id: "s1" }),
    ].join("\n") + "\n");

    const n = await pollOnce({ logsDir, stateFile, post: sink });
    expect(n).toBe(3);
    expect(received.map((r) => r.event_type)).toEqual([
      "suggestion", "shell_complete", "session_end",
    ]);
    const s = loadState(stateFile);
    expect(s!.log_file).toBe(log);
    expect(s!.offset).toBe(readFileSync(log).length);
  });

  test("appended lines on next tick deliver only the new entries", async () => {
    const log = join(logsDir, "transcripts", "2026-06-01.transcript");
    writeFileSync(log, JSON.stringify({ type: "suggest" }) + "\n");
    await pollOnce({ logsDir, stateFile, post: sink });
    received.length = 0;

    writeFileSync(log,
      JSON.stringify({ type: "suggest" }) + "\n" +
      JSON.stringify({ type: "complete" }) + "\n");
    const n = await pollOnce({ logsDir, stateFile, post: sink });
    expect(n).toBe(1);
    expect(received[0].event_type).toBe("shell_complete");
  });

  test("POST failure mid-batch keeps the offset so the same line is retried", async () => {
    const log = join(logsDir, "transcripts", "2026-06-01.transcript");
    writeFileSync(log, [
      JSON.stringify({ type: "suggest" }),
      JSON.stringify({ type: "complete" }),
    ].join("\n") + "\n");

    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls === 2) throw new Error("net");
    };
    const n = await pollOnce({ logsDir, stateFile, post: flaky });
    expect(n).toBe(1);
    expect(loadState(stateFile)).toBeNull();
  });
});

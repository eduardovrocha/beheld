import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { JsonlWriter } from "../src/writers/jsonl";
import type { BeheldEvent } from "../src/types";

let tmpDir: string;
let baseDir: string;
let writer: JsonlWriter;

function makeEvent(id: string, sessionId = "session-A", timestamp?: string): BeheldEvent {
  return {
    event_id: id,
    session_id: sessionId,
    source: "claude-code",
    event_type: "pre_tool_use",
    timestamp: timestamp ?? new Date().toISOString(),
    metadata: {},
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beheld-jsonl-"));
  baseDir = path.join(tmpDir, ".beheld");
  writer = new JsonlWriter(baseDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("JsonlWriter", () => {
  test("creates .beheld directory with 700 permissions", async () => {
    await writer.write(makeEvent("e1"));
    const stat = fs.statSync(baseDir);
    expect(stat.mode & 0o777).toBe(0o700);
  });

  test("creates sessions subdirectory", async () => {
    await writer.write(makeEvent("e1"));
    expect(fs.existsSync(path.join(baseDir, "sessions"))).toBe(true);
  });

  test("file is named YYYY-MM-DD_<session-id>.jsonl", async () => {
    const event = makeEvent("e1", "my-session-uuid");
    await writer.write(event);
    const today = new Date().toISOString().slice(0, 10);
    const sessionsDir = path.join(baseDir, "sessions");
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    expect(files.length).toBe(1);
    expect(files[0]).toStartWith(today);
    expect(files[0]).toContain("my-session-uuid");
  });

  test("multiple events with the same session_id go to the same file", async () => {
    await writer.write(makeEvent("e1", "sess-X"));
    await writer.write(makeEvent("e2", "sess-X"));
    await writer.write(makeEvent("e3", "sess-X"));

    const sessionsDir = path.join(baseDir, "sessions");
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    expect(files.length).toBe(1);

    const lines = fs.readFileSync(path.join(sessionsDir, files[0]), "utf8")
      .trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(3);
  });

  test("events with different session_ids go to different files", async () => {
    await writer.write(makeEvent("e1", "sess-A"));
    await writer.write(makeEvent("e2", "sess-B"));

    const sessionsDir = path.join(baseDir, "sessions");
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    expect(files.length).toBe(2);
  });

  test("file is append-only — never overwrites", async () => {
    await writer.write(makeEvent("e1", "sess-A"));
    // Re-create writer to simulate restart (no in-memory cache)
    const writer2 = new JsonlWriter(baseDir);
    await writer2.write(makeEvent("e2", "sess-A"));

    const sessionsDir = path.join(baseDir, "sessions");
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    const content = fs.readFileSync(path.join(sessionsDir, files[0]), "utf8");
    const ids = content.trim().split("\n").filter(Boolean)
      .map((l) => (JSON.parse(l) as BeheldEvent).event_id);
    expect(ids).toContain("e1");
    expect(ids).toContain("e2");
  });

  test("events on different days use different filenames", async () => {
    // Day 1 event
    const day1 = makeEvent("e1", "sess-A", "2026-05-09T10:00:00Z");
    await writer.write(day1);

    // Manually simulate the session file being from the previous day
    // by writing a day2 event with a fresh writer (no in-memory cache)
    const writer2 = new JsonlWriter(baseDir);
    const day2 = makeEvent("e2", "sess-A", "2026-05-10T10:00:00Z");
    await writer2.write(day2);

    const sessionsDir = path.join(baseDir, "sessions");
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    // Each event went to its own day-file
    const dates = files.map((f) => f.slice(0, 10));
    expect(dates).toContain("2026-05-09");
    expect(dates).toContain("2026-05-10");
  });

  test("creates index.json with correct entry", async () => {
    await writer.write(makeEvent("e1", "sess-A"));
    const idx = await writer.index();
    expect(idx.files).toHaveLength(1);
    expect(idx.files[0].session_id).toBe("sess-A");
    expect(idx.files[0].events).toBe(1);
  });

  test("index event_count increments per write", async () => {
    await writer.write(makeEvent("e1", "sess-A"));
    await writer.write(makeEvent("e2", "sess-A"));
    const idx = await writer.index();
    expect(idx.files[0].events).toBe(2);
  });

  test("index size_bytes reflects actual file size", async () => {
    await writer.write(makeEvent("e1", "sess-A"));
    const idx = await writer.index();
    const fp = idx.files[0].path;
    const actualSize = fs.statSync(fp).size;
    expect(idx.files[0].size_bytes).toBe(actualSize);
  });

  test("stored JSON line contains all event fields", async () => {
    const event: BeheldEvent = {
      event_id: "full-e",
      session_id: "sess-full",
      source: "claude-code",
      event_type: "pre_tool_use",
      timestamp: "2026-05-10T12:00:00Z",
      tool_name: "Bash",
      file_extension: "ts",
      command_sanitized: "npm test",
      has_test_context: true,
      cwd_hash: "abc12345",
      metadata: { extra: true },
    };
    await writer.write(event);
    const sessionsDir = path.join(baseDir, "sessions");
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    const parsed = JSON.parse(
      fs.readFileSync(path.join(sessionsDir, files[0]), "utf8").trim(),
    ) as BeheldEvent;
    expect(parsed.tool_name).toBe("Bash");
    expect(parsed.file_extension).toBe("ts");
    expect(parsed.has_test_context).toBe(true);
    expect(parsed.cwd_hash).toBe("abc12345");
  });
});

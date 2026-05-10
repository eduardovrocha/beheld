import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { writeEvent, getSessionsInfo } from "../src/writers/jsonl";
import type { DevProfileEvent } from "../src/types";

let tmpDir: string;

function makeEvent(id: string): DevProfileEvent {
  return {
    event_id: id,
    session_id: "s1",
    source: "claude-code",
    event_type: "pre_tool_use",
    timestamp: new Date().toISOString(),
    metadata: {},
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "devprofile-jsonl-test-"));
  process.env.DEVPROFILE_DATA_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.DEVPROFILE_DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("writeEvent", () => {
  test("creates .devprofile directory with 700 permissions", () => {
    writeEvent(makeEvent("e1"));
    const dir = path.join(tmpDir, ".devprofile");
    expect(fs.existsSync(dir)).toBe(true);
    const stat = fs.statSync(dir);
    expect(stat.mode & 0o777).toBe(0o700);
  });

  test("creates sessions subdirectory", () => {
    writeEvent(makeEvent("e1"));
    expect(fs.existsSync(path.join(tmpDir, ".devprofile", "sessions"))).toBe(true);
  });

  test("writes event as JSON line to JSONL file", () => {
    const event = makeEvent("event-abc");
    writeEvent(event);
    const sessionsDir = path.join(tmpDir, ".devprofile", "sessions");
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    expect(files.length).toBe(1);
    const content = fs.readFileSync(path.join(sessionsDir, files[0]), "utf8");
    const parsed = JSON.parse(content.trim()) as DevProfileEvent;
    expect(parsed.event_id).toBe("event-abc");
    expect(parsed.source).toBe("claude-code");
  });

  test("JSONL file name contains today's date", () => {
    writeEvent(makeEvent("e1"));
    const sessionsDir = path.join(tmpDir, ".devprofile", "sessions");
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    const today = new Date().toISOString().slice(0, 10);
    expect(files[0]).toStartWith(today);
  });

  test("multiple events append to the same file on the same day", () => {
    writeEvent(makeEvent("e1"));
    writeEvent(makeEvent("e2"));
    writeEvent(makeEvent("e3"));
    const sessionsDir = path.join(tmpDir, ".devprofile", "sessions");
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    expect(files.length).toBe(1);
    const content = fs.readFileSync(path.join(sessionsDir, files[0]), "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(3);
    const ids = lines.map((l) => (JSON.parse(l) as DevProfileEvent).event_id);
    expect(ids).toEqual(["e1", "e2", "e3"]);
  });

  test("creates index.json with file entry", () => {
    writeEvent(makeEvent("e1"));
    const indexPath = path.join(tmpDir, ".devprofile", "sessions", "index.json");
    expect(fs.existsSync(indexPath)).toBe(true);
    const index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as {
      files: Array<{ date: string; path: string; event_count: number }>;
    };
    expect(index.files).toHaveLength(1);
    expect(index.files[0].date).toBe(new Date().toISOString().slice(0, 10));
  });

  test("index.json event_count increments per write", () => {
    writeEvent(makeEvent("e1"));
    writeEvent(makeEvent("e2"));
    const indexPath = path.join(tmpDir, ".devprofile", "sessions", "index.json");
    const index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as {
      files: Array<{ event_count: number }>;
    };
    expect(index.files[0].event_count).toBe(2);
  });

  test("getSessionsInfo returns index data", () => {
    writeEvent(makeEvent("e1"));
    const info = getSessionsInfo();
    expect(info.files).toHaveLength(1);
    expect(info.files[0].event_count).toBe(1);
  });

  test("stores all event fields correctly", () => {
    const event: DevProfileEvent = {
      event_id: "full-event",
      session_id: "sess-xyz",
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
    writeEvent(event);
    const sessionsDir = path.join(tmpDir, ".devprofile", "sessions");
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    const parsed = JSON.parse(
      fs.readFileSync(path.join(sessionsDir, files[0]), "utf8").trim(),
    ) as DevProfileEvent;
    expect(parsed.tool_name).toBe("Bash");
    expect(parsed.file_extension).toBe("ts");
    expect(parsed.has_test_context).toBe(true);
    expect(parsed.cwd_hash).toBe("abc12345");
  });
});

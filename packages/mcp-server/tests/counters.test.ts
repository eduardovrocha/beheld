import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  Counters,
  rebuildCountersFromJsonl,
  localDateString,
  localDateOf,
} from "../src/counters";

let tmpDir: string;

function todayIso(hour = 12, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function yesterdayIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

function writeJsonl(file: string, events: object[]): void {
  fs.writeFileSync(file, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beheld-counters-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("localDateString", () => {
  test("returns YYYY-MM-DD format", () => {
    expect(localDateString(new Date(2026, 4, 15))).toBe("2026-05-15");
  });

  test("uses local timezone (not UTC)", () => {
    // 2026-05-15 23:30 local — UTC offset may push UTC to next day,
    // but local date must remain 2026-05-15
    const d = new Date(2026, 4, 15, 23, 30);
    expect(localDateString(d)).toBe("2026-05-15");
  });
});

describe("rebuildCountersFromJsonl", () => {
  test("returns zeros when sessions dir does not exist", () => {
    const result = rebuildCountersFromJsonl(path.join(tmpDir, "nope"));
    expect(result.events).toBe(0);
    expect(result.sessions.size).toBe(0);
  });

  test("returns zeros for empty sessions dir", () => {
    const result = rebuildCountersFromJsonl(tmpDir);
    expect(result.events).toBe(0);
    expect(result.sessions.size).toBe(0);
  });

  test("counts 30 events across 3 sessions for today", () => {
    const today = localDateString();
    writeJsonl(
      path.join(tmpDir, `${today}_session-a.jsonl`),
      Array.from({ length: 10 }, () => ({
        session_id: "session-a",
        timestamp: todayIso(),
      })),
    );
    writeJsonl(
      path.join(tmpDir, `${today}_session-b.jsonl`),
      Array.from({ length: 12 }, () => ({
        session_id: "session-b",
        timestamp: todayIso(),
      })),
    );
    writeJsonl(
      path.join(tmpDir, `${today}_session-c.jsonl`),
      Array.from({ length: 8 }, () => ({
        session_id: "session-c",
        timestamp: todayIso(),
      })),
    );

    const result = rebuildCountersFromJsonl(tmpDir);
    expect(result.events).toBe(30);
    expect(result.sessions.size).toBe(3);
  });

  test("excludes events from previous days", () => {
    const today = localDateString();
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = localDateString(yesterdayDate);

    writeJsonl(path.join(tmpDir, `${today}_today.jsonl`), [
      { session_id: "today-a", timestamp: todayIso() },
      { session_id: "today-a", timestamp: todayIso() },
    ]);
    writeJsonl(path.join(tmpDir, `${yesterdayStr}_yesterday.jsonl`), [
      { session_id: "yesterday-a", timestamp: yesterdayIso() },
      { session_id: "yesterday-b", timestamp: yesterdayIso() },
    ]);

    const result = rebuildCountersFromJsonl(tmpDir);
    expect(result.events).toBe(2);
    expect(result.sessions.has("today-a")).toBe(true);
    expect(result.sessions.has("yesterday-a")).toBe(false);
  });

  test("survives a corrupted line and counts the rest", () => {
    const today = localDateString();
    const fp = path.join(tmpDir, `${today}_mixed.jsonl`);
    fs.writeFileSync(
      fp,
      [
        JSON.stringify({ session_id: "s1", timestamp: todayIso() }),
        "{ this is not valid json",
        JSON.stringify({ session_id: "s1", timestamp: todayIso() }),
        "",
        JSON.stringify({ session_id: "s2", timestamp: todayIso() }),
      ].join("\n"),
    );

    const result = rebuildCountersFromJsonl(tmpDir);
    expect(result.events).toBe(3);
    expect(result.sessions.size).toBe(2);
  });

  test("ignores non-jsonl files in the directory", () => {
    const today = localDateString();
    fs.writeFileSync(path.join(tmpDir, "index.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "README.md"), "noise");
    writeJsonl(path.join(tmpDir, `${today}_real.jsonl`), [
      { session_id: "s1", timestamp: todayIso() },
    ]);

    const result = rebuildCountersFromJsonl(tmpDir);
    expect(result.events).toBe(1);
  });

  test("ignores events missing session_id or timestamp", () => {
    const today = localDateString();
    writeJsonl(path.join(tmpDir, `${today}_partial.jsonl`), [
      { session_id: "s1", timestamp: todayIso() },
      { session_id: "s2" }, // no timestamp
      { timestamp: todayIso() }, // no session_id
      { session_id: 42, timestamp: todayIso() }, // wrong type
    ]);

    const result = rebuildCountersFromJsonl(tmpDir);
    expect(result.events).toBe(1);
  });
});

describe("Counters", () => {
  test("eventsToday() returns 0 for empty dir", () => {
    const c = new Counters(tmpDir);
    expect(c.eventsToday()).toBe(0);
    expect(c.sessionsToday()).toBe(0);
  });

  test("track() increments today's events", () => {
    const c = new Counters(tmpDir);
    c.track({ session_id: "s1", timestamp: todayIso() });
    c.track({ session_id: "s1", timestamp: todayIso() });
    c.track({ session_id: "s2", timestamp: todayIso() });
    expect(c.eventsToday()).toBe(3);
    expect(c.sessionsToday()).toBe(2);
  });

  test("track() ignores events with yesterday's timestamp", () => {
    const c = new Counters(tmpDir);
    c.track({ session_id: "s1", timestamp: yesterdayIso() });
    expect(c.eventsToday()).toBe(0);
  });

  test("rebuild() picks up pre-existing JSONL events", () => {
    const today = localDateString();
    writeJsonl(path.join(tmpDir, `${today}_prewritten.jsonl`), [
      { session_id: "s1", timestamp: todayIso() },
      { session_id: "s1", timestamp: todayIso() },
      { session_id: "s2", timestamp: todayIso() },
    ]);

    const c = new Counters(tmpDir);
    c.rebuild();
    expect(c.eventsToday()).toBe(3);
    expect(c.sessionsToday()).toBe(2);
  });

  test("integration: 30 pre-existing events → eventsToday() === 30", () => {
    const today = localDateString();
    const events = Array.from({ length: 30 }, (_, i) => ({
      session_id: `s${i % 4}`, // 4 distinct sessions
      timestamp: todayIso(),
    }));
    writeJsonl(path.join(tmpDir, `${today}_load.jsonl`), events);

    const c = new Counters(tmpDir);
    c.rebuild();
    expect(c.eventsToday()).toBe(30);
    expect(c.sessionsToday()).toBe(4);
  });
});

describe("localDateOf", () => {
  test("extracts local date from ISO timestamp", () => {
    const ts = new Date(2026, 4, 15, 14, 30).toISOString();
    expect(localDateOf(ts)).toBe("2026-05-15");
  });
});

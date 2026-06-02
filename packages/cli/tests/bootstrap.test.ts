/**
 * R1.4 — `beheld bootstrap` orchestration tests.
 *
 * Focus is on the surface behavior the user actually relies on:
 *   - the bridge result is exposed verbatim in the structured return,
 *   - the canonical ~/.beheld dir is created when missing,
 *   - the default path prints next-step pointers without entering import,
 *   - the --import path does NOT auto-run when default invocation happens.
 *
 * We do NOT exercise --import end-to-end here: it delegates to runImport
 * which has its own (interactive) test suite. Hooking that path would
 * require fully mocking the engine client + readline — out of scope.
 */
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bootstrapCommand } from "../src/commands/bootstrap";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

let root: string;
let legacy: string;
let target: string;
let lines: string[];
const collect = (line: string) => lines.push(stripAnsi(line));

beforeEach(() => {
  root   = mkdtempSync(join(tmpdir(), "beheld-bootstrap-"));
  legacy = join(root, ".devprofile");
  target = join(root, ".beheld");
  lines  = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("bootstrapCommand — R1.4", () => {
  test("clean machine: creates ~/.beheld 0700, prints next-step pointers, returns bridge=no_legacy_dir", async () => {
    const r = await bootstrapCommand({ paths: { legacy, target }, logger: collect });

    expect(r.bridge.reason).toBe("no_legacy_dir");
    expect(r.beheldDir).toBe(target);
    expect(r.importInvited).toBe(false);

    expect(existsSync(target)).toBe(true);
    expect(statSync(target).mode & 0o777).toBe(0o700);

    const out = lines.join("\n");
    expect(out).toContain("beheld import");
    expect(out).toContain("beheld init");
    expect(out).toContain("beheld view");
  });

  test("legacy data present: migrates and announces moved count", async () => {
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "profile.db"), "sqlite-bytes");
    writeFileSync(join(legacy, "config.json"), "{}");

    const r = await bootstrapCommand({ paths: { legacy, target }, logger: collect });

    expect(r.bridge.reason).toBe("moved");
    expect(r.bridge.moved.length).toBe(2);
    expect(existsSync(join(target, "profile.db"))).toBe(true);
    expect(existsSync(join(target, "config.json"))).toBe(true);
    expect(existsSync(legacy)).toBe(false);

    expect(lines.some(l => l.includes("migrated 2 item(s)"))).toBe(true);
  });

  test("populated target with legacy still around: warns, leaves both intact", async () => {
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "profile.db"), "legacy");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "profile.db"), "current");

    const r = await bootstrapCommand({ paths: { legacy, target }, logger: collect });

    expect(r.bridge.reason).toBe("target_non_empty");
    expect(existsSync(join(legacy, "profile.db"))).toBe(true);
    expect(existsSync(join(target, "profile.db"))).toBe(true);

    expect(lines.some(l => l.includes("already populated"))).toBe(true);
    expect(lines.some(l => l.includes("Skipping migration"))).toBe(true);
  });

  test("empty legacy shell: silently cleans up, target prepared", async () => {
    mkdirSync(legacy, { recursive: true });
    const r = await bootstrapCommand({ paths: { legacy, target }, logger: collect });

    expect(r.bridge.reason).toBe("empty_legacy");
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(target)).toBe(true);
    expect(lines.some(l => l.includes("empty ~/.devprofile removed"))).toBe(true);
  });

  test("returns the bridge result verbatim — tests downstream wiring", async () => {
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "x"), "1");

    const r = await bootstrapCommand({ paths: { legacy, target }, logger: collect });
    expect(r.bridge.moved).toContain("x");
    expect(r.bridge.failed).toEqual([]);
  });
});

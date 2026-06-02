/**
 * R1.4 — legacy bridge tests (D-01 fix: non-destructive copy + marker).
 *
 * After the D-01 fix, the bridge:
 *   - COPIES (cpSync) instead of moving (renameSync),
 *   - NEVER deletes `~/.devprofile/`,
 *   - writes `~/.devprofile/MIGRATED_TO_BEHELD.md` as a permanent marker,
 *   - short-circuits subsequent runs that already migrated.
 *
 * Each test stands up an isolated tmp tree and asserts the structured
 * result + the observable filesystem state.
 */
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bridgeLegacyDevprofile, MIGRATED_MARKER } from "../src/lib/legacy-bridge";

let root: string;
let legacy: string;
let target: string;

beforeEach(() => {
  root   = mkdtempSync(join(tmpdir(), "beheld-bridge-"));
  legacy = join(root, ".devprofile");
  target = join(root, ".beheld");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("bridgeLegacyDevprofile — R1.4 (D-01 fix: non-destructive)", () => {
  test("no_legacy_dir: clean machine is a no-op", () => {
    const r = bridgeLegacyDevprofile({ legacy, target });
    expect(r.migrated).toBe(false);
    expect(r.reason).toBe("no_legacy_dir");
    expect(r.moved).toEqual([]);
    expect(r.failed).toEqual([]);
    expect(existsSync(target)).toBe(false);
  });

  test("empty_legacy: dir PRESERVED + marker written so re-runs short-circuit", () => {
    mkdirSync(legacy, { recursive: true });
    const r = bridgeLegacyDevprofile({ legacy, target });
    expect(r.migrated).toBe(false);
    expect(r.reason).toBe("empty_legacy");
    // D-01 fix — legacy dir is NEVER removed.
    expect(existsSync(legacy)).toBe(true);
    // Marker placed so the next bootstrap run reports `already_migrated`.
    expect(existsSync(join(legacy, MIGRATED_MARKER))).toBe(true);
    expect(existsSync(target)).toBe(false);
  });

  test("copied: same-filesystem copy of files + nested dirs, legacy preserved", () => {
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "profile.db"), "fake-sqlite");
    mkdirSync(join(legacy, "sessions"));
    writeFileSync(join(legacy, "sessions", "2026-06-01.jsonl"), "{}\n");

    const r = bridgeLegacyDevprofile({ legacy, target });
    expect(r.migrated).toBe(true);
    expect(r.reason).toBe("copied");
    expect(new Set(r.moved)).toEqual(new Set(["profile.db", "sessions"]));
    expect(r.failed).toEqual([]);

    // Target populated.
    expect(existsSync(join(target, "profile.db"))).toBe(true);
    expect(existsSync(join(target, "sessions", "2026-06-01.jsonl"))).toBe(true);

    // D-01 fix — legacy dir + original files PRESERVED verbatim.
    expect(existsSync(legacy)).toBe(true);
    expect(existsSync(join(legacy, "profile.db"))).toBe(true);
    expect(readFileSync(join(legacy, "profile.db"), "utf-8")).toBe("fake-sqlite");
    expect(existsSync(join(legacy, "sessions", "2026-06-01.jsonl"))).toBe(true);

    // Marker written inside the legacy dir.
    expect(existsSync(join(legacy, MIGRATED_MARKER))).toBe(true);
    const note = readFileSync(join(legacy, MIGRATED_MARKER), "utf-8");
    expect(note).toContain("Migrated to Beheld");
    expect(note).toContain(target);
    expect(note).toContain("non-destructive");
  });

  test("copied: when target pre-exists empty, files land inside it", () => {
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "profile.db"), "x");
    mkdirSync(target, { recursive: true }); // empty target — allowed.

    const r = bridgeLegacyDevprofile({ legacy, target });
    expect(r.reason).toBe("copied");
    expect(existsSync(join(target, "profile.db"))).toBe(true);
    // Legacy preserved.
    expect(existsSync(join(legacy, "profile.db"))).toBe(true);
  });

  test("target_non_empty (no marker): refuses to overwrite a populated ~/.beheld/", () => {
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "profile.db"), "legacy");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "profile.db"), "current"); // user has data already

    const r = bridgeLegacyDevprofile({ legacy, target });
    expect(r.migrated).toBe(false);
    expect(r.reason).toBe("target_non_empty");

    // Nothing was touched on either side.
    expect(readFileSync(join(legacy, "profile.db"), "utf-8")).toBe("legacy");
    expect(readFileSync(join(target, "profile.db"), "utf-8")).toBe("current");
    expect(existsSync(join(legacy, MIGRATED_MARKER))).toBe(false);
  });

  test("target gets mode 0700 after successful copy", () => {
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "config.json"), "{}");

    bridgeLegacyDevprofile({ legacy, target });

    const mode = statSync(target).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  test("idempotent — already_migrated: second run short-circuits cleanly", () => {
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "profile.db"), "x");

    const r1 = bridgeLegacyDevprofile({ legacy, target });
    expect(r1.reason).toBe("copied");
    expect(r1.migrated).toBe(true);

    // Second run: legacy + marker still there, target populated.
    const r2 = bridgeLegacyDevprofile({ legacy, target });
    expect(r2.reason).toBe("already_migrated");
    expect(r2.migrated).toBe(false);
    expect(r2.moved).toEqual([]);
    expect(r2.failed).toEqual([]);

    // Legacy contents preserved across both runs.
    expect(readFileSync(join(legacy, "profile.db"), "utf-8")).toBe("x");
  });

  test("re-run on partial machine (target empty, marker absent) re-copies", () => {
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "profile.db"), "x");
    bridgeLegacyDevprofile({ legacy, target });
    // Simulate a user wiping ~/.beheld manually but leaving legacy + marker.
    rmSync(target, { recursive: true });

    const r = bridgeLegacyDevprofile({ legacy, target });
    expect(r.reason).toBe("copied");
    expect(r.migrated).toBe(true);
    expect(existsSync(join(target, "profile.db"))).toBe(true);
  });

  test("preserves nested directory contents end-to-end", () => {
    mkdirSync(join(legacy, "bin"), { recursive: true });
    writeFileSync(join(legacy, "bin", "engine"), "binary-bytes");
    mkdirSync(join(legacy, "snapshots"));
    writeFileSync(join(legacy, "snapshots", "abc.dpbundle"), "{}");

    const r = bridgeLegacyDevprofile({ legacy, target });
    expect(r.reason).toBe("copied");
    expect(readdirSync(join(target, "bin"))).toEqual(["engine"]);
    expect(readdirSync(join(target, "snapshots"))).toEqual(["abc.dpbundle"]);
    // And originals still present.
    expect(readdirSync(join(legacy, "bin"))).toEqual(["engine"]);
    expect(readdirSync(join(legacy, "snapshots"))).toEqual(["abc.dpbundle"]);
  });

  test("marker is excluded from the `moved` list and not copied into target", () => {
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "profile.db"), "x");
    writeFileSync(join(legacy, MIGRATED_MARKER), "# pre-existing marker from a prior bootstrap");

    const r = bridgeLegacyDevprofile({ legacy, target });
    expect(r.moved).not.toContain(MIGRATED_MARKER);
    expect(existsSync(join(target, MIGRATED_MARKER))).toBe(false);
  });
});

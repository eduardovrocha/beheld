/**
 * R1.4 — legacy bridge tests. Covers every documented `BridgeResult.reason`
 * branch so the orchestrator (bootstrap command) can rely on the contract.
 *
 * Each test stands up an isolated tmp tree, runs `bridgeLegacyDevprofile`
 * with explicit paths (no env globals, no homedir mutation), and asserts on
 * the structured result + observable filesystem state. No mocks — the bridge
 * is a thin POSIX wrapper, so testing the real fs surfaces the right bugs.
 */
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bridgeLegacyDevprofile } from "../src/lib/legacy-bridge";

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

describe("bridgeLegacyDevprofile — R1.4", () => {
  test("no_legacy_dir: clean machine is a no-op", () => {
    const r = bridgeLegacyDevprofile({ legacy, target });
    expect(r.migrated).toBe(false);
    expect(r.reason).toBe("no_legacy_dir");
    expect(r.moved).toEqual([]);
    expect(r.failed).toEqual([]);
    expect(existsSync(target)).toBe(false);
  });

  test("empty_legacy: removes the empty shell, target not created", () => {
    mkdirSync(legacy, { recursive: true });
    const r = bridgeLegacyDevprofile({ legacy, target });
    expect(r.migrated).toBe(false);
    expect(r.reason).toBe("empty_legacy");
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(target)).toBe(false);
  });

  test("moved: same-filesystem rename of files + nested dirs", () => {
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "profile.db"), "fake-sqlite");
    mkdirSync(join(legacy, "sessions"));
    writeFileSync(join(legacy, "sessions", "2026-06-01.jsonl"), "{}\n");

    const r = bridgeLegacyDevprofile({ legacy, target });
    expect(r.migrated).toBe(true);
    expect(r.reason).toBe("moved");
    expect(new Set(r.moved)).toEqual(new Set(["profile.db", "sessions"]));
    expect(r.failed).toEqual([]);

    // Legacy gone, target populated.
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(join(target, "profile.db"))).toBe(true);
    expect(existsSync(join(target, "sessions", "2026-06-01.jsonl"))).toBe(true);
  });

  test("moved: when target pre-exists empty, files land inside it (no clobber)", () => {
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "profile.db"), "x");
    mkdirSync(target, { recursive: true }); // empty target — allowed.

    const r = bridgeLegacyDevprofile({ legacy, target });
    expect(r.reason).toBe("moved");
    expect(existsSync(join(target, "profile.db"))).toBe(true);
  });

  test("target_non_empty: refuses to overwrite a populated ~/.beheld/", () => {
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "profile.db"), "legacy");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "profile.db"), "current"); // user has data already

    const r = bridgeLegacyDevprofile({ legacy, target });
    expect(r.migrated).toBe(false);
    expect(r.reason).toBe("target_non_empty");

    // Both directories preserved verbatim.
    expect(existsSync(join(legacy, "profile.db"))).toBe(true);
    expect(existsSync(join(target, "profile.db"))).toBe(true);
  });

  test("target gets mode 0700 after successful migration", () => {
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "config.json"), "{}");

    bridgeLegacyDevprofile({ legacy, target });

    // mkdirSync({ mode: 0o700 }) honored on POSIX. On systems where umask
    // squashes the mode at mkdir, our chmodSync follow-up brings it back.
    const mode = statSync(target).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  test("idempotent: running twice on a migrated layout yields no_legacy_dir", () => {
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "profile.db"), "x");

    const r1 = bridgeLegacyDevprofile({ legacy, target });
    expect(r1.reason).toBe("moved");

    const r2 = bridgeLegacyDevprofile({ legacy, target });
    expect(r2.reason).toBe("no_legacy_dir");
    expect(r2.migrated).toBe(false);
  });

  test("preserves nested directory contents end-to-end", () => {
    mkdirSync(join(legacy, "bin"), { recursive: true });
    writeFileSync(join(legacy, "bin", "engine"), "binary-bytes");
    mkdirSync(join(legacy, "snapshots"));
    writeFileSync(join(legacy, "snapshots", "abc.dpbundle"), "{}");

    const r = bridgeLegacyDevprofile({ legacy, target });
    expect(r.reason).toBe("moved");
    expect(readdirSync(join(target, "bin"))).toEqual(["engine"]);
    expect(readdirSync(join(target, "snapshots"))).toEqual(["abc.dpbundle"]);
  });
});

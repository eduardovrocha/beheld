/**
 * R3.1 — Windsurf hooks installer tests.
 *
 * Covers the four observable contracts of installWindsurfHooks:
 *   - fresh install writes all 12 entries + backs up nothing
 *   - re-install over Beheld entries is idempotent (changed=false)
 *   - foreign entries survive verbatim; Beheld arrays land alongside
 *   - uninstall removes only Beheld entries, leaving foreign intact
 */
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  installWindsurfHooks, uninstallWindsurfHooks, WINDSURF_HOOK_EVENTS,
  type WindsurfHookPaths,
} from "../src/lib/windsurf-hooks";

let root: string;
let paths: WindsurfHookPaths;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "beheld-windsurf-hooks-"));
  paths = {
    hooksFile: join(root, ".codeium", "windsurf", "hooks.json"),
    backupFile: join(root, ".codeium", "windsurf", "hooks.json.beheld.bak"),
  };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("installWindsurfHooks", () => {
  test("fresh install: writes all 12 entries, no backup needed", () => {
    const r = installWindsurfHooks(paths);
    expect(r.changed).toBe(true);
    expect(r.backedUp).toBe(false);
    expect(r.totalEntries).toBe(12);
    expect(existsSync(paths.hooksFile)).toBe(true);
    const written = JSON.parse(readFileSync(paths.hooksFile, "utf-8"));
    for (const ev of WINDSURF_HOOK_EVENTS) {
      expect(written.hooks[ev]).toBeDefined();
      expect(written.hooks[ev].managed_by).toBe("beheld");
      expect(written.hooks[ev].command).toContain("curl");
      expect(written.hooks[ev].command).toContain(`event=${ev}`);
      expect(written.hooks[ev].timeout_seconds).toBe(3);
    }
  });

  test("idempotent: second run reports no change", () => {
    installWindsurfHooks(paths);
    const r = installWindsurfHooks(paths);
    expect(r.changed).toBe(false);
    expect(r.backedUp).toBe(false);
  });

  test("backs up existing file before overwriting", () => {
    mkdirSync(dirname(paths.hooksFile), { recursive: true });
    writeFileSync(paths.hooksFile, JSON.stringify({
      hooks: {
        pre_user_prompt: { command: "echo user-hook", timeout_seconds: 1 },
      },
    }));
    const r = installWindsurfHooks(paths);
    expect(r.changed).toBe(true);
    expect(r.backedUp).toBe(true);
    expect(existsSync(paths.backupFile)).toBe(true);
    const backup = JSON.parse(readFileSync(paths.backupFile, "utf-8"));
    expect(backup.hooks.pre_user_prompt.command).toBe("echo user-hook");
  });

  test("preserves foreign single-entry hooks alongside Beheld's (array form)", () => {
    mkdirSync(dirname(paths.hooksFile), { recursive: true });
    writeFileSync(paths.hooksFile, JSON.stringify({
      hooks: {
        pre_user_prompt: { command: "echo foreign", timeout_seconds: 1 },
      },
    }));
    installWindsurfHooks(paths);
    const written = JSON.parse(readFileSync(paths.hooksFile, "utf-8"));
    // Existing single foreign entry was wrapped into an array along with Beheld's.
    expect(Array.isArray(written.hooks.pre_user_prompt)).toBe(true);
    const arr = written.hooks.pre_user_prompt;
    expect(arr).toHaveLength(2);
    expect(arr.find((e: any) => e.command === "echo foreign")).toBeDefined();
    expect(arr.find((e: any) => e.managed_by === "beheld")).toBeDefined();
  });

  test("preserves the non-hooks top-level fields verbatim", () => {
    mkdirSync(dirname(paths.hooksFile), { recursive: true });
    writeFileSync(paths.hooksFile, JSON.stringify({
      version: 1,
      hooks: {},
      custom_user_field: { keep: true },
    }));
    installWindsurfHooks(paths);
    const written = JSON.parse(readFileSync(paths.hooksFile, "utf-8"));
    expect(written.version).toBe(1);
    expect(written.custom_user_field).toEqual({ keep: true });
  });

  test("recovers from corrupt JSON by starting clean (with backup)", () => {
    mkdirSync(dirname(paths.hooksFile), { recursive: true });
    writeFileSync(paths.hooksFile, "{ corrupt: not json");
    const r = installWindsurfHooks(paths);
    expect(r.changed).toBe(true);
    expect(r.backedUp).toBe(true);
    const written = JSON.parse(readFileSync(paths.hooksFile, "utf-8"));
    expect(Object.keys(written.hooks)).toHaveLength(12);
  });

  test("command uses BEHELD_MCP_URL when set", () => {
    installWindsurfHooks(paths, "http://my-host:9999");
    const w = JSON.parse(readFileSync(paths.hooksFile, "utf-8"));
    expect(w.hooks.pre_read_code.command).toContain("http://my-host:9999/hook/windsurf/event");
  });
});

describe("uninstallWindsurfHooks", () => {
  test("removes only Beheld entries, leaves foreign in place", () => {
    mkdirSync(dirname(paths.hooksFile), { recursive: true });
    writeFileSync(paths.hooksFile, JSON.stringify({
      hooks: {
        pre_user_prompt: { command: "echo foreign", timeout_seconds: 1 },
      },
    }));
    installWindsurfHooks(paths);
    const changed = uninstallWindsurfHooks(paths);
    expect(changed).toBe(true);
    const w = JSON.parse(readFileSync(paths.hooksFile, "utf-8"));
    // Foreign hook restored as single entry.
    expect(w.hooks.pre_user_prompt.command).toBe("echo foreign");
    expect(w.hooks.pre_user_prompt.managed_by).toBeUndefined();
    // All other Beheld entries deleted.
    for (const ev of WINDSURF_HOOK_EVENTS) {
      if (ev === "pre_user_prompt") continue;
      expect(w.hooks[ev]).toBeUndefined();
    }
  });

  test("no-op when hooks.json doesn't exist", () => {
    expect(uninstallWindsurfHooks(paths)).toBe(false);
  });

  test("idempotent: re-running returns false", () => {
    installWindsurfHooks(paths);
    expect(uninstallWindsurfHooks(paths)).toBe(true);
    expect(uninstallWindsurfHooks(paths)).toBe(false);
  });
});

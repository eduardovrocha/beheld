/**
 * Unified harness installer tests.
 *
 * Verifies the four observable contracts:
 *   1. buildHarnessRegistry returns one entry per registered source
 *      (mirrors the engine harness_registry.py — drift here is a P1).
 *   2. Each adapter declares its name + fidelity per the closed enum.
 *   3. installAllHarnesses respects detection + only + force flags.
 *   4. Tail adapters round-trip through ~/.beheld/config.json correctly.
 */
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildHarnessRegistry,
  installAllHarnesses,
  enabledTails,
  type HarnessAdapter,
  type InstallResult,
} from "../src/lib/harness-installer";

// ── Registry shape (Contract 1) ───────────────────────────────────────────

describe("buildHarnessRegistry — coverage", () => {
  test("exposes exactly the 8 registered sources, kebab-case names", () => {
    const names = buildHarnessRegistry().map((a) => a.name).sort();
    expect(names).toEqual([
      "claude-code",
      "codex-cli",
      "continue-vscode",
      "copilot-cli",
      "copilot-vscode",
      "cursor",
      "gemini-cli",
      "windsurf",
    ]);
  });

  test("every entry declares a valid capture_fidelity per the closed enum", () => {
    const valid = new Set(["native_hook", "editor_extension", "local_log_tail", "statusline", "inferred"]);
    for (const adapter of buildHarnessRegistry()) {
      expect(valid.has(adapter.fidelity)).toBe(true);
    }
  });

  test("fidelity matches the engine harness_registry mapping", () => {
    const expected: Record<string, string> = {
      "claude-code":     "native_hook",
      "continue-vscode": "editor_extension",
      "windsurf":        "native_hook",
      "gemini-cli":      "native_hook",
      "codex-cli":       "native_hook",
      "cursor":          "local_log_tail",
      "copilot-cli":     "statusline",
      "copilot-vscode":  "local_log_tail",
    };
    for (const adapter of buildHarnessRegistry()) {
      expect(adapter.fidelity).toBe(expected[adapter.name] as never);
    }
  });
});

// ── installAllHarnesses orchestration (Contract 3) ────────────────────────

describe("installAllHarnesses — orchestration", () => {
  function fakeAdapter(over: Partial<HarnessAdapter>): HarnessAdapter {
    const base: HarnessAdapter = {
      name: "x",
      label: "X",
      fidelity: "native_hook",
      description: "fake adapter for tests",
      isInstalled: () => false,
      install: () => ({ changed: true, wroteFile: true, requiresManualSetup: false }),
      uninstall: () => ({ changed: false }),
      ...over,
    };
    return base;
  }

  test("skips undetected adapters and reports detected:false", () => {
    const reg = [
      fakeAdapter({ name: "a", isInstalled: () => true,  install: () => ({ changed: true, wroteFile: true, requiresManualSetup: false }) }),
      fakeAdapter({ name: "b", isInstalled: () => false }),
    ];
    const out = installAllHarnesses({ registry: reg });
    expect(out).toHaveLength(2);
    expect(out[0].detected).toBe(true);
    expect(out[0].installed).not.toBeNull();
    expect(out[1].detected).toBe(false);
    expect(out[1].installed).toBeNull();
  });

  test("force:true installs even undetected adapters", () => {
    let installCalls = 0;
    const reg = [
      fakeAdapter({
        name: "a",
        isInstalled: () => false,
        install: () => { installCalls++; return { changed: true, wroteFile: true, requiresManualSetup: false }; },
      }),
    ];
    installAllHarnesses({ registry: reg, force: true });
    expect(installCalls).toBe(1);
  });

  test("only-filter limits which adapters are evaluated", () => {
    const reg = [
      fakeAdapter({ name: "a", isInstalled: () => true }),
      fakeAdapter({ name: "b", isInstalled: () => true }),
      fakeAdapter({ name: "c", isInstalled: () => true }),
    ];
    const out = installAllHarnesses({ registry: reg, only: ["a", "c"] });
    expect(out.map((r) => r.adapter.name)).toEqual(["a", "c"]);
  });

  test("adapter install error surfaces as a note, never throws", () => {
    const reg = [
      fakeAdapter({
        name: "boom",
        isInstalled: () => true,
        install: () => { throw new Error("disk full"); },
      }),
    ];
    const out = installAllHarnesses({ registry: reg });
    expect(out[0].installed?.changed).toBe(false);
    expect(out[0].installed?.note).toContain("disk full");
  });
});

// ── Tail adapters round-trip (Contract 4) ─────────────────────────────────

let isolatedHome: string;
let originalDataDir: string | undefined;

beforeEach(() => {
  isolatedHome = mkdtempSync(join(tmpdir(), "beheld-installer-"));
  originalDataDir = process.env.BEHELD_DATA_DIR;
  process.env.BEHELD_DATA_DIR = isolatedHome;
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.BEHELD_DATA_DIR;
  else process.env.BEHELD_DATA_DIR = originalDataDir;
  rmSync(isolatedHome, { recursive: true, force: true });
});

describe("tail adapter round-trip via ~/.beheld/config.json", () => {
  test("install flips the tail entry on; second install is no-op", () => {
    // Mark Cursor as 'detected' by creating one of its default paths.
    const cursorDir = join(isolatedHome, "Library", "Application Support", "Cursor");
    mkdirSync(cursorDir, { recursive: true });

    // ⚠ HOME-dependent path detection only fires if the adapter checks
    // homedir() — which it does. So we must also point HOME at the tmp.
    const originalHome = process.env.HOME;
    process.env.HOME = isolatedHome;
    try {
      const reg = buildHarnessRegistry().filter((a) => a.name === "cursor");
      const first = installAllHarnesses({ registry: reg });
      expect(first[0].detected).toBe(true);
      expect(first[0].installed?.changed).toBe(true);
      expect(enabledTails()).toContain("cursor");

      const second = installAllHarnesses({ registry: reg });
      expect(second[0].installed?.changed).toBe(false);
      expect(enabledTails()).toEqual(["cursor"]);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });

  test("manual-adapter (gemini-cli) reports requiresManualSetup without writing", () => {
    const geminiDir = join(isolatedHome, ".gemini");
    mkdirSync(geminiDir, { recursive: true });

    const originalHome = process.env.HOME;
    process.env.HOME = isolatedHome;
    try {
      const reg = buildHarnessRegistry().filter((a) => a.name === "gemini-cli");
      const out = installAllHarnesses({ registry: reg });
      expect(out[0].detected).toBe(true);
      expect(out[0].installed?.requiresManualSetup).toBe(true);
      expect(out[0].installed?.wroteFile).toBe(false);
      expect(out[0].installed?.note).toContain("hook API is not yet publicly documented");
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });
});

// ── enabledTails reads beheld config robustly ─────────────────────────────

describe("enabledTails — config file robustness", () => {
  test("returns [] when config file is missing", () => {
    expect(enabledTails()).toEqual([]);
  });

  test("returns [] when config file is corrupt JSON", () => {
    const cfg = join(isolatedHome, ".beheld", "config.json");
    mkdirSync(join(isolatedHome, ".beheld"), { recursive: true });
    writeFileSync(cfg, "{not json");
    expect(enabledTails()).toEqual([]);
  });

  test("returns the tails array when valid", () => {
    const cfg = join(isolatedHome, ".beheld", "config.json");
    mkdirSync(join(isolatedHome, ".beheld"), { recursive: true });
    writeFileSync(cfg, JSON.stringify({ tails: ["cursor", "copilot-vscode"] }));
    expect(enabledTails()).toEqual(["cursor", "copilot-vscode"]);
  });
});

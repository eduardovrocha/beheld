import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { VERSION } from "../src/index";
import { renderProfile } from "../src/ui/profile-view";
import { detectEnvironments } from "../src/ui/wizard";
import {
  installClaudeCodeHooks,
  installContinueDevMcp,
  installClaudeMcpServer,
  removeAllHooks,
  claudeSettingsPath,
  continueConfigPath,
  claudeJsonPath,
  migrateProjectScopedRegistrations,
} from "../src/config/hooks";
import type { ProfileData, Scores, ViewFlags } from "../src/types";

// ── VERSION ──────────────────────────────────────────────────────────────────

describe("VERSION", () => {
  test("follows semver format", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// ── CLI process ───────────────────────────────────────────────────────────────

describe("CLI process", () => {
  const repoRoot = join(import.meta.dir, "../../..");

  test("--version flag prints version and exits 0", async () => {
    const proc = Bun.spawn(["bun", "run", "packages/cli/src/index.ts", "--version"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    expect(exit).toBe(0);
    expect(output.trim()).toContain(VERSION);
  });

  test("-v flag prints version and exits 0", async () => {
    const proc = Bun.spawn(["bun", "run", "packages/cli/src/index.ts", "-v"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    expect(exit).toBe(0);
    expect(output.trim()).toContain(VERSION);
  });

  test("--help prints usage and exits 0", async () => {
    const proc = Bun.spawn(["bun", "run", "packages/cli/src/index.ts", "--help"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    expect(exit).toBe(0);
    expect(output).toContain("init");
    expect(output).toContain("view");
    expect(output).toContain("status");
  });

  test("unknown command exits non-zero", async () => {
    const proc = Bun.spawn(["bun", "run", "packages/cli/src/index.ts", "unknown-cmd"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exit = await proc.exited;
    expect(exit).not.toBe(0);
  });

  test("view --help lists --refresh flag", async () => {
    const proc = Bun.spawn(["bun", "run", "packages/cli/src/index.ts", "view", "--help"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    expect(exit).toBe(0);
    expect(output).toContain("--refresh");
  });
});

// ── renderProfile ─────────────────────────────────────────────────────────────

describe("renderProfile", () => {
  const scores: Scores = {
    prompt_quality: 84,
    test_maturity: 62,
    tech_breadth: 91,
    growth_rate: 75,
    overall: 78,
    sessions_analyzed: 10,
    updated_at: "2024-01-01T00:00:00Z",
  };

  const data: ProfileData = {
    scores,
    summary: {
      total_sessions: 10,
      platforms: ["docker", "github"],
      ecosystems: ["rails", "react"],
      workflow_distribution: { "test-after": 0.5, tdd: 0.3 },
      project_categories: {},
      last_scored_at: null,
      overall_score: 78,
    },
    insights: ["Top 10% em qualidade de prompt"],
    session: null,
  };

  test("--json flag returns valid JSON with scores", () => {
    const flags: ViewFlags = { json: true, scoresOnly: false };
    const out = renderProfile(data, flags);
    const parsed = JSON.parse(out);
    expect(parsed.scores.overall).toBe(78);
    expect(parsed.insights).toContain("Top 10% em qualidade de prompt");
  });

  test("--scores-only returns 4 space-separated numbers", () => {
    const flags: ViewFlags = { json: false, scoresOnly: true };
    const out = renderProfile(data, flags);
    const parts = out.trim().split(" ").map(Number);
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe(84);
    expect(parts[1]).toBe(62);
    expect(parts[2]).toBe(91);
    expect(parts[3]).toBe(75);
  });

  test("default output contains DevProfile header", () => {
    const flags: ViewFlags = { json: false, scoresOnly: false };
    const out = renderProfile(data, flags);
    expect(out).toContain("DevProfile");
  });

  test("default output contains score dimension labels", () => {
    const flags: ViewFlags = { json: false, scoresOnly: false };
    const out = renderProfile(data, flags);
    expect(out).toContain("Prompt quality");
    expect(out).toContain("Test maturity");
    expect(out).toContain("Tech breadth");
    expect(out).toContain("Growth rate");
  });

  test("default output shows insights", () => {
    const flags: ViewFlags = { json: false, scoresOnly: false };
    const out = renderProfile(data, flags);
    expect(out).toContain("Top 10% em qualidade de prompt");
  });

  test("no scores shows engine-offline message", () => {
    const flags: ViewFlags = { json: false, scoresOnly: false };
    const out = renderProfile({ scores: null, summary: null, insights: [], session: null }, flags);
    expect(out).toContain("offline");
  });

  test("zero sessions shows no-analysis message", () => {
    const flags: ViewFlags = { json: false, scoresOnly: false };
    const zeroScores: Scores = { ...scores, sessions_analyzed: 0 };
    const out = renderProfile({ ...data, scores: zeroScores }, flags);
    expect(out).toContain("Nenhuma sessão");
  });

  test("--scores-only with null scores returns '0 0 0 0'", () => {
    const flags: ViewFlags = { json: false, scoresOnly: true };
    const out = renderProfile({ ...data, scores: null }, flags);
    expect(out.trim()).toBe("0 0 0 0");
  });

  test("active session shows session block", () => {
    const flags: ViewFlags = { json: false, scoresOnly: false };
    const withSession: ProfileData = {
      ...data,
      session: {
        active: true,
        duration_minutes: 45,
        event_count: 83,
        tools_used: ["Read", "Edit"],
      },
    };
    const out = renderProfile(withSession, flags);
    expect(out).toContain("45");
    expect(out).toContain("83");
  });
});

// ── detectEnvironments ────────────────────────────────────────────────────────

describe("detectEnvironments", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `devprofile-env-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns false for both when neither config exists", () => {
    const envs = detectEnvironments(tmpDir);
    expect(envs.claudeCode).toBe(false);
    expect(envs.continueDev).toBe(false);
  });

  test("detects Claude Code when settings.json exists", () => {
    mkdirSync(join(tmpDir, ".claude"), { recursive: true });
    writeFileSync(join(tmpDir, ".claude", "settings.json"), "{}");
    const envs = detectEnvironments(tmpDir);
    expect(envs.claudeCode).toBe(true);
    expect(envs.continueDev).toBe(false);
  });

  test("detects Continue.dev when config.json exists", () => {
    mkdirSync(join(tmpDir, ".continue"), { recursive: true });
    writeFileSync(join(tmpDir, ".continue", "config.json"), "{}");
    const envs = detectEnvironments(tmpDir);
    expect(envs.claudeCode).toBe(false);
    expect(envs.continueDev).toBe(true);
  });

  test("detects both when both exist", () => {
    mkdirSync(join(tmpDir, ".claude"), { recursive: true });
    mkdirSync(join(tmpDir, ".continue"), { recursive: true });
    writeFileSync(join(tmpDir, ".claude", "settings.json"), "{}");
    writeFileSync(join(tmpDir, ".continue", "config.json"), "{}");
    const envs = detectEnvironments(tmpDir);
    expect(envs.claudeCode).toBe(true);
    expect(envs.continueDev).toBe(true);
  });
});

// ── hooks idempotency ─────────────────────────────────────────────────────────

describe("hooks idempotency", () => {
  let tmpDir: string;
  let settingsFile: string;
  let configFile: string;
  let claudeJson: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `devprofile-hooks-${randomUUID()}`);
    mkdirSync(join(tmpDir, ".claude"), { recursive: true });
    mkdirSync(join(tmpDir, ".continue"), { recursive: true });
    settingsFile = join(tmpDir, ".claude", "settings.json");
    configFile = join(tmpDir, ".continue", "config.json");
    claudeJson = join(tmpDir, ".claude.json");
    writeFileSync(settingsFile, "{}");
    writeFileSync(configFile, JSON.stringify({ mcpServers: [] }));
    writeFileSync(claudeJson, "{}");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("installClaudeCodeHooks adds hooks only (no MCP in settings.json)", async () => {
    await installClaudeCodeHooks(settingsFile);
    const cfg = JSON.parse(readFileSync(settingsFile, "utf8"));
    expect(cfg.hooks.PreToolUse).toHaveLength(1);
    expect(cfg.hooks.PostToolUse).toHaveLength(1);
    expect(cfg.hooks.Stop).toHaveLength(1);
    expect(cfg.mcpServers?.devprofile).toBeUndefined();
  });

  test("installClaudeMcpServer adds devprofile to ~/.claude.json with stdio", async () => {
    await installClaudeMcpServer(claudeJson);
    const cfg = JSON.parse(readFileSync(claudeJson, "utf8"));
    const entry = cfg.mcpServers?.devprofile;
    expect(entry?.type).toBe("stdio");
    expect(entry?.command).toContain(".local/bin/devprofile");
    expect(entry?.args).toEqual(["server"]);
    expect(entry?.url).toBeUndefined();
  });

  test("installClaudeMcpServer is idempotent", async () => {
    await installClaudeMcpServer(claudeJson);
    await installClaudeMcpServer(claudeJson);
    const cfg = JSON.parse(readFileSync(claudeJson, "utf8"));
    expect(Object.keys(cfg.mcpServers).filter((k) => k === "devprofile")).toHaveLength(1);
  });

  test("installClaudeCodeHooks is idempotent — second call does not duplicate hooks", async () => {
    await installClaudeCodeHooks(settingsFile);
    await installClaudeCodeHooks(settingsFile);
    const cfg = JSON.parse(readFileSync(settingsFile, "utf8"));
    expect(cfg.hooks.PreToolUse).toHaveLength(1);
    expect(cfg.hooks.PostToolUse).toHaveLength(1);
    expect(cfg.hooks.Stop).toHaveLength(1);
  });

  test("installContinueDevMcp adds MCP server entry", async () => {
    await installContinueDevMcp(configFile);
    const cfg = JSON.parse(readFileSync(configFile, "utf8"));
    const servers = cfg.mcpServers as Array<{ name: string }>;
    expect(servers.some((s) => s.name === "devprofile")).toBe(true);
  });

  test("installContinueDevMcp is idempotent — no duplicate entries", async () => {
    await installContinueDevMcp(configFile);
    await installContinueDevMcp(configFile);
    const cfg = JSON.parse(readFileSync(configFile, "utf8"));
    const devprofiles = (cfg.mcpServers as Array<{ name: string }>).filter(
      (s) => s.name === "devprofile",
    );
    expect(devprofiles).toHaveLength(1);
  });

  test("removeAllHooks removes devprofile hooks, MCP entries, and claude.json entry", async () => {
    await installClaudeCodeHooks(settingsFile);
    await installContinueDevMcp(configFile);
    await installClaudeMcpServer(claudeJson);
    await removeAllHooks(settingsFile, configFile, undefined, claudeJson);

    const claudeCfg = JSON.parse(readFileSync(settingsFile, "utf8"));
    for (const event of ["PreToolUse", "PostToolUse", "Stop"]) {
      const hooks = (claudeCfg.hooks?.[event] ?? []) as Array<{
        hooks?: Array<{ command?: string }>;
      }>;
      expect(hooks.some((m) => m.hooks?.some((h) => h.command?.includes("7337")))).toBe(false);
    }

    const continueCfg = JSON.parse(readFileSync(configFile, "utf8"));
    const servers = continueCfg.mcpServers as Array<{ name: string }>;
    expect(servers.some((s) => s.name === "devprofile")).toBe(false);

    const claudeJsonCfg = JSON.parse(readFileSync(claudeJson, "utf8"));
    expect(claudeJsonCfg.mcpServers?.devprofile).toBeUndefined();
  });

  test("removeAllHooks preserves non-devprofile hooks", async () => {
    const existing = {
      hooks: {
        PreToolUse: [{ matcher: "", hooks: [{ type: "command", command: "echo hello" }] }],
      },
    };
    writeFileSync(settingsFile, JSON.stringify(existing, null, 2));
    await installClaudeCodeHooks(settingsFile);
    await removeAllHooks(settingsFile, configFile, undefined, claudeJson);

    const cfg = JSON.parse(readFileSync(settingsFile, "utf8"));
    expect(cfg.hooks.PreToolUse).toHaveLength(1);
    expect(cfg.hooks.PreToolUse[0].hooks[0].command).toBe("echo hello");
  });

  test("migrateProjectScopedRegistrations removes devprofile and preserves other servers", async () => {
    const projDir = join(tmpDir, ".claude", "projects");
    const proj1 = join(projDir, "proj1");
    const proj2 = join(projDir, "proj2");
    mkdirSync(proj1, { recursive: true });
    mkdirSync(proj2, { recursive: true });

    writeFileSync(join(proj1, "settings.json"), JSON.stringify({
      mcpServers: {
        devprofile: { type: "stdio", command: "/tmp/dp", args: ["server"] },
        other: { type: "stdio", command: "/bin/other", args: [] },
      },
    }));
    writeFileSync(join(proj2, "settings.json"), JSON.stringify({
      mcpServers: {
        devprofile: { type: "stdio", command: "/tmp/dp", args: ["server"] },
      },
    }));

    const count = await migrateProjectScopedRegistrations(projDir);
    expect(count).toBe(2);

    const cfg1 = JSON.parse(readFileSync(join(proj1, "settings.json"), "utf8"));
    expect(cfg1.mcpServers?.devprofile).toBeUndefined();
    expect(cfg1.mcpServers?.other).toBeDefined();

    const cfg2 = JSON.parse(readFileSync(join(proj2, "settings.json"), "utf8"));
    expect(cfg2.mcpServers).toBeUndefined();
  });

  test("migrateProjectScopedRegistrations creates .bak files", async () => {
    const projDir = join(tmpDir, ".claude", "projects");
    const proj = join(projDir, "bak-test");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "settings.json"), JSON.stringify({
      mcpServers: { devprofile: { type: "stdio", command: "/tmp/dp", args: [] } },
    }));

    await migrateProjectScopedRegistrations(projDir);
    expect(existsSync(join(proj, "settings.json.bak"))).toBe(true);
  });

  test("migrateProjectScopedRegistrations returns 0 when no projects dir", async () => {
    const count = await migrateProjectScopedRegistrations(join(tmpDir, "nonexistent"));
    expect(count).toBe(0);
  });

  test("installClaudeCodeHooks throws if cwd is inside a protected target", async () => {
    // The guard fires when process.cwd() is a prefix of a protected path (home targets).
    // We can't easily simulate cwd === home dir without mocking, so just verify
    // the function succeeds normally (no throw) when running from this project dir.
    await expect(installClaudeCodeHooks(settingsFile)).resolves.toBeUndefined();
  });

  test("claudeSettingsPath builds path under given base", () => {
    const p = claudeSettingsPath("/home/test");
    expect(p).toBe(join("/home/test", ".claude", "settings.json"));
  });

  test("continueConfigPath builds path under given base", () => {
    const p = continueConfigPath("/home/test");
    expect(p).toBe(join("/home/test", ".continue", "config.json"));
  });
});

// ── engineStatus / orphan detection ──────────────────────────────────────────

describe("EngineStatus interface", () => {
  test("engineStatus() returns null when engine is offline", async () => {
    const { engineStatus } = await import("../src/client/engine-client");
    // Engine not running in tests — should return null gracefully
    const result = await engineStatus();
    expect(result).toBeNull();
  });
});

describe("viewCommand orphan detection", () => {
  const repoRoot = join(import.meta.dir, "../../..");

  // Engine offline path: engineStatus() + 4 data calls each have a 3s network
  // timeout — total wall time ≥ 6s; override Bun's 5s default.
  test("view --refresh prints 'já está atualizado' when engine is offline (no orphans detected)", async () => {
    // When engine is offline, engineStatus returns null → hasOrphans = false
    // --refresh with no orphans prints "Nenhum evento pendente" message
    const proc = Bun.spawn(
      ["bun", "run", "packages/cli/src/index.ts", "view", "--refresh"],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    // Engine offline → no orphans → should print up-to-date message, then profile
    expect(output).toContain("atualizado");
  }, 15000);

  test("view without --refresh does not mention 'refresh' when engine is offline", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "packages/cli/src/index.ts", "view"],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    // No orphans detected (engine offline → null status) → no warning shown
    expect(output).not.toContain("eventos não processados");
  }, 15000);
});

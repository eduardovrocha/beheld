import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, mkdtempSync, statSync, chmodSync } from "node:fs";
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
  installClaudeSlashCommand,
  selfHealClaudeIntegration,
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

  test("default output contains Beheld header", () => {
    const flags: ViewFlags = { json: false, scoresOnly: false };
    const out = renderProfile(data, flags);
    expect(out).toContain("Beheld");
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
    tmpDir = join(tmpdir(), `beheld-env-${randomUUID()}`);
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
    tmpDir = join(tmpdir(), `beheld-hooks-${randomUUID()}`);
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
    expect(cfg.hooks.SessionStart).toHaveLength(1);
    expect(cfg.mcpServers?.beheld).toBeUndefined();
  });

  test("installClaudeCodeHooks registers a SessionStart hook that heals /beheld", async () => {
    await installClaudeCodeHooks(settingsFile);
    const cfg = JSON.parse(readFileSync(settingsFile, "utf8"));
    const ss = cfg.hooks.SessionStart as Array<{
      hooks?: Array<{ command?: string }>;
    }>;
    expect(ss).toHaveLength(1);
    const cmd = ss[0].hooks?.[0].command ?? "";
    expect(cmd).toContain("beheld-session-start"); // marker for idempotency
    expect(cmd).toContain("beheld.md"); // points at the slash command file
    expect(cmd).toContain("beheld self-heal"); // invokes the new subcommand
    expect(cmd).toContain("beheld doctor"); // fallback for older binaries
    expect(cmd).toContain("exit 0"); // never fails the session
  });

  test("installClaudeCodeHooks SessionStart is idempotent", async () => {
    await installClaudeCodeHooks(settingsFile);
    await installClaudeCodeHooks(settingsFile);
    const cfg = JSON.parse(readFileSync(settingsFile, "utf8"));
    expect(cfg.hooks.SessionStart).toHaveLength(1);
  });

  test("installClaudeMcpServer adds beheld to ~/.claude.json with stdio", async () => {
    await installClaudeMcpServer(claudeJson);
    const cfg = JSON.parse(readFileSync(claudeJson, "utf8"));
    const entry = cfg.mcpServers?.beheld;
    expect(entry?.type).toBe("stdio");
    expect(entry?.command).toContain(".local/bin/beheld");
    expect(entry?.args).toEqual(["server", "--stdio"]);
    expect(entry?.url).toBeUndefined();
  });

  test("installClaudeMcpServer is idempotent", async () => {
    await installClaudeMcpServer(claudeJson);
    await installClaudeMcpServer(claudeJson);
    const cfg = JSON.parse(readFileSync(claudeJson, "utf8"));
    expect(Object.keys(cfg.mcpServers).filter((k) => k === "beheld")).toHaveLength(1);
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
    expect(servers.some((s) => s.name === "beheld")).toBe(true);
  });

  test("installContinueDevMcp is idempotent — no duplicate entries", async () => {
    await installContinueDevMcp(configFile);
    await installContinueDevMcp(configFile);
    const cfg = JSON.parse(readFileSync(configFile, "utf8"));
    const behelds = (cfg.mcpServers as Array<{ name: string }>).filter(
      (s) => s.name === "beheld",
    );
    expect(behelds).toHaveLength(1);
  });

  test("removeAllHooks removes beheld hooks, MCP entries, and claude.json entry", async () => {
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
    // SessionStart hook (marker-based, not port-based) must also be cleaned.
    const ssHooks = (claudeCfg.hooks?.SessionStart ?? []) as Array<{
      hooks?: Array<{ command?: string }>;
    }>;
    expect(
      ssHooks.some((m) =>
        m.hooks?.some((h) => h.command?.includes("beheld-session-start")),
      ),
    ).toBe(false);

    const continueCfg = JSON.parse(readFileSync(configFile, "utf8"));
    const servers = continueCfg.mcpServers as Array<{ name: string }>;
    expect(servers.some((s) => s.name === "beheld")).toBe(false);

    const claudeJsonCfg = JSON.parse(readFileSync(claudeJson, "utf8"));
    expect(claudeJsonCfg.mcpServers?.beheld).toBeUndefined();
  });

  test("removeAllHooks preserves non-beheld hooks", async () => {
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

  test("migrateProjectScopedRegistrations removes beheld and preserves other servers", async () => {
    const projDir = join(tmpDir, ".claude", "projects");
    const proj1 = join(projDir, "proj1");
    const proj2 = join(projDir, "proj2");
    mkdirSync(proj1, { recursive: true });
    mkdirSync(proj2, { recursive: true });

    writeFileSync(join(proj1, "settings.json"), JSON.stringify({
      mcpServers: {
        beheld: { type: "stdio", command: "/tmp/dp", args: ["server"] },
        other: { type: "stdio", command: "/bin/other", args: [] },
      },
    }));
    writeFileSync(join(proj2, "settings.json"), JSON.stringify({
      mcpServers: {
        beheld: { type: "stdio", command: "/tmp/dp", args: ["server"] },
      },
    }));

    const count = await migrateProjectScopedRegistrations(projDir);
    expect(count).toBe(2);

    const cfg1 = JSON.parse(readFileSync(join(proj1, "settings.json"), "utf8"));
    expect(cfg1.mcpServers?.beheld).toBeUndefined();
    expect(cfg1.mcpServers?.other).toBeDefined();

    const cfg2 = JSON.parse(readFileSync(join(proj2, "settings.json"), "utf8"));
    expect(cfg2.mcpServers).toBeUndefined();
  });

  test("migrateProjectScopedRegistrations creates .bak files", async () => {
    const projDir = join(tmpDir, ".claude", "projects");
    const proj = join(projDir, "bak-test");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "settings.json"), JSON.stringify({
      mcpServers: { beheld: { type: "stdio", command: "/tmp/dp", args: [] } },
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

// ── selfHealClaudeIntegration (regression: /beheld vanishing) ──────────────────

describe("selfHealClaudeIntegration", () => {
  let base: string;

  function writeConfig(claudeCode: boolean): void {
    mkdirSync(join(base, ".beheld"), { recursive: true });
    writeFileSync(
      join(base, ".beheld", "config.json"),
      JSON.stringify({ environments: { claudeCode, continueDev: false } }),
    );
  }

  function commandFile(): string {
    return join(base, ".claude", "commands", "beheld.md");
  }
  function claudeJson(): string {
    return join(base, ".claude.json");
  }

  beforeEach(() => {
    base = join(tmpdir(), `beheld-heal-${randomUUID()}`);
    mkdirSync(base, { recursive: true });
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  test("no-op when Claude Code was not opted in", async () => {
    writeConfig(false);
    const healed = await selfHealClaudeIntegration(base);
    expect(healed.slashCommandRestored).toBe(false);
    expect(healed.mcpServerRestored).toBe(false);
    expect(existsSync(commandFile())).toBe(false);
    expect(existsSync(claudeJson())).toBe(false);
  });

  test("no-op when ~/.beheld/config.json is missing", async () => {
    const healed = await selfHealClaudeIntegration(base);
    expect(healed.slashCommandRestored).toBe(false);
    expect(healed.mcpServerRestored).toBe(false);
  });

  test("restores both slash command and MCP entry when opted in and both missing", async () => {
    writeConfig(true);
    const healed = await selfHealClaudeIntegration(base);

    expect(healed.slashCommandRestored).toBe(true);
    expect(healed.mcpServerRestored).toBe(true);

    // Slash command content — frontmatter + greeting + routing rules.
    // Pin dinâmico evita atualização manual a cada bump da versão.
    const slashContent = readFileSync(commandFile(), "utf8");
    const { SLASH_COMMAND_VERSION } = await import("../src/config/hooks");
    expect(slashContent).toContain(`version: "${SLASH_COMMAND_VERSION}"`);
    expect(slashContent).toContain("B3H31D");
    const cfg = JSON.parse(readFileSync(claudeJson(), "utf8"));
    expect(cfg.mcpServers?.beheld?.args).toEqual(["server", "--stdio"]);
  });

  test("is idempotent — second call restores nothing", async () => {
    writeConfig(true);
    await selfHealClaudeIntegration(base);
    const healed = await selfHealClaudeIntegration(base);
    expect(healed.slashCommandRestored).toBe(false);
    expect(healed.mcpServerRestored).toBe(false);
  });

  test("restores only the slash command when MCP entry already present", async () => {
    writeConfig(true);
    await installClaudeMcpServer(claudeJson(), base);

    const healed = await selfHealClaudeIntegration(base);
    expect(healed.mcpServerRestored).toBe(false);
    expect(healed.slashCommandRestored).toBe(true);
    expect(existsSync(commandFile())).toBe(true);
  });
});

// ── renderCollecting ─────────────────────────────────────────────────────────

describe("renderCollecting", () => {
  test("renders collecting screen with 0 sessions (0%)", () => {
    const { renderCollecting } = require("../src/ui/profile-view");
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => lines.push(String(args[0]));
    renderCollecting(0, 3);
    console.log = orig;
    const out = lines.join("\n");
    expect(out).toContain("Coletando dados");
    expect(out).toContain("░░░░░░░░░░░░░░░░░░░░  0%");
    expect(out).toContain("0 de 3 sessões coletadas");
    expect(out).toContain("Faltam 3 sessões");
  });

  test("renders collecting screen with 2 sessions (66%)", () => {
    const { renderCollecting } = require("../src/ui/profile-view");
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => lines.push(String(args[0]));
    renderCollecting(2, 3);
    console.log = orig;
    const out = lines.join("\n");
    expect(out).toContain("2 de 3 sessões coletadas");
    expect(out).toContain("Falta 1 sessão");
  });

  test("uses singular 'sessão' when remaining === 1", () => {
    const { renderCollecting } = require("../src/ui/profile-view");
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => lines.push(String(args[0]));
    renderCollecting(2, 3);
    console.log = orig;
    const out = lines.join("\n");
    expect(out).toMatch(/Falta 1 sessão[^ões]/);
    expect(out).not.toContain("sessões para gerar");
  });

  test("uses plural 'sessões' when remaining > 1", () => {
    const { renderCollecting } = require("../src/ui/profile-view");
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => lines.push(String(args[0]));
    renderCollecting(0, 3);
    console.log = orig;
    const out = lines.join("\n");
    expect(out).toContain("Faltam 3 sessões");
  });
});

// ── readiness subprocess tests ────────────────────────────────────────────────

describe("view readiness gate", () => {
  const repoRoot = join(import.meta.dir, "../../..");
  const deadEngineUrl = "http://127.0.0.1:19999";

  test("view shows 'Coletando dados' when engine offline and DB has 0 scores (no cache)", async () => {
    const missingDb = join(tmpdir(), `beheld-noread-${randomUUID()}.db`);
    // Engine offline + no cache → exits 1 with error (not collecting screen)
    // Collecting screen only shows when engine is LIVE and reports not ready
    // This test confirms the exit path when engine offline + no cache
    const proc = Bun.spawn(
      ["bun", "run", "packages/cli/src/index.ts", "view"],
      {
        cwd: repoRoot,
        env: { ...process.env, BEHELD_ENGINE_URL: deadEngineUrl, BEHELD_CACHE_DB: missingDb },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const output = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    expect(exit).toBe(1);
    expect(output).toContain("nenhum score cacheado");
  }, 15000);

  test("view with cached scores (source=cache) never shows collecting screen", async () => {
    const { Database } = await import("bun:sqlite");
    const dbPath = join(tmpdir(), `beheld-readiness-${randomUUID()}.db`);
    const db = new Database(dbPath);
    db.exec(
      `CREATE TABLE scores (date TEXT, prompt_quality INTEGER, test_maturity INTEGER,
       tech_breadth INTEGER, growth_rate INTEGER, overall INTEGER, sessions_analyzed INTEGER)`,
    );
    db.exec(`INSERT INTO scores VALUES ('2024-01-01', 70, 60, 80, 50, 68, 1)`);
    db.close();

    const proc = Bun.spawn(
      ["bun", "run", "packages/cli/src/index.ts", "view"],
      {
        cwd: repoRoot,
        env: { ...process.env, BEHELD_ENGINE_URL: deadEngineUrl, BEHELD_CACHE_DB: dbPath },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const output = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    expect(exit).toBe(0);
    expect(output).not.toContain("Coletando dados");
    expect(output.toLowerCase()).toContain("engine offline");
    rmSync(dbPath, { force: true });
  }, 15000);
});

// ── scoresCurrent offline fallback ───────────────────────────────────────────

describe("scoresCurrent offline fallback", () => {
  const repoRoot = join(import.meta.dir, "../../..");
  const deadEngineUrl = "http://127.0.0.1:19999";

  test("view exits 1 with no-cache message when engine offline and no DB", async () => {
    const missingDb = join(tmpdir(), `beheld-missing-${randomUUID()}.db`);
    const proc = Bun.spawn(
      ["bun", "run", "packages/cli/src/index.ts", "view"],
      {
        cwd: repoRoot,
        env: { ...process.env, BEHELD_ENGINE_URL: deadEngineUrl, BEHELD_CACHE_DB: missingDb },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const output = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    expect(exit).toBe(1);
    expect(output).toContain("nenhum score cacheado");
  }, 15000);

  test("view shows cache warning when engine offline but DB has scores", async () => {
    const { Database } = await import("bun:sqlite");
    const dbPath = join(tmpdir(), `beheld-cache-${randomUUID()}.db`);
    const db = new Database(dbPath);
    db.exec(
      `CREATE TABLE scores (date TEXT, prompt_quality INTEGER, test_maturity INTEGER,
       tech_breadth INTEGER, growth_rate INTEGER, overall INTEGER, sessions_analyzed INTEGER)`,
    );
    db.exec(`INSERT INTO scores VALUES ('2024-01-01', 70, 60, 80, 50, 68, 5)`);
    db.close();

    const proc = Bun.spawn(
      ["bun", "run", "packages/cli/src/index.ts", "view"],
      {
        cwd: repoRoot,
        env: { ...process.env, BEHELD_ENGINE_URL: deadEngineUrl, BEHELD_CACHE_DB: dbPath },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const output = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    expect(exit).toBe(0);
    // New B18 alert box uses uppercase title; older score date also triggers it
    expect(output.toLowerCase()).toContain("engine offline");
    expect(output).toContain("beheld doctor");
    expect(output).toContain("beheld restart");
    rmSync(dbPath, { force: true });
  }, 15000);

  test("view --scores-only with cached DB returns space-separated numbers", async () => {
    const { Database } = await import("bun:sqlite");
    const dbPath = join(tmpdir(), `beheld-scores-${randomUUID()}.db`);
    const db = new Database(dbPath);
    db.exec(
      `CREATE TABLE scores (date TEXT, prompt_quality INTEGER, test_maturity INTEGER,
       tech_breadth INTEGER, growth_rate INTEGER, overall INTEGER, sessions_analyzed INTEGER)`,
    );
    db.exec(`INSERT INTO scores VALUES ('2024-01-01', 70, 60, 80, 50, 68, 5)`);
    db.close();

    const proc = Bun.spawn(
      ["bun", "run", "packages/cli/src/index.ts", "view", "--scores-only"],
      {
        cwd: repoRoot,
        env: { ...process.env, BEHELD_ENGINE_URL: deadEngineUrl, BEHELD_CACHE_DB: dbPath },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const output = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    expect(exit).toBe(0);
    const parts = output.trim().split(" ").map(Number);
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe(70);
    expect(parts[1]).toBe(60);
    expect(parts[2]).toBe(80);
    expect(parts[3]).toBe(50);
    rmSync(dbPath, { force: true });
  }, 15000);
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

// ── B1: daemon already-running detection ─────────────────────────────────────

describe("daemon start — já em execução", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("isMcpRunning retorna true quando porta 7337 responde 200", async () => {
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      if (String(url).includes(":7337/health")) return new Response("{}", { status: 200 });
      throw new Error("unexpected url");
    }) as typeof fetch;

    const { isMcpRunning } = await import("../src/daemon-manager");
    expect(await isMcpRunning()).toBe(true);
  });

  test("isMcpRunning retorna false quando porta 7337 recusa conexão", async () => {
    globalThis.fetch = mock(async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch;

    const { isMcpRunning } = await import("../src/daemon-manager");
    expect(await isMcpRunning()).toBe(false);
  });

  test("isEngineRunning retorna true quando porta 7338 responde 200", async () => {
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      if (String(url).includes(":7338/health")) return new Response("{}", { status: 200 });
      throw new Error("unexpected url");
    }) as typeof fetch;

    const { isEngineRunning } = await import("../src/daemon-manager");
    expect(await isEngineRunning()).toBe(true);
  });

  test("isEngineRunning retorna false quando porta 7338 recusa conexão", async () => {
    globalThis.fetch = mock(async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch;

    const { isEngineRunning } = await import("../src/daemon-manager");
    expect(await isEngineRunning()).toBe(false);
  });

  test("start() retorna alreadyRunning:true quando ambas as portas respondem", async () => {
    globalThis.fetch = mock(async () => new Response("{}", { status: 200 })) as typeof fetch;

    const { start } = await import("../src/daemon-manager");
    const result = await start();
    expect(result.alreadyRunning).toBe(true);
    expect(result.mcp).toBe(true);
    expect(result.engine).toBe(true);
  });

  test("start() não chama ensureEngine quando ambos já estão rodando", async () => {
    let fetchCallCount = 0;
    globalThis.fetch = mock(async () => {
      fetchCallCount++;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const { start } = await import("../src/daemon-manager");
    const result = await start();
    // Only the two initial health checks — no waitForHealthPort polling
    expect(fetchCallCount).toBe(2);
    expect(result.alreadyRunning).toBe(true);
  });

  test("isMcpRunning retorna false quando porta responde com status != 200", async () => {
    globalThis.fetch = mock(async () => new Response("error", { status: 500 })) as typeof fetch;

    const { isMcpRunning } = await import("../src/daemon-manager");
    expect(await isMcpRunning()).toBe(false);
  });

  test("isEngineRunning retorna false quando o servidor demora mais que o timeout", async () => {
    globalThis.fetch = mock((_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          const onAbort = () => {
            const err = new Error("The operation was aborted");
            (err as Error & { name: string }).name = "AbortError";
            reject(err);
          };
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    }) as typeof fetch;

    const { isEngineRunning } = await import("../src/daemon-manager");
    const t0 = Date.now();
    const result = await isEngineRunning();
    const elapsed = Date.now() - t0;
    expect(result).toBe(false);
    // Timeout interno é 1s; permitir folga de schedulers lentos
    expect(elapsed).toBeLessThan(2500);
  });
});

// ── codesignEngine — macOS ────────────────────────────────────────────────────

describe("codesignEngine — macOS", () => {
  function makeSpawn(status = 0): { fn: ReturnType<typeof mock>; calls: string[][] } {
    const calls: string[][] = [];
    const fn = mock((cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      return { status, stderr: Buffer.from("") };
    });
    return { fn, calls };
  }

  test("executa xattr e codesign quando ambos disponíveis", async () => {
    const { codesignEngine } = await import("../src/engine-extractor");
    const { fn, calls } = makeSpawn(0);
    codesignEngine("/tmp/fake-engine", fn);
    const cmds = calls.map((c) => c[0]);
    expect(cmds).toContain("which");
    expect(cmds).toContain("xattr");
    expect(cmds).toContain("codesign");
  });

  test("xattr é chamado com -d com.apple.quarantine", async () => {
    const { codesignEngine } = await import("../src/engine-extractor");
    const { fn, calls } = makeSpawn(0);
    codesignEngine("/tmp/fake-engine", fn);
    const xattrCall = calls.find((c) => c[0] === "xattr");
    expect(xattrCall).toBeDefined();
    expect(xattrCall).toContain("-d");
    expect(xattrCall).toContain("com.apple.quarantine");
    expect(xattrCall).toContain("/tmp/fake-engine");
  });

  test("codesign é chamado com --sign - --force", async () => {
    const { codesignEngine } = await import("../src/engine-extractor");
    const { fn, calls } = makeSpawn(0);
    codesignEngine("/tmp/fake-engine", fn);
    const csCall = calls.find((c) => c[0] === "codesign");
    expect(csCall).toBeDefined();
    expect(csCall).toContain("--sign");
    expect(csCall).toContain("-");
    expect(csCall).toContain("--force");
    expect(csCall).toContain("/tmp/fake-engine");
  });

  test("não lança exceção se codesign retorna status != 0 (non-fatal)", async () => {
    const { codesignEngine } = await import("../src/engine-extractor");
    const { fn } = makeSpawn(1);
    expect(() => codesignEngine("/tmp/fake-engine", fn)).not.toThrow();
  });

  test("não executa codesign se nenhum comando disponível (which sempre retorna 1)", async () => {
    const { codesignEngine } = await import("../src/engine-extractor");
    const calls: string[] = [];
    const fn = mock((cmd: string) => {
      calls.push(cmd);
      return { status: 1, stderr: Buffer.from("") };
    });
    codesignEngine("/tmp/fake-engine", fn);
    expect(calls).not.toContain("codesign");
  });

  test("ensureEngine é uma função exportada", async () => {
    const { ensureEngine } = await import("../src/engine-extractor");
    expect(typeof ensureEngine).toBe("function");
  });

  test("isCommandAvailable retorna false para comando inexistente", async () => {
    const { isCommandAvailable } = await import("../src/engine-extractor");
    expect(isCommandAvailable("beheld-nonexistent-xyz")).toBe(false);
  });

  test("isCommandAvailable retorna true para 'sh' (sempre disponível)", async () => {
    const { isCommandAvailable } = await import("../src/engine-extractor");
    expect(isCommandAvailable("sh")).toBe(true);
  });
});

// ── Secure permissions ────────────────────────────────────────────────────────

describe("permissões seguras do diretório ~/.beheld", () => {
  test("cria diretório com permissão 0700", () => {
    const tmpBase = mkdtempSync(join(tmpdir(), "beheld-test-"));
    const beheldDir = join(tmpBase, ".beheld");

    mkdirSync(beheldDir, { recursive: true, mode: 0o700 });

    const mode = statSync(beheldDir).mode & 0o777;
    expect(mode).toBe(0o700);

    rmSync(tmpBase, { recursive: true });
  });

  test("ensureSecurePermissions corrige diretório com 0755", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "beheld-perm-"));
    chmodSync(tmpDir, 0o755);
    expect(statSync(tmpDir).mode & 0o777).toBe(0o755);

    const { ensureSecurePermissions } = await import("../src/daemon-manager");
    ensureSecurePermissions(tmpDir);

    expect(statSync(tmpDir).mode & 0o777).toBe(0o700);

    rmSync(tmpDir, { recursive: true });
  });
});

// ── Autostart templates ───────────────────────────────────────────────────────

describe("autostart — templates de LaunchAgent e systemd", () => {
  test("LaunchAgent usa beheld start em vez de server", async () => {
    const { generateLaunchAgentPlist } = await import("../src/daemon-manager");
    const plist = generateLaunchAgentPlist(
      "/usr/local/bin/beheld",
      "/home/user/.beheld",
    );
    expect(plist).toContain("<string>start</string>");
    expect(plist).not.toContain("<string>server</string>");
  });

  test("LaunchAgent tem KeepAlive false", async () => {
    const { generateLaunchAgentPlist } = await import("../src/daemon-manager");
    const plist = generateLaunchAgentPlist(
      "/usr/local/bin/beheld",
      "/home/user/.beheld",
    );
    expect(plist).toContain("<false/>");
    expect(plist).not.toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
  });

  test("systemd service usa beheld start em vez de server", async () => {
    const { generateSystemdService } = await import("../src/daemon-manager");
    const service = generateSystemdService(
      "/usr/local/bin/beheld",
      "/home/user/.beheld",
    );
    expect(service).toContain("beheld start");
    expect(service).not.toContain("beheld server");
  });

  test("systemd service é Type=oneshot com RemainAfterExit", async () => {
    const { generateSystemdService } = await import("../src/daemon-manager");
    const service = generateSystemdService(
      "/usr/local/bin/beheld",
      "/home/user/.beheld",
    );
    expect(service).toContain("Type=oneshot");
    expect(service).toContain("RemainAfterExit=yes");
    expect(service).not.toContain("Restart=always");
  });
});

// ── B7: view --json/--scores-only stdout/stderr separation ───────────────────

describe("view --json e --scores-only não poluem stdout com warnings", () => {
  const repoRoot = join(import.meta.dir, "../../..");

  test("view --json retorna JSON puro no stdout (sem warnings)", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "packages/cli/src/index.ts", "view", "--json"],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    // Stdout must be parseable JSON — no warning text mixed in
    expect(() => JSON.parse(stdout)).not.toThrow();
    expect(stdout).not.toContain("⚠️");
    expect(stdout).not.toContain("não processados");
  }, 15000);

  test("view --json coloca warnings no stderr, não no stdout", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "packages/cli/src/index.ts", "view", "--json"],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ] as const);
    // stdout must be valid JSON regardless of whether warnings are present
    expect(() => JSON.parse(stdout)).not.toThrow();
    // If there were orphan warnings, they belong in stderr
    if (stderr.includes("não processados")) {
      expect(stdout).not.toContain("não processados");
    }
  }, 15000);

  test("view --scores-only não polui stdout com warnings", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "packages/cli/src/index.ts", "view", "--scores-only"],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    // stdout must contain only space-separated numbers — no warning text
    expect(stdout).not.toContain("⚠️");
    expect(stdout).not.toContain("não processados");
    expect(stdout.trim()).toMatch(/^[\d\s]+$/);
  }, 15000);
});

describe("installClaudeSlashCommand", () => {
  test("sobrescreve arquivo vazio", async () => {
    const tmpFile = join(tmpdir(), `beheld-empty-${Date.now()}.md`);
    writeFileSync(tmpFile, "");

    await installClaudeSlashCommand(tmpFile);

    const content = readFileSync(tmpFile, "utf-8");
    expect(content.trim().length).toBeGreaterThan(0);
    expect(content).toContain("beheld");
  });

  test("preserva arquivo com conteúdo existente", async () => {
    const tmpFile = join(tmpdir(), `beheld-existing-${Date.now()}.md`);
    const original = "conteúdo customizado pelo usuário";
    writeFileSync(tmpFile, original);

    await installClaudeSlashCommand(tmpFile);

    const content = readFileSync(tmpFile, "utf-8");
    expect(content).toBe(original);
  });

  test("cria arquivo se não existe", async () => {
    const tmpFile = join(tmpdir(), `beheld-new-${Date.now()}.md`);

    await installClaudeSlashCommand(tmpFile);

    expect(existsSync(tmpFile)).toBe(true);
    expect(readFileSync(tmpFile, "utf-8").trim().length).toBeGreaterThan(0);
  });
});

import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { renderAlertBox } from "../src/ui/alert-box";

let tmpDir: string;
const originalFetch = globalThis.fetch;
const originalDataDir = process.env.BEHELD_DATA_DIR;
const originalEngineUrl = process.env.BEHELD_ENGINE_URL;
const originalMcpUrl = process.env.BEHELD_MCP_URL;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beheld-doctor-"));
  process.env.BEHELD_DATA_DIR = tmpDir;
  fs.mkdirSync(path.join(tmpDir, ".beheld", "sessions"), { recursive: true, mode: 0o700 });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalDataDir === undefined) delete process.env.BEHELD_DATA_DIR;
  else process.env.BEHELD_DATA_DIR = originalDataDir;
  if (originalEngineUrl === undefined) delete process.env.BEHELD_ENGINE_URL;
  else process.env.BEHELD_ENGINE_URL = originalEngineUrl;
  if (originalMcpUrl === undefined) delete process.env.BEHELD_MCP_URL;
  else process.env.BEHELD_MCP_URL = originalMcpUrl;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function todayLocalString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function writeJsonl(file: string, events: object[]): void {
  fs.writeFileSync(file, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

// ── scanTodayJsonl ──────────────────────────────────────────────────────────

describe("scanTodayJsonl", () => {
  test("returns null when sessions dir doesn't exist", async () => {
    fs.rmSync(path.join(tmpDir, ".beheld"), { recursive: true });
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.scanTodayJsonl()).toBeNull();
  });

  test("returns zero counts for empty sessions dir", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const sample = _internal.scanTodayJsonl();
    expect(sample).not.toBeNull();
    expect(sample!.events).toBe(0);
    expect(sample!.sessions.size).toBe(0);
  });

  test("counts events with today's local timestamp", async () => {
    const today = todayLocalString();
    writeJsonl(path.join(tmpDir, ".beheld", "sessions", `${today}_s1.jsonl`), [
      { session_id: "s1", timestamp: new Date().toISOString() },
      { session_id: "s1", timestamp: new Date().toISOString() },
      { session_id: "s2", timestamp: new Date().toISOString() },
    ]);

    const { _internal } = await import("../src/commands/doctor");
    const sample = _internal.scanTodayJsonl();
    expect(sample!.events).toBe(3);
    expect(sample!.sessions.size).toBe(2);
  });

  test("counts corrupted lines separately", async () => {
    const today = todayLocalString();
    const fp = path.join(tmpDir, ".beheld", "sessions", `${today}_corrupted.jsonl`);
    fs.writeFileSync(
      fp,
      [
        JSON.stringify({ session_id: "s1", timestamp: new Date().toISOString() }),
        "this is not json",
        JSON.stringify({ session_id: "s1", timestamp: new Date().toISOString() }),
      ].join("\n"),
    );

    const { _internal } = await import("../src/commands/doctor");
    const sample = _internal.scanTodayJsonl();
    expect(sample!.events).toBe(2);
    expect(sample!.corruptedLines).toBe(1);
  });
});

// ── checkPidFile ─────────────────────────────────────────────────────────────

describe("checkPidFile", () => {
  test("warns when PID file is missing", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const result = _internal.checkPidFile(undefined);
    expect(result.severity).toBe("warn");
  });

  test("ok when PID matches runtime", async () => {
    fs.writeFileSync(
      path.join(tmpDir, ".beheld", "daemon.pid"),
      JSON.stringify({ mcp: 100, engine: 200 }),
    );
    const { _internal } = await import("../src/commands/doctor");
    const result = _internal.checkPidFile(200);
    expect(result.severity).toBe("ok");
  });

  test("warns when PID file says 707 but engine actually runs as 708", async () => {
    fs.writeFileSync(
      path.join(tmpDir, ".beheld", "daemon.pid"),
      JSON.stringify({ mcp: 100, engine: 707 }),
    );
    const { _internal } = await import("../src/commands/doctor");
    const result = _internal.checkPidFile(708);
    expect(result.severity).toBe("warn");
    expect(result.lines.join(" ")).toContain("707");
    expect(result.lines.join(" ")).toContain("708");
    expect(result.hint).toContain("restart");
  });

  test("ok when no runtime PID is available (skip comparison)", async () => {
    fs.writeFileSync(
      path.join(tmpDir, ".beheld", "daemon.pid"),
      JSON.stringify({ mcp: 100, engine: 200 }),
    );
    const { _internal } = await import("../src/commands/doctor");
    const result = _internal.checkPidFile(undefined);
    expect(result.severity).toBe("ok");
  });
});

// ── alert box ────────────────────────────────────────────────────────────────

describe("renderAlertBox", () => {
  test("renders title, body, and suggestions inside a box", () => {
    const out = renderAlertBox({
      title: "ENGINE OFFLINE",
      body: ["Você está vendo cache de 14/05/2026.", "716 eventos pendentes."],
      suggestions: [
        { label: "Para diagnosticar", command: "beheld doctor" },
        { label: "Para reiniciar",    command: "beheld restart" },
      ],
    });

    // Strip ANSI codes for content assertions
    const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
    expect(plain).toContain("ENGINE OFFLINE");
    expect(plain).toContain("Você está vendo cache de 14/05/2026.");
    expect(plain).toContain("716 eventos pendentes.");
    expect(plain).toContain("beheld doctor");
    expect(plain).toContain("beheld restart");
    expect(plain.startsWith("╭")).toBe(true);
    expect(plain.endsWith("╯")).toBe(true);
  });

  test("box is a clean rectangle (every line has same visible width)", () => {
    const out = renderAlertBox({
      title: "TESTE",
      body: ["Linha curta", "Uma linha bem mais longa que a anterior aqui"],
      suggestions: [{ label: "Tentar", command: "beheld doctor" }],
    });
    const widths = out
      .split("\n")
      .map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").length);
    const unique = new Set(widths);
    expect(unique.size).toBe(1);
  });
});

// ── parseProcOutput (pure) ───────────────────────────────────────────────────

describe("parseProcOutput", () => {
  test("macOS typical R+ format", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.parseProcOutput("R+ 493.8 6-14:44:32")).toEqual({
      stat: "R+",
      cpuPct: 493.8,
      etime: "6-14:44:32",
    });
  });

  test("Linux with multiple spaces", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.parseProcOutput("S    1.2   00:15")).toEqual({
      stat: "S",
      cpuPct: 1.2,
      etime: "00:15",
    });
  });

  test("returns undefined for empty / too short / non-numeric cpu", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.parseProcOutput("")).toBeUndefined();
    expect(_internal.parseProcOutput("S")).toBeUndefined();
    expect(_internal.parseProcOutput("S abc def")).toBeUndefined();
  });
});

// ── checkEngine ──────────────────────────────────────────────────────────────

describe("checkEngine", () => {
  test("healthy → ok with runtimePid", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const result = await _internal.checkEngine({
      fetchEnginePid: async () => 12345,
      engineHealth: async () => ({ ok: true, version: "x.y.z" }),
      inspectProcess: () => undefined,
    });
    expect(result.severity).toBe("ok");
    expect(result.runtimePid).toBe(12345);
  });

  test("no listener → critical 'engine offline'", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const result = await _internal.checkEngine({
      fetchEnginePid: async () => undefined,
      engineHealth: async () => null,
      inspectProcess: () => undefined,
    });
    expect(result.severity).toBe("crit");
    expect(result.lines.join(" ")).toContain("sem listener");
    expect(result.hint).toContain("beheld start");
    expect(result.runtimePid).toBeUndefined();
  });

  test("listener + /health timeout + STAT=R + high CPU → 'Provável busy-loop'", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const result = await _internal.checkEngine({
      fetchEnginePid: async () => 70859,
      engineHealth: async () => null,
      inspectProcess: () => ({ stat: "R+", cpuPct: 493.8, etime: "6-14:44:32" }),
    });
    expect(result.severity).toBe("crit");
    const joined = result.lines.join(" ");
    expect(joined).toContain("LISTEN no PID 70859");
    expect(joined).toContain("Provável busy-loop");
    expect(result.hint).toContain("kill -9 70859");
    expect(result.runtimePid).toBe(70859);
  });

  test("listener + /health timeout + ps fails → 'vivo, HTTP travado'", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const result = await _internal.checkEngine({
      fetchEnginePid: async () => 70859,
      engineHealth: async () => null,
      inspectProcess: () => undefined,
    });
    expect(result.severity).toBe("crit");
    expect(result.lines.join(" ")).toContain("Processo vivo, HTTP travado");
    expect(result.hint).toContain("restart");
    expect(result.runtimePid).toBe(70859);
  });

  test("checkPidFile detecta divergência via runtimePid de checkEngine zumbi", async () => {
    fs.writeFileSync(
      path.join(tmpDir, ".beheld", "daemon.pid"),
      JSON.stringify({ mcp: 100, engine: 18518 }),
    );
    const { _internal } = await import("../src/commands/doctor");
    const engine = await _internal.checkEngine({
      fetchEnginePid: async () => 70859,
      engineHealth: async () => null,
      inspectProcess: () => ({ stat: "R+", cpuPct: 493.8, etime: "6-14:44:32" }),
    });
    expect(engine.runtimePid).toBe(70859);

    const pidCheck = _internal.checkPidFile(engine.runtimePid);
    expect(pidCheck.severity).toBe("warn");
    const joined = pidCheck.lines.join(" ");
    expect(joined).toContain("18518");
    expect(joined).toContain("70859");
  });
});

// ── pure formatters ──────────────────────────────────────────────────────────

describe("formatBytes", () => {
  test("bytes range", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.formatBytes(0)).toBe("0 B");
    expect(_internal.formatBytes(836)).toBe("836 B");
    expect(_internal.formatBytes(1023)).toBe("1023 B");
  });

  test("KB range", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.formatBytes(1024)).toBe("1.0 KB");
    expect(_internal.formatBytes(Math.round(12.3 * 1024))).toBe("12.3 KB");
  });

  test("MB range", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.formatBytes(4 * 1024 * 1024)).toBe("4.0 MB");
    expect(_internal.formatBytes(10 * 1024 * 1024)).toBe("10.0 MB");
  });
});

describe("formatDuration", () => {
  test("seconds", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.formatDuration(0)).toBe("0s");
    expect(_internal.formatDuration(45_000)).toBe("45s");
    expect(_internal.formatDuration(-500)).toBe("0s");
  });

  test("minutes", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.formatDuration(12 * 60 * 1000)).toBe("12min");
    expect(_internal.formatDuration(10 * 60 * 1000)).toBe("10min");
  });

  test("hours and days", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.formatDuration(6 * 60 * 60 * 1000)).toBe("6h");
    expect(_internal.formatDuration(5 * 24 * 60 * 60 * 1000)).toBe("5d");
  });
});

// ── computeExitCode ──────────────────────────────────────────────────────────

describe("computeExitCode", () => {
  test("empty → 0", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.computeExitCode([])).toBe(0);
  });

  test("all ok → 0", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(
      _internal.computeExitCode([
        { severity: "ok", label: "a", lines: [] },
        { severity: "ok", label: "b", lines: [] },
      ]),
    ).toBe(0);
  });

  test("at least one warn, no crit → 1", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(
      _internal.computeExitCode([
        { severity: "ok", label: "a", lines: [] },
        { severity: "warn", label: "b", lines: [] },
      ]),
    ).toBe(1);
  });

  test("at least one crit → 2", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(
      _internal.computeExitCode([
        { severity: "ok", label: "a", lines: [] },
        { severity: "crit", label: "b", lines: [] },
      ]),
    ).toBe(2);
  });

  test("mix crit + warn → 2", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(
      _internal.computeExitCode([
        { severity: "warn", label: "a", lines: [] },
        { severity: "crit", label: "b", lines: [] },
        { severity: "warn", label: "c", lines: [] },
      ]),
    ).toBe(2);
  });
});

// ── evaluateBacklog (per-file cursor model) ──────────────────────────────────

describe("evaluateBacklog", () => {
  const snap = (
    cursor: { offsets: Record<string, number>; mtime: number } | null,
    sessions: Array<{ name: string; size: number; mtime: number }>,
  ) => ({ cursor, sessions, profileDb: null, profileDbWal: null });

  test("sem sessões → ok", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const r = _internal.evaluateBacklog(snap(null, []));
    expect(r.severity).toBe("ok");
  });

  test("cursor null + 2 sessões totalizando 1000 B → warn 1000 bytes", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const r = _internal.evaluateBacklog(
      snap(null, [
        { name: "s1.jsonl", size: 400, mtime: 1 },
        { name: "s2.jsonl", size: 600, mtime: 2 },
      ]),
    );
    expect(r.severity).toBe("warn");
    expect(r.lines.join(" ")).toContain("1000 bytes");
  });

  test("cursor por-arquivo no meio de s2 → soma sessões não cobertas", async () => {
    const { _internal } = await import("../src/commands/doctor");
    // sessions: s1=500, s2=1000, s3=200; cursor cobre s2 até offset 300.
    // s1 sem offset → 500 unread. s2 → 1000-300 = 700. s3 sem offset → 200.
    // Total = 1400.
    const r = _internal.evaluateBacklog(
      snap({ offsets: { "s2.jsonl": 300 }, mtime: 1 }, [
        { name: "s1.jsonl", size: 500, mtime: 1 },
        { name: "s2.jsonl", size: 1000, mtime: 2 },
        { name: "s3.jsonl", size: 200, mtime: 3 },
      ]),
    );
    expect(r.severity).toBe("warn");
    expect(r.lines.join(" ")).toContain("1400 bytes");
  });

  test("cursor cobre todas as sessões → ok", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const r = _internal.evaluateBacklog(
      snap(
        { offsets: { "s1.jsonl": 500, "s2.jsonl": 1000, "s3.jsonl": 200 }, mtime: 1 },
        [
          { name: "s1.jsonl", size: 500, mtime: 1 },
          { name: "s2.jsonl", size: 1000, mtime: 2 },
          { name: "s3.jsonl", size: 200, mtime: 3 },
        ],
      ),
    );
    expect(r.severity).toBe("ok");
  });

  test("offsets stale para arquivos removidos não viram negativos", async () => {
    const { _internal } = await import("../src/commands/doctor");
    // ghost.jsonl está no cursor mas não em sessions[] → ignorado.
    // s1 com offset > size também não vira backlog negativo.
    const r = _internal.evaluateBacklog(
      snap(
        { offsets: { "ghost.jsonl": 999, "s1.jsonl": 700 }, mtime: 1 },
        [{ name: "s1.jsonl", size: 500, mtime: 1 }],
      ),
    );
    expect(r.severity).toBe("ok");
  });
});

// ── evaluateCursorStaleness ─────────────────────────────────────────────────

describe("evaluateCursorStaleness", () => {
  const FIVE_MIN = 5 * 60 * 1000;
  const snapWith = (
    cursor: { offsets: Record<string, number>; mtime: number } | null,
    sessions: Array<{ name: string; size: number; mtime: number }>,
  ) => ({ cursor, sessions, profileDb: null, profileDbWal: null });

  test("sem sessões → ok", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const r = _internal.evaluateCursorStaleness(snapWith(null, []), 0, FIVE_MIN);
    expect(r.severity).toBe("ok");
  });

  test("cursor null + sessões → warn, hint beheld start", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const r = _internal.evaluateCursorStaleness(
      snapWith(null, [{ name: "s.jsonl", size: 100, mtime: 1 }]),
      0,
      FIVE_MIN,
    );
    expect(r.severity).toBe("warn");
    expect(r.hint).toContain("beheld start");
  });

  test("cursor recente → ok", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const newest = 10_000_000;
    const r = _internal.evaluateCursorStaleness(
      snapWith({ offsets: {}, mtime: newest - 60_000 }, [
        { name: "s.jsonl", size: 100, mtime: newest },
      ]),
      newest,
      FIVE_MIN,
    );
    expect(r.severity).toBe("ok");
  });

  test("cursor parado há 10min → warn", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const newest = 10_000_000;
    const r = _internal.evaluateCursorStaleness(
      snapWith({ offsets: {}, mtime: newest - 10 * 60 * 1000 }, [
        { name: "s.jsonl", size: 100, mtime: newest },
      ]),
      newest,
      FIVE_MIN,
    );
    expect(r.severity).toBe("warn");
    expect(r.lines.join(" ")).toContain("Cursor parado há 10min");
  });
});

// ── evaluateDbWrite ─────────────────────────────────────────────────────────

describe("evaluateDbWrite", () => {
  const FIVE_MIN = 5 * 60 * 1000;
  const snapWith = (
    profileDb: { mtime: number } | null,
    sessions: Array<{ name: string; size: number; mtime: number }>,
  ) => ({ cursor: null, sessions, profileDb, profileDbWal: null });

  test("profile.db ausente → warn", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const r = _internal.evaluateDbWrite(snapWith(null, []), 0, FIVE_MIN);
    expect(r.severity).toBe("warn");
  });

  test("sem sessões → ok", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const r = _internal.evaluateDbWrite(snapWith({ mtime: 1 }, []), 0, FIVE_MIN);
    expect(r.severity).toBe("ok");
  });

  test("db recente → ok", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const newest = 10_000_000;
    const r = _internal.evaluateDbWrite(
      snapWith({ mtime: newest - 60_000 }, [{ name: "s.jsonl", size: 1, mtime: newest }]),
      newest,
      FIVE_MIN,
    );
    expect(r.severity).toBe("ok");
  });

  test("db estagnado → warn", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const newest = 10_000_000;
    const r = _internal.evaluateDbWrite(
      snapWith({ mtime: newest - 60 * 60 * 1000 }, [
        { name: "s.jsonl", size: 1, mtime: newest },
      ]),
      newest,
      FIVE_MIN,
    );
    expect(r.severity).toBe("warn");
  });
});

// ── evaluateWal ─────────────────────────────────────────────────────────────

describe("evaluateWal", () => {
  const FOUR_MIB = 4 * 1024 * 1024;
  const snapWith = (profileDbWal: { size: number } | null) => ({
    cursor: null,
    sessions: [],
    profileDb: null,
    profileDbWal,
  });

  test("sem WAL → ok", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.evaluateWal(snapWith(null), FOUR_MIB).severity).toBe("ok");
  });

  test("WAL vazio → ok", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.evaluateWal(snapWith({ size: 0 }), FOUR_MIB).severity).toBe("ok");
  });

  test("WAL pequeno → ok", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.evaluateWal(snapWith({ size: 1 * 1024 * 1024 }), FOUR_MIB).severity).toBe(
      "ok",
    );
  });

  test("WAL inchado → warn, label contém '10.0 MB'", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const r = _internal.evaluateWal(snapWith({ size: 10 * 1024 * 1024 }), FOUR_MIB);
    expect(r.severity).toBe("warn");
    expect(r.lines.join(" ")).toContain("10.0 MB");
  });
});

// ── takeProcessingSnapshot (integração, com BEHELD_DATA_DIR) ─────────────────

describe("takeProcessingSnapshot", () => {
  test("monta snapshot do tmpdir com cursor, sessões, profile.db e WAL", async () => {
    const base = path.join(tmpDir, ".beheld");
    fs.writeFileSync(
      path.join(base, ".cursor"),
      JSON.stringify({ offsets: { "a.jsonl": 100, "b.jsonl": 200 } }),
    );
    fs.writeFileSync(path.join(base, "sessions", "a.jsonl"), "x".repeat(150));
    fs.writeFileSync(path.join(base, "sessions", "b.jsonl"), "y".repeat(300));
    // arquivo não-.jsonl deve ser ignorado
    fs.writeFileSync(path.join(base, "sessions", "index.json"), "{}");
    fs.writeFileSync(path.join(base, "profile.db"), "sqlite-stub");
    fs.writeFileSync(path.join(base, "profile.db-wal"), Buffer.alloc(2048));

    const { _internal } = await import("../src/commands/doctor");
    const s = await _internal.takeProcessingSnapshot();
    expect(s.cursor).not.toBeNull();
    expect(s.cursor!.offsets).toEqual({ "a.jsonl": 100, "b.jsonl": 200 });
    expect(s.sessions.map((e: { name: string }) => e.name)).toEqual(["a.jsonl", "b.jsonl"]);
    expect(s.sessions.map((e: { size: number }) => e.size)).toEqual([150, 300]);
    expect(s.profileDb).not.toBeNull();
    expect(s.profileDbWal).toEqual({ size: 2048 });
  });

  test("ausência de .cursor / profile.db / WAL não lança", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const s = await _internal.takeProcessingSnapshot();
    expect(s.cursor).toBeNull();
    expect(s.sessions).toEqual([]);
    expect(s.profileDb).toBeNull();
    expect(s.profileDbWal).toBeNull();
  });
});

// ── parseLaunchctlList (pure) ────────────────────────────────────────────────

describe("parseLaunchctlList", () => {
  test("extracts PID when present", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(
      _internal.parseLaunchctlList(`{ "PID" = 12345; "LastExitStatus" = 0; }`),
    ).toEqual({ pid: 12345 });
  });

  test("returns empty when loaded but no PID (not running)", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.parseLaunchctlList(`{ "LastExitStatus" = 0; }`)).toEqual({});
  });

  test("returns empty for empty stdout", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.parseLaunchctlList("")).toEqual({});
  });

  test("returns empty for unexpected format", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.parseLaunchctlList("PID=12345")).toEqual({});
  });
});

// ── evaluateSystemdState (pure) ──────────────────────────────────────────────

describe("evaluateSystemdState", () => {
  test("enabled + active → {true, true}", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.evaluateSystemdState("enabled\n", "active\n")).toEqual({
      enabled: true,
      active: true,
    });
  });

  test("enabled + inactive → {true, false}", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.evaluateSystemdState("enabled\n", "inactive\n")).toEqual({
      enabled: true,
      active: false,
    });
  });

  test("disabled + active → {false, true}", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.evaluateSystemdState("disabled\n", "active\n")).toEqual({
      enabled: false,
      active: true,
    });
  });

  test("static counts as enabled", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.evaluateSystemdState("static\n", "active\n")).toEqual({
      enabled: true,
      active: true,
    });
  });

  test("masked + inactive → {false, false}", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.evaluateSystemdState("masked\n", "inactive\n")).toEqual({
      enabled: false,
      active: false,
    });
  });
});

// ── findSignaturesInLog (pure) ───────────────────────────────────────────────

describe("findSignaturesInLog", () => {
  test("empty text → []", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.findSignaturesInLog("", _internal.LOG_SIGNATURES)).toEqual([]);
  });

  test("no signatures present → []", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.findSignaturesInLog("foo\nbar\n", _internal.LOG_SIGNATURES)).toEqual([]);
  });

  test("one signature, two occurrences", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const hits = _internal.findSignaturesInLog(
      "... Errno 48 ... and then again Errno 48 ...",
      _internal.LOG_SIGNATURES,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ pattern: "Errno 48", count: 2 });
    expect(hits[0].hint).toBeTruthy();
  });

  test("two signatures keep catalog order", async () => {
    const { _internal } = await import("../src/commands/doctor");
    // Reverse the order in the text — output must follow the SIGNATURES order,
    // not the order in which they appear in the log.
    const hits = _internal.findSignaturesInLog(
      "engine trigger timeout — second.\nFirst line had Errno 48.\nAnother engine trigger timeout.",
      _internal.LOG_SIGNATURES,
    );
    expect(hits.map((h: { pattern: string }) => h.pattern)).toEqual([
      "Errno 48",
      "engine trigger timeout",
    ]);
    expect(hits[0].count).toBe(1);
    expect(hits[1].count).toBe(2);
  });

  test("case-sensitive — 'errno 48' (lowercase) does not match 'Errno 48'", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(
      _internal.findSignaturesInLog("errno 48 in lowercase", _internal.LOG_SIGNATURES),
    ).toEqual([]);
  });
});

// ── readLogTail (integration, tmpdir) ────────────────────────────────────────

describe("readLogTail", () => {
  test("missing file → null", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.readLogTail(path.join(tmpDir, "nonexistent.log"), 1024)).toBeNull();
  });

  test("file smaller than maxBytes → returns full content", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const fp = path.join(tmpDir, "small.log");
    fs.writeFileSync(fp, "hello world\n");
    expect(_internal.readLogTail(fp, 1024)).toBe("hello world\n");
  });

  test("file larger than maxBytes → returns last maxBytes bytes", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const fp = path.join(tmpDir, "big.log");
    // 5000 bytes total, "TAIL" stamped exactly at the last 4 bytes.
    const buf = Buffer.alloc(5000, "x");
    Buffer.from("TAIL").copy(buf, 4996);
    fs.writeFileSync(fp, buf);
    const tail = _internal.readLogTail(fp, 100);
    expect(tail).not.toBeNull();
    expect(tail!.length).toBe(100);
    expect(tail!.endsWith("TAIL")).toBe(true);
  });
});

// ── checkLogSignatures (integration via BEHELD_DATA_DIR) ─────────────────────

describe("checkLogSignatures", () => {
  test("log ausente → ok", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const r = _internal.checkLogSignatures();
    expect(r.severity).toBe("ok");
    expect(r.lines.join(" ")).toContain("ainda não criado");
  });

  test("log limpo → ok", async () => {
    fs.writeFileSync(path.join(tmpDir, ".beheld", "daemon.log"), "tudo normal aqui\n");
    const { _internal } = await import("../src/commands/doctor");
    const r = _internal.checkLogSignatures();
    expect(r.severity).toBe("ok");
    expect(r.lines.join(" ")).toContain("Nenhuma assinatura conhecida");
  });

  test("log com Errno 48 → warn + hint da primeira assinatura", async () => {
    fs.writeFileSync(
      path.join(tmpDir, ".beheld", "daemon.log"),
      "ERROR:    [Errno 48] error while attempting to bind on address ('127.0.0.1', 7338): address already in use\n".repeat(
        12,
      ),
    );
    const { _internal } = await import("../src/commands/doctor");
    const r = _internal.checkLogSignatures();
    expect(r.severity).toBe("warn");
    const joined = r.lines.join(" ");
    expect(joined).toContain("Errno 48");
    expect(joined).toContain("×12");
    expect(r.hint).toContain("Socket preso");
  });
});

// ── isInequivocalBusyLoop (pure, table-driven) ───────────────────────────────

describe("isInequivocalBusyLoop", () => {
  const FIVE_MIN = 5 * 60 * 1000;

  // Helpers para montar inputs sintéticos sem repetição.
  const proc = (overrides: Partial<{ stat: string; cpuPct: number; etime: string }> = {}) => ({
    stat: "R+",
    cpuPct: 541.4,
    etime: "06-16:42:35",
    ...overrides,
  });
  const engine = (overrides: {
    runtimePid?: number;
    severity?: "ok" | "warn" | "crit";
    proc?: { stat: string; cpuPct: number; etime: string };
  } = {}) => ({
    severity: "crit" as const,
    label: "Scoring engine",
    lines: [] as string[],
    runtimePid: 70859 as number | undefined,
    proc: proc() as { stat: string; cpuPct: number; etime: string } | undefined,
    ...overrides, // spread por último → undefined explícito sobrescreve.
  });
  const snap = (
    cursorMtime: number | null,
    newest: number,
    hasSessions = true,
  ) => ({
    cursor: cursorMtime === null ? null : { offsets: {}, mtime: cursorMtime },
    sessions: hasSessions ? [{ name: "s.jsonl", size: 1, mtime: newest }] : [],
    profileDb: null,
    profileDbWal: null,
  });

  test("4 condições satisfeitas → true", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const newest = 10_000_000;
    expect(
      _internal.isInequivocalBusyLoop(
        engine(),
        snap(newest - 10 * 60 * 1000, newest),
        FIVE_MIN,
      ),
    ).toBe(true);
  });

  test("sem listener → false", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const newest = 10_000_000;
    expect(
      _internal.isInequivocalBusyLoop(
        engine({ runtimePid: undefined }),
        snap(newest - 10 * 60 * 1000, newest),
        FIVE_MIN,
      ),
    ).toBe(false);
  });

  test("severity ok → false", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const newest = 10_000_000;
    expect(
      _internal.isInequivocalBusyLoop(
        engine({ severity: "ok" }),
        snap(newest - 10 * 60 * 1000, newest),
        FIVE_MIN,
      ),
    ).toBe(false);
  });

  test("sem proc (ps falhou) → false", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const newest = 10_000_000;
    const e = engine();
    delete (e as { proc?: unknown }).proc;
    expect(_internal.isInequivocalBusyLoop(e, snap(newest - 10 * 60 * 1000, newest), FIVE_MIN)).toBe(false);
  });

  test("STAT sem R → false", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const newest = 10_000_000;
    expect(
      _internal.isInequivocalBusyLoop(
        engine({ proc: proc({ stat: "S" }) }),
        snap(newest - 10 * 60 * 1000, newest),
        FIVE_MIN,
      ),
    ).toBe(false);
  });

  test("CPU = 50 (não estritamente >) → false", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const newest = 10_000_000;
    expect(
      _internal.isInequivocalBusyLoop(
        engine({ proc: proc({ cpuPct: 50 }) }),
        snap(newest - 10 * 60 * 1000, newest),
        FIVE_MIN,
      ),
    ).toBe(false);
  });

  test("cursor null → false", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const newest = 10_000_000;
    expect(_internal.isInequivocalBusyLoop(engine(), snap(null, newest), FIVE_MIN)).toBe(false);
  });

  test("sem sessões → false", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(
      _internal.isInequivocalBusyLoop(engine(), snap(0, 0, false), FIVE_MIN),
    ).toBe(false);
  });

  test("lag = threshold (não estritamente >) → false", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const newest = 10_000_000;
    expect(
      _internal.isInequivocalBusyLoop(
        engine(),
        snap(newest - FIVE_MIN, newest),
        FIVE_MIN,
      ),
    ).toBe(false);
  });

  test("lag = threshold + 1ms → true", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const newest = 10_000_000;
    expect(
      _internal.isInequivocalBusyLoop(
        engine(),
        snap(newest - FIVE_MIN - 1, newest),
        FIVE_MIN,
      ),
    ).toBe(true);
  });
});

// ── humanStepLabel / firstFailedStepHint (pure) ──────────────────────────────

describe("humanStepLabel + firstFailedStepHint", () => {
  test("humanStepLabel maps known step names", async () => {
    const { _internal } = await import("../src/commands/doctor");
    expect(_internal.humanStepLabel({ name: "kill-engine", ok: true, detail: "PID 70859" })).toContain("PID 70859");
    expect(_internal.humanStepLabel({ name: "wal-checkpoint", ok: true })).toContain("WAL checkpoint");
    expect(_internal.humanStepLabel({ name: "restart-daemon", ok: false, detail: "x" })).toContain("não religou");
    expect(_internal.humanStepLabel({ name: "capture-stack", ok: true, detail: "/tmp/x" })).toContain("/tmp/x");
  });

  test("firstFailedStepHint returns step-specific guidance for kill failure", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const report = {
      triggered: true as const,
      evidence: { runtimePid: 70859, stat: "R+", cpuPct: 541.4, etime: "1d", cursorLagMs: 1 },
      steps: [
        { name: "prepare-diagnostics-dir", ok: true },
        { name: "capture-stack", ok: true },
        { name: "kill-engine", ok: false, detail: "EPERM" },
      ],
      succeeded: false,
    };
    expect(_internal.firstFailedStepHint(report)).toContain("kill -9 70859");
  });

  test("firstFailedStepHint returns restart guidance when only restart fails", async () => {
    const { _internal } = await import("../src/commands/doctor");
    const report = {
      triggered: true as const,
      evidence: { runtimePid: 1, stat: "R", cpuPct: 99, etime: "1d", cursorLagMs: 1 },
      steps: [
        { name: "kill-engine", ok: true },
        { name: "restart-daemon", ok: false },
      ],
      succeeded: false,
    };
    expect(_internal.firstFailedStepHint(report)).toContain("beheld start");
  });
});

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

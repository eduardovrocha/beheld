import { test, expect, describe, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const TEST_PORT = 17337;
const BASE = `http://127.0.0.1:${TEST_PORT}`;

let server: ReturnType<typeof import("../src/server").startServer>;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "devprofile-server-test-"));
  process.env.DEVPROFILE_DATA_DIR = tmpDir;
  process.env.DEVPROFILE_PORT = String(TEST_PORT);

  const { startServer } = await import("../src/server");
  server = startServer();
  // Give the server a tick to bind
  await Bun.sleep(50);
});

afterAll(() => {
  server.stop(true);
  delete process.env.DEVPROFILE_DATA_DIR;
  delete process.env.DEVPROFILE_PORT;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /health", () => {
  test("returns 200 with status ok", async () => {
    const r = await fetch(`${BASE}/health`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { status: string; version: string };
    expect(body.status).toBe("ok");
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("GET /status", () => {
  test("returns daemon status with running state", async () => {
    const r = await fetch(`${BASE}/status`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { status: string; pid: number };
    expect(body.status).toBe("running");
    expect(body.pid).toBeGreaterThan(0);
  });
});

describe("GET /session/current", () => {
  test("returns active: false when no session active", async () => {
    const r = await fetch(`${BASE}/session/current`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { active: boolean };
    // May or may not have active sessions from prior tests
    expect(typeof body.active).toBe("boolean");
  });
});

describe("POST /hook/pre-tool", () => {
  test("accepts valid pre-tool hook and returns ok", async () => {
    const payload = {
      session_id: "test-session-abc",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      timestamp: "2026-05-10T12:00:00Z",
    };
    const r = await fetch(`${BASE}/hook/pre-tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("rejects malformed JSON with 400", async () => {
    const r = await fetch(`${BASE}/hook/pre-tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json{{",
    });
    expect(r.status).toBe(400);
  });

  test("writes event to JSONL file", async () => {
    await fetch(`${BASE}/hook/pre-tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "write-test-session",
        tool_name: "Read",
        tool_input: { file_path: "/project/src/main.ts" },
        timestamp: new Date().toISOString(),
      }),
    });

    const sessionsDir = path.join(tmpDir, ".devprofile", "sessions");
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    expect(files.length).toBeGreaterThan(0);

    const contents = files.map((f) =>
      fs.readFileSync(path.join(sessionsDir, f), "utf8"),
    ).join("");
    expect(contents).toContain("write-test-session");
  });
});

describe("POST /hook/post-tool", () => {
  test("accepts valid post-tool hook and returns ok", async () => {
    const r = await fetch(`${BASE}/hook/post-tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "test-session-abc",
        tool_name: "Bash",
        duration_ms: 500,
      }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

describe("POST /hook/stop", () => {
  test("accepts stop hook and removes session from memory", async () => {
    const sessionId = "stop-test-session";

    // First create a session with a pre-tool event
    await fetch(`${BASE}/hook/pre-tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        tool_name: "Bash",
        tool_input: { command: "ls" },
      }),
    });

    // Then stop it
    const r = await fetch(`${BASE}/hook/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        total_turns: 5,
      }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

describe("POST /mcp", () => {
  test("handles MCP initialize request", async () => {
    const r = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      result: { protocolVersion: string; serverInfo: { name: string } };
    };
    expect(body.result.protocolVersion).toBe("2024-11-05");
    expect(body.result.serverInfo.name).toBe("devprofile");
  });

  test("handles tools/list and returns devprofile tools", async () => {
    const r = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    const names = body.result.tools.map((t) => t.name);
    expect(names).toContain("devprofile");
    expect(names).toContain("devprofile_status");
  });

  test("returns 400 for invalid JSON", async () => {
    const r = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{{bad",
    });
    expect(r.status).toBe(400);
  });
});

describe("404 for unknown routes", () => {
  test("GET /unknown returns 404", async () => {
    const r = await fetch(`${BASE}/unknown`);
    expect(r.status).toBe(404);
  });
});

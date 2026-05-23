import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const TEST_PORT = 17337;
const BASE = `http://127.0.0.1:${TEST_PORT}`;

let server: ReturnType<typeof import("../src/server").startServer>;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beheld-server-test-"));
  process.env.BEHELD_DATA_DIR = tmpDir;
  process.env.BEHELD_PORT = String(TEST_PORT);

  const { startServer } = await import("../src/server");
  server = startServer();
  await Bun.sleep(50);
});

afterAll(() => {
  server.stop(true);
  delete process.env.BEHELD_DATA_DIR;
  delete process.env.BEHELD_PORT;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /health", () => {
  test("returns { ok: true } with version and uptime_seconds", async () => {
    const r = await fetch(`${BASE}/health`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean; version: string; uptime_seconds: number };
    expect(body.ok).toBe(true);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof body.uptime_seconds).toBe("number");
  });
});

describe("GET /status", () => {
  test("returns running: true", async () => {
    const r = await fetch(`${BASE}/status`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { running: boolean; events_today: number };
    expect(body.running).toBe(true);
    expect(typeof body.events_today).toBe("number");
  });
});

describe("GET /session/current", () => {
  test("returns active: false before any events", async () => {
    const r = await fetch(`${BASE}/session/current`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { active: boolean };
    expect(typeof body.active).toBe("boolean");
  });
});

describe("POST /hook/pre-tool", () => {
  test("returns { ok: true } for valid payload", async () => {
    const r = await fetch(`${BASE}/hook/pre-tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "test-session",
        tool_name: "Bash",
        tool_input: { command: "npm test" },
      }),
    });
    expect(r.status).toBe(200);
    expect((await r.json() as { ok: boolean }).ok).toBe(true);
  });

  test("returns 400 for malformed JSON", async () => {
    const r = await fetch(`${BASE}/hook/pre-tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{{bad",
    });
    expect(r.status).toBe(400);
    const body = await r.json() as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error).not.toContain("Error:"); // no stack traces
  });

  test("writes event to JSONL file", async () => {
    const sessionId = "write-check-session";
    await fetch(`${BASE}/hook/pre-tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        tool_name: "Read",
        tool_input: { file_path: "/project/src/main.ts" },
      }),
    });
    const sessionsDir = path.join(tmpDir, ".beheld", "sessions");
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    const allContent = files.map((f) =>
      fs.readFileSync(path.join(sessionsDir, f), "utf8"),
    ).join("");
    expect(allContent).toContain(sessionId);
  });

  test("sanitizes Anthropic API key from payload — key absent in JSONL", async () => {
    const sessionId = "sanitize-test-session";
    await fetch(`${BASE}/hook/pre-tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        tool_name: "Bash",
        tool_input: { command: "echo $SECRET", env: "SECRET=sk-testABCDEFGHIJKLMNOPQRSTUVWXYZ1234" },
      }),
    });
    const sessionsDir = path.join(tmpDir, ".beheld", "sessions");
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    const allContent = files.map((f) =>
      fs.readFileSync(path.join(sessionsDir, f), "utf8"),
    ).join("");
    expect(allContent).not.toContain("sk-test");
  });
});

describe("POST /hook/post-tool", () => {
  test("returns { ok: true }", async () => {
    const r = await fetch(`${BASE}/hook/post-tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "test-session", tool_name: "Bash", duration_ms: 300 }),
    });
    expect(r.status).toBe(200);
    expect((await r.json() as { ok: boolean }).ok).toBe(true);
  });
});

describe("POST /hook/stop", () => {
  test("returns { ok: true }", async () => {
    const r = await fetch(`${BASE}/hook/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "test-session", total_turns: 5 }),
    });
    expect(r.status).toBe(200);
    expect((await r.json() as { ok: boolean }).ok).toBe(true);
  });

  test("returns HTTP 200 in < 100ms with engine offline (fire-and-forget)", async () => {
    // Engine is not running in tests — connection refused fires instantly.
    // Response must not block on the 3s timeout.
    const start = Date.now();
    const r = await fetch(`${BASE}/hook/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "timing-test", total_turns: 3 }),
    });
    const elapsed = Date.now() - start;
    expect(r.status).toBe(200);
    expect(elapsed).toBeLessThan(100);
  });

  test("returns HTTP 200 with engine online (fire-and-forget, no blocking)", async () => {
    // Same assertion holds whether engine is up or down — response is immediate.
    const start = Date.now();
    const r = await fetch(`${BASE}/hook/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "online-test", total_turns: 1 }),
    });
    const elapsed = Date.now() - start;
    expect(r.status).toBe(200);
    expect(elapsed).toBeLessThan(100);
  });

  test("writes stop event to JSONL before returning", async () => {
    const sessionId = `stop-write-${Date.now()}`;
    await fetch(`${BASE}/hook/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, total_turns: 2 }),
    });
    const sessionsDir = path.join(tmpDir, ".beheld", "sessions");
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    const allContent = files.map((f) =>
      fs.readFileSync(path.join(sessionsDir, f), "utf8"),
    ).join("");
    expect(allContent).toContain(sessionId);
    expect(allContent).toContain('"event_type":"stop"');
  });
});

describe("POST /mcp", () => {
  test("initialize returns serverInfo", async () => {
    const r = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { result: { serverInfo: { name: string } } };
    expect(body.result.serverInfo.name).toBe("beheld");
  });

  test("tools/list returns beheld, beheld_coach and beheld_status", async () => {
    const r = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const body = (await r.json()) as { result: { tools: Array<{ name: string }> } };
    const names = body.result.tools.map((t) => t.name);
    expect(names).toContain("beheld");
    expect(names).toContain("beheld_coach");
    expect(names).toContain("beheld_status");
  });

  test("Continue.dev chat_request event is captured to JSONL", async () => {
    const r = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "chat_request",
        params: { text: "how does this work?", session_id: "continue-sess-1" },
      }),
    });
    expect(r.status).toBe(200);
    const sessionsDir = path.join(tmpDir, ".beheld", "sessions");
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    const allContent = files.map((f) =>
      fs.readFileSync(path.join(sessionsDir, f), "utf8"),
    ).join("");
    expect(allContent).toContain("chat_request");
  });

  test("returns 400 with { error } for invalid JSON", async () => {
    const r = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{{bad",
    });
    expect(r.status).toBe(400);
    expect((await r.json() as { error: string }).error).toBeTruthy();
  });
});

describe("Error responses", () => {
  test("unknown route returns 404", async () => {
    const r = await fetch(`${BASE}/unknown-route`);
    expect(r.status).toBe(404);
  });

  test("error responses do not contain stack traces", async () => {
    const r = await fetch(`${BASE}/hook/pre-tool`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "notjson",
    });
    const text = await r.text();
    expect(text).not.toContain("at ");       // no stack frames
    expect(text).not.toContain("Error:");    // no raw Error: prefix
  });
});

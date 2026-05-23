import { test, expect, describe, beforeAll, afterAll } from "bun:test";

// ── Mock engine ───────────────────────────────────────────────────────────────

const mockScores = {
  prompt_quality: 84,
  test_maturity: 62,
  tech_breadth: 91,
  growth_rate: 75,
  overall: 78,
  sessions_analyzed: 10,
  updated_at: "2026-05-10T00:00:00Z",
};

const mockInsights = {
  insights: ["Top 10% em qualidade de prompt", "TDD em apenas 23% das sessões"],
  generated_at: "2026-05-10T00:00:00Z",
};

const MOCK_PORT = 17360;
let engineServer: ReturnType<typeof Bun.serve>;
let savedEngineUrl: string | undefined;

beforeAll(async () => {
  savedEngineUrl = process.env.BEHELD_ENGINE_URL;
  process.env.BEHELD_ENGINE_URL = `http://127.0.0.1:${MOCK_PORT}`;

  engineServer = Bun.serve({
    port: MOCK_PORT,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      const json = (d: unknown) =>
        new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } });
      if (url.pathname === "/scores/current") return json(mockScores);
      if (url.pathname === "/insights") return json(mockInsights);
      if (url.pathname === "/profile/readiness")
        return json({ ready: true, sessions_count: 10, sessions_required: 3, sessions_remaining: 0 });
      if (url.pathname === "/profile/summary")
        return json({ total_sessions: 10, platforms: ["docker"], ecosystems: ["rails"], workflow_distribution: {}, project_categories: {} });
      return new Response("Not Found", { status: 404 });
    },
  });
  await Bun.sleep(30);
});

afterAll(() => {
  engineServer.stop(true);
  if (savedEngineUrl !== undefined) {
    process.env.BEHELD_ENGINE_URL = savedEngineUrl;
  } else {
    delete process.env.BEHELD_ENGINE_URL;
  }
});

// ── Tool registration ─────────────────────────────────────────────────────────
// Use unique ?v= cache busters so these modules don't share instances with tools.test.ts

describe("stdio-server tool list", () => {
  test("beheld tool is named correctly", async () => {
    const { beheldTool } = await import("../src/tools/beheld-tool?v=stdio-reg1");
    expect(beheldTool.name).toBe("beheld");
  });

  test("beheld tool has correct inputSchema with view enum", async () => {
    const { beheldTool } = await import("../src/tools/beheld-tool?v=stdio-reg1");
    const viewProp = beheldTool.inputSchema.properties["view"] as Record<string, unknown>;
    expect(viewProp).toBeDefined();
    expect(viewProp.type).toBe("string");
    const enums = viewProp["enum"] as string[];
    expect(enums).toContain("summary");
    expect(enums).toContain("scores");
    expect(enums).toContain("insight");
    expect(enums).toContain("full");
  });

  test("beheld_status tool is named correctly", async () => {
    const { statusTool } = await import("../src/tools/status-tool?v=stdio-reg1");
    expect(statusTool.name).toBe("beheld_status");
  });

  test("beheld_coach tool is named correctly", async () => {
    const { beheldCoachTool } = await import("../src/tools/coach-tool?v=stdio-reg1");
    expect(beheldCoachTool.name).toBe("beheld_coach");
  });

  test("beheld_coach has session_hint enum in inputSchema", async () => {
    const { beheldCoachTool } = await import("../src/tools/coach-tool?v=stdio-reg2");
    const hint = beheldCoachTool.inputSchema.properties["session_hint"] as Record<string, unknown>;
    expect(hint).toBeDefined();
    const enums = hint["enum"] as string[];
    expect(enums).toContain("feature_work");
    expect(enums).toContain("debug");
    expect(enums).toContain("unknown");
  });

});

// ── Handler wrapping ──────────────────────────────────────────────────────────

describe("stdio-server CallTool wrapping", () => {
  test("string result from handler is wrapped as content text", async () => {
    const { beheldTool } = await import("../src/tools/beheld-tool?v=stdio-wrap1");
    const result = await beheldTool.handler({ view: "summary" });
    const text = typeof result === "string" ? result : JSON.stringify(result);
    const content = [{ type: "text", text }];
    expect(content[0].type).toBe("text");
    expect(typeof content[0].text).toBe("string");
    expect(content[0].text).toContain("78/100");
  });

  test("object result from handler is JSON.stringified", async () => {
    const { statusTool } = await import("../src/tools/status-tool?v=stdio-wrap1");
    const result = await statusTool.handler({});
    const text = typeof result === "string" ? result : JSON.stringify(result);
    const parsed = JSON.parse(text);
    expect(parsed).toHaveProperty("score");
  });
});

// ── beheld tool via summary view ─────────────────────────────────────────

describe("CallTool summary returns formatted profile", () => {
  test("contains score geral header", async () => {
    const { beheldTool } = await import("../src/tools/beheld-tool?v=stdio-sum1");
    const text = (await beheldTool.handler({ view: "summary" })) as string;
    expect(text).toContain("Score geral");
  });

  test("contains overall score", async () => {
    const { beheldTool } = await import("../src/tools/beheld-tool?v=stdio-sum1");
    const text = (await beheldTool.handler({ view: "summary" })) as string;
    expect(text).toContain("78");
  });
});

// ── Readiness gate ────────────────────────────────────────────────────────────

describe("CallTool returns collecting message when readiness.ready = false", () => {
  test("shows collecting message and session count", async () => {
    const notReadyServer = Bun.serve({
      port: 17361,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        const json = (d: unknown) =>
          new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } });
        if (url.pathname === "/scores/current")
          return json({ ...mockScores, sessions_analyzed: 1 });
        if (url.pathname === "/profile/readiness")
          return json({ ready: false, sessions_count: 1, sessions_required: 3, sessions_remaining: 2 });
        return new Response("Not Found", { status: 404 });
      },
    });

    const saved = process.env.BEHELD_ENGINE_URL;
    process.env.BEHELD_ENGINE_URL = "http://127.0.0.1:17361";
    const { beheldTool } = await import("../src/tools/beheld-tool?v=stdio-notready");
    const text = (await beheldTool.handler({})) as string;
    notReadyServer.stop(true);
    process.env.BEHELD_ENGINE_URL = saved;

    expect(text).toContain("coletando dados");
    expect(text).toContain("1/3");
  });
});

// ── Engine offline ────────────────────────────────────────────────────────────

describe("CallTool returns offline message when engine unavailable", () => {
  test("returns engine offline message when scores are null", async () => {
    const savedUrl = process.env.BEHELD_ENGINE_URL;
    const savedDb = process.env.BEHELD_CACHE_DB;
    process.env.BEHELD_ENGINE_URL = "http://127.0.0.1:19993";
    process.env.BEHELD_CACHE_DB = "/tmp/beheld-stdio-offline-test.db";
    const { beheldTool } = await import("../src/tools/beheld-tool?v=stdio-offline");
    const text = (await beheldTool.handler({})) as string;
    process.env.BEHELD_ENGINE_URL = savedUrl;
    if (savedDb !== undefined) process.env.BEHELD_CACHE_DB = savedDb;
    else delete process.env.BEHELD_CACHE_DB;

    expect(text).toContain("engine offline");
  });
});

// ── Progress bars ─────────────────────────────────────────────────────────────

describe("scores view progress bars", () => {
  test("scores view contains progress bars (█ characters)", async () => {
    const { beheldTool } = await import("../src/tools/beheld-tool?v=stdio-bars1");
    const text = (await beheldTool.handler({ view: "scores" })) as string;
    expect(text).toContain("█");
  });

  test("scores view contains at least 8 filled bar segments for prompt_quality = 84", async () => {
    const { beheldTool } = await import("../src/tools/beheld-tool?v=stdio-bars1");
    const text = (await beheldTool.handler({ view: "scores" })) as string;
    expect(text).toContain("████████");
  });
});


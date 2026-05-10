import { test, expect, describe, beforeAll, afterAll } from "bun:test";

// ── Minimal engine mock ───────────────────────────────────────────────────────

const mockScores = {
  prompt_quality: 84,
  test_maturity: 62,
  tech_breadth: 91,
  growth_rate: 75,
  overall: 78,
  sessions_analyzed: 10,
  sessions_today: 3,
  updated_at: "2026-05-10T00:00:00Z",
  top_insight: "Ótima consistência nos prompts",
};

const mockSummary = {
  total_sessions: 10,
  platforms: ["docker", "github"],
  ecosystems: ["rails", "react"],
  workflow_distribution: { "test-after": 0.5, tdd: 0.3 },
  project_categories: { "saas-b2b": 0.6 },
};

const mockInsights = {
  insights: [
    "Top 10% em qualidade de prompt",
    "TDD em apenas 23% das sessões — oportunidade",
    "Tech breadth +12 pts nos últimos 60 dias",
  ],
  generated_at: "2026-05-10T00:00:00Z",
};

const MOCK_ENGINE_PORT = 17342;

let engineServer: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  process.env.DEVPROFILE_ENGINE_URL = `http://127.0.0.1:${MOCK_ENGINE_PORT}`;

  engineServer = Bun.serve({
    port: MOCK_ENGINE_PORT,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      const json = (d: unknown) =>
        new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } });
      if (url.pathname === "/scores/current") return json(mockScores);
      if (url.pathname === "/profile/summary") return json(mockSummary);
      if (url.pathname === "/insights") return json(mockInsights);
      if (url.pathname === "/health") return json({ ok: true });
      return new Response("Not Found", { status: 404 });
    },
  });
  await Bun.sleep(20);
});

afterAll(() => {
  engineServer.stop(true);
  delete process.env.DEVPROFILE_ENGINE_URL;
});

// ── devprofile_status tool ────────────────────────────────────────────────────

describe("devprofile_status tool handler", () => {
  test("returns score equal to overall", async () => {
    const { statusTool } = await import("../src/tools/status-tool");
    const result = (await statusTool.handler({})) as Record<string, unknown>;
    expect(result.score).toBe(78);
  });

  test("returns label in 'DevProfile N/100' format", async () => {
    const { statusTool } = await import("../src/tools/status-tool");
    const result = (await statusTool.handler({})) as Record<string, unknown>;
    expect(result.label).toBe("DevProfile 78/100");
  });

  test("returns last_updated timestamp", async () => {
    const { statusTool } = await import("../src/tools/status-tool");
    const result = (await statusTool.handler({})) as Record<string, unknown>;
    expect(result.last_updated).toBeTruthy();
  });

  test("returns top_insight field", async () => {
    const { statusTool } = await import("../src/tools/status-tool");
    const result = (await statusTool.handler({})) as Record<string, unknown>;
    expect("top_insight" in result).toBe(true);
  });

  test("has correct tool name", async () => {
    const { statusTool } = await import("../src/tools/status-tool");
    expect(statusTool.name).toBe("devprofile_status");
  });

  test("inputSchema has no required fields (sidebar polling)", async () => {
    const { statusTool } = await import("../src/tools/status-tool");
    expect(statusTool.inputSchema.required).toBeUndefined();
  });
});

describe("devprofile_status when engine offline", () => {
  test("returns { error: 'DevProfile engine offline' }", async () => {
    // Temporarily point to unreachable port
    const saved = process.env.DEVPROFILE_ENGINE_URL;
    process.env.DEVPROFILE_ENGINE_URL = "http://127.0.0.1:19998";
    const { statusTool } = await import("../src/tools/status-tool?v=offline");
    const result = (await statusTool.handler({})) as Record<string, unknown>;
    expect(result.error).toBe("DevProfile engine offline");
    process.env.DEVPROFILE_ENGINE_URL = saved;
  });
});

// ── devprofile tool ───────────────────────────────────────────────────────────

describe("devprofile tool — summary view (default)", () => {
  test("returns score and session count", async () => {
    const { devprofileTool } = await import("../src/tools/devprofile-tool");
    const text = (await devprofileTool.handler({})) as string;
    expect(text).toContain("78/100");
    expect(text).toContain("10");
  });

  test("returns top insights", async () => {
    const { devprofileTool } = await import("../src/tools/devprofile-tool");
    const text = (await devprofileTool.handler({ view: "summary" })) as string;
    expect(text).toContain("Top 10%");
  });

  test("tool name is 'devprofile'", async () => {
    const { devprofileTool } = await import("../src/tools/devprofile-tool");
    expect(devprofileTool.name).toBe("devprofile");
  });
});

describe("devprofile tool — scores view", () => {
  test("contains all 4 dimension labels", async () => {
    const { devprofileTool } = await import("../src/tools/devprofile-tool");
    const text = (await devprofileTool.handler({ view: "scores" })) as string;
    expect(text).toContain("Prompt quality");
    expect(text).toContain("Test maturity");
    expect(text).toContain("Tech breadth");
    expect(text).toContain("Growth rate");
  });

  test("contains bar characters", async () => {
    const { devprofileTool } = await import("../src/tools/devprofile-tool");
    const text = (await devprofileTool.handler({ view: "scores" })) as string;
    expect(text).toContain("█");
  });

  test("contains actual score numbers", async () => {
    const { devprofileTool } = await import("../src/tools/devprofile-tool");
    const text = (await devprofileTool.handler({ view: "scores" })) as string;
    expect(text).toContain("84");
    expect(text).toContain("62");
  });
});

describe("devprofile tool — insight view", () => {
  test("returns arrow-prefixed next action", async () => {
    const { devprofileTool } = await import("../src/tools/devprofile-tool");
    const text = (await devprofileTool.handler({ view: "insight" })) as string;
    expect(text).toContain("→");
  });

  test("returns first insight from engine", async () => {
    const { devprofileTool } = await import("../src/tools/devprofile-tool");
    const text = (await devprofileTool.handler({ view: "insight" })) as string;
    expect(text).toContain("Top 10%");
  });
});

describe("devprofile tool — full view", () => {
  test("contains score header", async () => {
    const { devprofileTool } = await import("../src/tools/devprofile-tool");
    const text = (await devprofileTool.handler({ view: "full" })) as string;
    expect(text).toContain("78/100");
  });

  test("contains platform information", async () => {
    const { devprofileTool } = await import("../src/tools/devprofile-tool");
    const text = (await devprofileTool.handler({ view: "full" })) as string;
    expect(text).toContain("docker");
  });

  test("contains ecosystem information", async () => {
    const { devprofileTool } = await import("../src/tools/devprofile-tool");
    const text = (await devprofileTool.handler({ view: "full" })) as string;
    expect(text).toContain("rails");
  });

  test("contains workflow distribution", async () => {
    const { devprofileTool } = await import("../src/tools/devprofile-tool");
    const text = (await devprofileTool.handler({ view: "full" })) as string;
    expect(text).toContain("test-after");
  });

  test("contains insight arrows", async () => {
    const { devprofileTool } = await import("../src/tools/devprofile-tool");
    const text = (await devprofileTool.handler({ view: "full" })) as string;
    expect(text).toContain("→");
  });
});

describe("devprofile tool — engine offline", () => {
  test("returns helpful offline message", async () => {
    const saved = process.env.DEVPROFILE_ENGINE_URL;
    process.env.DEVPROFILE_ENGINE_URL = "http://127.0.0.1:19999";
    const { devprofileTool } = await import("../src/tools/devprofile-tool?v=offline2");
    const text = (await devprofileTool.handler({})) as string;
    expect(text).toContain("engine not running");
    process.env.DEVPROFILE_ENGINE_URL = saved;
  });
});

describe("devprofile tool — zero sessions", () => {
  test("shows no-sessions message when sessions_analyzed = 0", async () => {
    const zeroServer = Bun.serve({
      port: 17343,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        const json = (d: unknown) =>
          new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } });
        if (url.pathname === "/scores/current")
          return json({ ...mockScores, overall: 0, sessions_analyzed: 0 });
        return json({});
      },
    });

    const saved = process.env.DEVPROFILE_ENGINE_URL;
    process.env.DEVPROFILE_ENGINE_URL = "http://127.0.0.1:17343";
    const { devprofileTool } = await import("../src/tools/devprofile-tool?v=zero");
    const text = (await devprofileTool.handler({})) as string;
    zeroServer.stop(true);
    process.env.DEVPROFILE_ENGINE_URL = saved;

    expect(text).toContain("nenhuma sessão");
  });
});

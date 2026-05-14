import { test, expect, describe, beforeAll, afterAll } from "bun:test";

const MOCK_PORT = 17350;

const livePayload = {
  version: 1,
  as_of: "2026-05-14T03:00:00+00:00",
  data_freshness: "live" as const,
  scores: {
    date: "2026-05-14",
    prompt_quality: 50,
    test_maturity: 20,
    tech_breadth: 40,
    growth_rate: 30,
    overall: 35,
    sessions_analyzed: 30,
  },
  context_for_session: {
    current_project_category: "web_backend",
    ecosystems_recent: ["rails"],
    session_phase_hint: "feature_work",
  },
  patterns: [
    {
      id: "test_after_dominant",
      label: "Testes escritos após o código",
      evidence: "80% das sessões classificadas como test-after.",
      metric: { ratio: 0.8, median_session_min: 12.0 },
      confidence: 0.6,
      trend_30d: "stable",
      severity: "high",
      applies_to_current_session: true,
    },
    {
      id: "debug_driven_bash_heavy",
      label: "Loop de debug com pouca leitura prévia",
      evidence: "Bash representa 6.0x o uso de Read.",
      metric: { bash_to_read_ratio: 6.0 },
      confidence: 0.6,
      trend_30d: "stable",
      severity: "low",
      applies_to_current_session: true,
    },
  ],
  coaching_guidance: {
    tone: "pt-BR, segunda pessoa, conciso",
    must: ["Cite no máximo 1 padrão"],
    must_not: ["Não invente porcentagens"],
    good_example: "Notei que normalmente você escreve o teste depois.",
    bad_example: "Seu test_maturity é 18/100.",
  },
  suggested_followups: ["Quer ver as sessões que mais puxaram esse padrão?"],
};

const insufficientPayload = {
  ...livePayload,
  data_freshness: "insufficient" as const,
  scores: { ...livePayload.scores, sessions_analyzed: 1 },
  patterns: [],
  suggested_followups: [],
};

const noPatternsPayload = {
  ...livePayload,
  patterns: [],
  suggested_followups: [],
};

let lastQuery: URLSearchParams | null = null;
let mockServer: ReturnType<typeof Bun.serve>;
let respondWith: () => unknown = () => livePayload;

beforeAll(async () => {
  process.env.DEVPROFILE_ENGINE_URL = `http://127.0.0.1:${MOCK_PORT}`;
  mockServer = Bun.serve({
    port: MOCK_PORT,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/coach") {
        lastQuery = url.searchParams;
        return new Response(JSON.stringify(respondWith()), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not Found", { status: 404 });
    },
  });
  await Bun.sleep(20);
});

afterAll(() => {
  mockServer.stop(true);
  delete process.env.DEVPROFILE_ENGINE_URL;
});

// ── basics ──────────────────────────────────────────────────────────────────

describe("devprofile_coach — schema", () => {
  test("tool name is 'devprofile_coach'", async () => {
    const { devprofileCoachTool } = await import("../src/tools/coach-tool");
    expect(devprofileCoachTool.name).toBe("devprofile_coach");
  });

  test("inputSchema lists session_hint as enum", async () => {
    const { devprofileCoachTool } = await import("../src/tools/coach-tool");
    const prop = devprofileCoachTool.inputSchema.properties.session_hint as {
      enum: string[];
    };
    expect(prop.enum).toEqual([
      "feature_work",
      "debug",
      "refactor",
      "exploration",
      "unknown",
    ]);
  });

  test("description contains 'QUANDO NÃO CHAMAR'", async () => {
    const { devprofileCoachTool } = await import("../src/tools/coach-tool");
    expect(devprofileCoachTool.description).toContain("QUANDO NÃO CHAMAR");
  });

  test("description tells the host how to use the JSON block", async () => {
    const { devprofileCoachTool } = await import("../src/tools/coach-tool");
    expect(devprofileCoachTool.description).toContain("---DEVPROFILE-JSON---");
    expect(devprofileCoachTool.description).toContain(
      "applies_to_current_session",
    );
  });
});

// ── live mode ───────────────────────────────────────────────────────────────

describe("devprofile_coach — live payload", () => {
  test("text contains pattern labels", async () => {
    respondWith = () => livePayload;
    const { devprofileCoachTool } = await import(
      "../src/tools/coach-tool?v=live1"
    );
    const out = (await devprofileCoachTool.handler({})) as string;
    expect(out).toContain("Testes escritos após o código");
    expect(out).toContain("Loop de debug");
  });

  test("text contains pattern count header", async () => {
    respondWith = () => livePayload;
    const { devprofileCoachTool } = await import(
      "../src/tools/coach-tool?v=live2"
    );
    const out = (await devprofileCoachTool.handler({})) as string;
    expect(out).toContain("Padrões detectados (2)");
  });

  test("text shows score + freshness summary", async () => {
    respondWith = () => livePayload;
    const { devprofileCoachTool } = await import(
      "../src/tools/coach-tool?v=live3"
    );
    const out = (await devprofileCoachTool.handler({})) as string;
    expect(out).toContain("Score geral: 35/100");
    expect(out).toContain("· 30 sessões ·");
    expect(out).toContain("· live");
  });

  test("contains JSON delimiters", async () => {
    respondWith = () => livePayload;
    const { devprofileCoachTool } = await import(
      "../src/tools/coach-tool?v=live4"
    );
    const out = (await devprofileCoachTool.handler({})) as string;
    expect(out).toContain("---DEVPROFILE-JSON---");
    expect(out).toContain("---END-JSON---");
  });

  test("JSON block parses back to the payload sent by the engine", async () => {
    respondWith = () => livePayload;
    const { devprofileCoachTool } = await import(
      "../src/tools/coach-tool?v=live5"
    );
    const out = (await devprofileCoachTool.handler({})) as string;
    const match = out.match(/---DEVPROFILE-JSON---\n([\s\S]+?)\n---END-JSON---/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);
    expect(parsed.version).toBe(1);
    expect(parsed.patterns).toHaveLength(2);
    expect(parsed.patterns[0].id).toBe("test_after_dominant");
    expect(parsed.coaching_guidance.must.length).toBeGreaterThan(0);
  });

  test("session_hint is forwarded to the engine", async () => {
    respondWith = () => livePayload;
    lastQuery = null;
    const { devprofileCoachTool } = await import(
      "../src/tools/coach-tool?v=hint1"
    );
    await devprofileCoachTool.handler({ session_hint: "debug" });
    expect(lastQuery?.get("session_hint")).toBe("debug");
  });

  test("invalid session_hint is coerced to 'unknown' before being sent", async () => {
    respondWith = () => livePayload;
    lastQuery = null;
    const { devprofileCoachTool } = await import(
      "../src/tools/coach-tool?v=hint2"
    );
    await devprofileCoachTool.handler({ session_hint: "junk_value" });
    expect(lastQuery?.get("session_hint")).toBe("unknown");
  });
});

// ── empty patterns ──────────────────────────────────────────────────────────

describe("devprofile_coach — live with no patterns", () => {
  test("text says 'sem padrões observáveis'", async () => {
    respondWith = () => noPatternsPayload;
    const { devprofileCoachTool } = await import(
      "../src/tools/coach-tool?v=nopat"
    );
    const out = (await devprofileCoachTool.handler({})) as string;
    expect(out).toContain("Sem padrões observáveis");
    // still embeds the JSON block (host LLM still gets guidance)
    expect(out).toContain("---DEVPROFILE-JSON---");
  });
});

// ── insufficient ────────────────────────────────────────────────────────────

describe("devprofile_coach — insufficient data", () => {
  test("returns 'coletando dados' header", async () => {
    respondWith = () => insufficientPayload;
    const { devprofileCoachTool } = await import(
      "../src/tools/coach-tool?v=insuf1"
    );
    const out = (await devprofileCoachTool.handler({})) as string;
    expect(out).toContain("DevProfile ainda coletando dados");
    expect(out).toContain("1/3 sessões");
  });

  test("uses singular 'sessão' when only 1 missing", async () => {
    respondWith = () => ({
      ...insufficientPayload,
      scores: { ...insufficientPayload.scores, sessions_analyzed: 2 },
    });
    const { devprofileCoachTool } = await import(
      "../src/tools/coach-tool?v=insuf2"
    );
    const out = (await devprofileCoachTool.handler({})) as string;
    expect(out).toContain("falta 1 sessão");
  });

  test("still embeds JSON block so host has the guidance available", async () => {
    respondWith = () => insufficientPayload;
    const { devprofileCoachTool } = await import(
      "../src/tools/coach-tool?v=insuf3"
    );
    const out = (await devprofileCoachTool.handler({})) as string;
    const match = out.match(/---DEVPROFILE-JSON---\n([\s\S]+?)\n---END-JSON---/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);
    expect(parsed.data_freshness).toBe("insufficient");
    expect(parsed.coaching_guidance.good_example).toBeTruthy();
  });
});

// ── engine offline ──────────────────────────────────────────────────────────

describe("devprofile_coach — engine offline", () => {
  test("returns plain offline message (no JSON block to leak)", async () => {
    const saved = process.env.DEVPROFILE_ENGINE_URL;
    process.env.DEVPROFILE_ENGINE_URL = "http://127.0.0.1:19997";
    const { devprofileCoachTool } = await import(
      "../src/tools/coach-tool?v=offline"
    );
    const out = (await devprofileCoachTool.handler({})) as string;
    process.env.DEVPROFILE_ENGINE_URL = saved;
    expect(out).toContain("engine offline");
    expect(out).not.toContain("---DEVPROFILE-JSON---");
  });
});

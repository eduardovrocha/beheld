import { test, expect, describe, beforeAll, afterAll } from "bun:test";

import { renderCoachText } from "../src/ui/coach-view";
import type { CoachPayload } from "../src/client/engine-client";

const ANSI = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI, "");

const livePayload: CoachPayload = {
  version: 1,
  as_of: "2026-05-14T03:00:00+00:00",
  data_freshness: "live",
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
    ecosystems_recent: ["rails", "react"],
    session_phase_hint: "feature_work",
  },
  patterns: [
    {
      id: "test_after_dominant",
      label: "Testes escritos após o código",
      evidence: "80% das sessões classificadas como test-after.",
      metric: { ratio: 0.8 },
      confidence: 0.84,
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
      applies_to_current_session: false,
    },
  ],
  coaching_guidance: {
    tone: "pt-BR",
    must: ["..."],
    must_not: ["..."],
    good_example: "",
    bad_example: "",
  },
  suggested_followups: [],
};

const insufficientPayload: CoachPayload = {
  ...livePayload,
  data_freshness: "insufficient",
  scores: { ...livePayload.scores, sessions_analyzed: 1, overall: 0 },
  patterns: [],
};

const noPatternsPayload: CoachPayload = {
  ...livePayload,
  patterns: [],
};

// ── live mode ────────────────────────────────────────────────────────────────

describe("renderCoachText — live mode", () => {
  test("header includes 'coach' and version", () => {
    const out = stripAnsi(renderCoachText(livePayload));
    expect(out).toContain("Beheld · coach");
    expect(out).toContain("v1");
    expect(out).toContain("live");
  });

  test("shows pattern count", () => {
    const out = stripAnsi(renderCoachText(livePayload));
    expect(out).toContain("Padrões (2)");
  });

  test("shows each pattern label and evidence", () => {
    const out = stripAnsi(renderCoachText(livePayload));
    expect(out).toContain("Testes escritos após o código");
    expect(out).toContain("80% das sessões classificadas como test-after");
    expect(out).toContain("Loop de debug com pouca leitura prévia");
  });

  test("shows confidence formatted with 2 decimals", () => {
    const out = stripAnsi(renderCoachText(livePayload));
    expect(out).toContain("conf 0.84");
    expect(out).toContain("conf 0.60");
  });

  test("shows severity tag", () => {
    const out = stripAnsi(renderCoachText(livePayload));
    expect(out).toContain("[high");
    expect(out).toContain("[low");
  });

  test("marks applies_to_current_session with ✓", () => {
    const out = renderCoachText(livePayload);
    // Look for ✓ near the pattern that applies (test_after_dominant)
    const lines = stripAnsi(out).split("\n");
    const testAfterLine = lines.find((l) => l.includes("Testes escritos após"));
    expect(testAfterLine).toBeDefined();
    expect(testAfterLine).toContain("✓");
  });

  test("does not mark applies=false patterns with ✓", () => {
    const out = stripAnsi(renderCoachText(livePayload));
    const lines = out.split("\n");
    const debugLine = lines.find((l) => l.includes("Loop de debug"));
    expect(debugLine).toBeDefined();
    expect(debugLine).not.toContain("✓");
  });

  test("shows context line with phase and ecosystems", () => {
    const out = stripAnsi(renderCoachText(livePayload));
    expect(out).toContain("feature_work");
    expect(out).toContain("rails");
  });

  test("shows score summary footer", () => {
    const out = stripAnsi(renderCoachText(livePayload));
    expect(out).toContain("Score: 35/100");
    expect(out).toContain("30 sessões");
  });

  test("does NOT leak the JSON delimiter — that's only for MCP", () => {
    const out = renderCoachText(livePayload);
    expect(out).not.toContain("---BEHELD-JSON---");
    expect(out).not.toContain("---END-JSON---");
  });
});

// ── no patterns ──────────────────────────────────────────────────────────────

describe("renderCoachText — live with no patterns", () => {
  test("says 'sem padrões observáveis'", () => {
    const out = stripAnsi(renderCoachText(noPatternsPayload));
    expect(out).toContain("Sem padrões observáveis");
  });

  test("still shows score footer", () => {
    const out = stripAnsi(renderCoachText(noPatternsPayload));
    expect(out).toContain("Score:");
  });
});

// ── insufficient ─────────────────────────────────────────────────────────────

describe("renderCoachText — insufficient", () => {
  test("shows collecting header", () => {
    const out = stripAnsi(renderCoachText(insufficientPayload));
    expect(out).toContain("coletando dados");
    expect(out).toContain("1/3 sessões");
  });

  test("uses singular 'sessão' when only 1 missing", () => {
    const payload: CoachPayload = {
      ...insufficientPayload,
      scores: { ...insufficientPayload.scores, sessions_analyzed: 2 },
    };
    const out = stripAnsi(renderCoachText(payload));
    expect(out).toContain("falta 1 sessão");
    expect(out).not.toContain("faltam 1");
  });

  test("uses plural when multiple missing", () => {
    const payload: CoachPayload = {
      ...insufficientPayload,
      scores: { ...insufficientPayload.scores, sessions_analyzed: 0 },
    };
    const out = stripAnsi(renderCoachText(payload));
    expect(out).toContain("faltam 3 sessões");
  });

  test("does not render patterns block in insufficient mode", () => {
    const out = stripAnsi(renderCoachText(insufficientPayload));
    expect(out).not.toContain("Padrões");
  });
});

// ── client wiring (mock engine) ──────────────────────────────────────────────

const MOCK_PORT = 17360;
let server: ReturnType<typeof Bun.serve>;
let lastRequest: URL | null = null;

beforeAll(async () => {
  process.env.BEHELD_ENGINE_URL = `http://127.0.0.1:${MOCK_PORT}`;
  server = Bun.serve({
    port: MOCK_PORT,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      lastRequest = url;
      if (url.pathname === "/coach") {
        return new Response(JSON.stringify(livePayload), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not Found", { status: 404 });
    },
  });
  await Bun.sleep(20);
});

afterAll(() => {
  server.stop(true);
  delete process.env.BEHELD_ENGINE_URL;
});

describe("engine-client.coach()", () => {
  test("hits /coach with the session_hint query param", async () => {
    const { coach } = await import("../src/client/engine-client?v=coach-client1");
    lastRequest = null;
    const payload = await coach("feature_work");
    expect(payload).not.toBeNull();
    expect(lastRequest?.pathname).toBe("/coach");
    expect(lastRequest?.searchParams.get("session_hint")).toBe("feature_work");
  });

  test("returns null when engine is offline", async () => {
    const saved = process.env.BEHELD_ENGINE_URL;
    process.env.BEHELD_ENGINE_URL = "http://127.0.0.1:19996";
    const { coach } = await import("../src/client/engine-client?v=coach-client-offline");
    const result = await coach();
    expect(result).toBeNull();
    process.env.BEHELD_ENGINE_URL = saved;
  });

  test("default hint is 'unknown'", async () => {
    const { coach } = await import("../src/client/engine-client?v=coach-client-default");
    lastRequest = null;
    await coach();
    expect(lastRequest?.searchParams.get("session_hint")).toBe("unknown");
  });
});

/**
 * R1.2c — profile-view + beheld-tool null-safe rendering.
 *
 * After R1.2c, scores.{prompt_quality, growth_rate, overall} can be null
 * when the underlying dimension was absent (PromptQuality has no enrichment,
 * GrowthRate has <6mo history, overall has all-null inputs). The CLI views
 * must NOT crash on null and MUST NOT render the literal string "null".
 *
 * These tests exercise the public `renderProfile` entry point with score
 * payloads containing nulls and assert the visible output uses the em-dash
 * "—" sentinel + DIM bars instead.
 */
import { test, expect, describe } from "bun:test";
import { renderProfile } from "../src/ui/profile-view";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function fixturePayload(overrides: Partial<{
  prompt_quality: number | null;
  test_maturity: number;
  tech_breadth: number;
  growth_rate: number | null;
  overall: number | null;
  sessions_analyzed: number;
}> = {}) {
  return {
    scores: {
      date: "2026-06-01",
      prompt_quality: 70,
      test_maturity: 50,
      tech_breadth: 60,
      growth_rate: 45,
      overall: 55,
      sessions_analyzed: 12,
      ...overrides,
    },
    summary: null,
    insights: [],
    session: null,
  };
}

describe("renderProfile — R1.2c null safety", () => {
  test("renders all four numeric scores normally when none are null", () => {
    const out = stripAnsi(renderProfile(fixturePayload(), {}));
    expect(out).toContain("Prompt quality");
    expect(out).toContain(" 70");
    expect(out).toContain("Test maturity");
    expect(out).toContain(" 50");
    expect(out).toContain("Tech breadth");
    expect(out).toContain(" 60");
    expect(out).toContain("Growth rate");
    expect(out).toContain(" 45");
    expect(out).toContain("Overall");
    expect(out).toContain("55/100");
    // No "—" inside any score line (title em-dash in "Beheld — seu perfil"
    // is incidental). All four score rows render numeric values.
    expect(out).not.toMatch(/Prompt quality\s+—/);
    expect(out).not.toMatch(/Growth rate\s+—/);
    expect(out).not.toMatch(/Overall\s+—\/100/);
    expect(out).not.toContain("null");
  });

  test("renders '—' for null prompt_quality without crashing or printing 'null'", () => {
    const out = stripAnsi(renderProfile(fixturePayload({ prompt_quality: null }), {}));
    // Prompt quality row uses em-dash, not literal "null"
    expect(out).toContain("Prompt quality");
    expect(out).not.toMatch(/Prompt quality\s+null/);
    expect(out).toMatch(/Prompt quality\s+—/);
    // The other numeric scores still render.
    expect(out).toContain(" 50");
    expect(out).toContain(" 60");
    expect(out).toContain(" 45");
  });

  test("renders '—' for null growth_rate", () => {
    const out = stripAnsi(renderProfile(fixturePayload({ growth_rate: null }), {}));
    expect(out).toMatch(/Growth rate\s+—/);
    expect(out).not.toMatch(/Growth rate\s+null/);
  });

  test("renders 'Overall —/100' when overall is null", () => {
    const out = stripAnsi(renderProfile(
      fixturePayload({ overall: null, prompt_quality: null, growth_rate: null }),
      {},
    ));
    expect(out).toContain("Overall");
    expect(out).toContain("—/100");
    expect(out).not.toContain("null/100");
  });

  test("scoresOnly mode renders 'null' as machine-readable token (not human '—')", () => {
    // Machine-readable downstream consumers need to distinguish absent
    // from zero — the human view uses '—', but `--scores-only` uses
    // literal "null" so JSON consumers can parse it directly.
    const out = renderProfile(
      fixturePayload({ prompt_quality: null, growth_rate: null }),
      { scoresOnly: true },
    );
    // Format: "<pq> <tm> <tb> <gr>" — null for missing positions.
    expect(out).toBe("null 50 60 null");
  });

  test("scoresOnly when scores is absent falls back to legacy '0 0 0 0'", () => {
    const out = renderProfile(
      { scores: null, summary: null, insights: [], session: null } as never,
      { scoresOnly: true },
    );
    expect(out).toBe("0 0 0 0");
  });
});

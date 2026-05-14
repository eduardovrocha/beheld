/**
 * TypeScript twin of packages/engine/tests/test_bundle.py.
 *
 * Both tests build the SAME fixture in their respective languages and assert
 * against the SAME expected canonical string + hash. If they ever diverge, one
 * of these tests fails — drift caught at test time.
 *
 * If you change the bundle schema or canonical_json rules, you MUST regenerate
 * the EXPECTED_* constants in BOTH files (mirror change) and bump
 * BUNDLE_VERSION.
 */
import { test, expect, describe } from "bun:test";

import { canonicalJson, payloadHash, payloadToCanonical } from "../src/bundle/canonical";
import { BUNDLE_VERSION, type BundlePayload } from "../src/bundle/types";

// ── shared fixture (mirror in packages/engine/tests/test_bundle.py) ─────────

function fixturePayload(): BundlePayload {
  return {
    created_at: "2026-05-14T00:00:00+00:00",
    devprofile_version: "0.2.0",
    previous_hash: null,
    scores: {
      date: "2026-05-13",
      prompt_quality: 50,
      test_maturity: 20,
      tech_breadth: 40,
      growth_rate: 30,
      overall: 35,
      sessions_analyzed: 30,
    },
    l1: {
      total_repos: 2,
      total_commits: 1200,
      earliest_commit: "2023-01-01T00:00:00+00:00",
      latest_commit: "2026-05-13T00:00:00+00:00",
      ecosystems: { python: true, rails: true },
      platforms: { docker: true, github: true },
      avg_test_ratio: 0.42,
      root_commit_hashes: ["a".repeat(40), "b".repeat(40)],
    },
    l2: {
      platforms: { docker: 10, github: 5 },
      ecosystems: { rails: 8, react: 4 },
      workflow_distribution: { tdd: 0.2, "test-after": 0.6 },
      project_categories: { saas_b2b: 1.0 },
      workflow_metrics: {
        test_after_ratio: 0.6,
        test_first_ratio: 0.0,
        median_test_delay_min: 0.0,
        edit_to_test_lag_min: 0.0,
        bash_to_read_ratio: 0.0,
        prompt_avg_chars: 0.0,
        prompt_median_chars: 0.0,
        session_avg_duration_min: 0.0,
        tool_variety_avg: 0.0,
        ecosystem_concentration: 0.0,
      },
      sessions_analyzed: 30,
      period_days: 30,
    },
  };
}

const EXPECTED_CANONICAL =
  '{"created_at":"2026-05-14T00:00:00+00:00","devprofile_version":"0.2.0",' +
  '"l1":{"avg_test_ratio":0.42,' +
  '"earliest_commit":"2023-01-01T00:00:00+00:00",' +
  '"ecosystems":{"python":true,"rails":true},' +
  '"latest_commit":"2026-05-13T00:00:00+00:00",' +
  '"platforms":{"docker":true,"github":true},' +
  '"root_commit_hashes":["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",' +
  '"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],' +
  '"total_commits":1200,"total_repos":2},' +
  '"l2":{"ecosystems":{"rails":8,"react":4},"period_days":30,' +
  '"platforms":{"docker":10,"github":5},"project_categories":{"saas_b2b":1},' +
  '"sessions_analyzed":30,' +
  '"workflow_distribution":{"tdd":0.2,"test-after":0.6},' +
  '"workflow_metrics":{"bash_to_read_ratio":0,"ecosystem_concentration":0,' +
  '"edit_to_test_lag_min":0,"median_test_delay_min":0,' +
  '"prompt_avg_chars":0,"prompt_median_chars":0,' +
  '"session_avg_duration_min":0,"test_after_ratio":0.6,' +
  '"test_first_ratio":0,"tool_variety_avg":0}},' +
  '"previous_hash":null,' +
  '"scores":{"date":"2026-05-13","growth_rate":30,"overall":35,' +
  '"prompt_quality":50,"sessions_analyzed":30,"tech_breadth":40,' +
  '"test_maturity":20}}';

const EXPECTED_HASH =
  "sha256:60168f63bb60ff60bcbfb382733f2da1813284ee75ab03459c02ca6cd7abb509";

// ── canonical_json basics ────────────────────────────────────────────────────

describe("canonicalJson — primitives", () => {
  test("BUNDLE_VERSION is '2'", () => {
    expect(BUNDLE_VERSION).toBe("2");
  });

  test("sorts keys alphabetically", () => {
    expect(canonicalJson({ z: 1, a: 2, m: 3 })).toBe('{"a":2,"m":3,"z":1}');
  });

  test("uses compact separators", () => {
    const out = canonicalJson({ a: 1, b: 2 });
    expect(out).not.toContain(", ");
    expect(out).not.toContain(": ");
  });

  test("recurses into nested objects", () => {
    expect(canonicalJson({ x: { z: 1, a: 2 }, a: 3 })).toBe(
      '{"a":3,"x":{"a":2,"z":1}}',
    );
  });

  test("recurses into arrays", () => {
    expect(canonicalJson([{ z: 1, a: 2 }, { y: 3, b: 4 }])).toBe(
      '[{"a":2,"z":1},{"b":4,"y":3}]',
    );
  });

  test("preserves null", () => {
    expect(canonicalJson({ x: null })).toBe('{"x":null}');
  });

  test("drops .0 from whole floats (JS default — matches Python coercion)", () => {
    expect(canonicalJson({ x: 1.0 })).toBe('{"x":1}');
    expect(canonicalJson({ x: 0.0 })).toBe('{"x":0}');
  });

  test("preserves non-whole floats", () => {
    expect(canonicalJson({ x: 0.6 })).toBe('{"x":0.6}');
    expect(canonicalJson({ x: 0.2 })).toBe('{"x":0.2}');
  });
});

// ── contract lock ────────────────────────────────────────────────────────────

describe("bundle contract", () => {
  test("fixture serializes to the same canonical bytes as Python", () => {
    const actual = payloadToCanonical(fixturePayload());
    expect(actual).toBe(EXPECTED_CANONICAL);
    expect(actual.length).toBe(1052);
  });

  test("fixture hash matches Python's hash byte-for-byte", async () => {
    const actual = await payloadHash(fixturePayload());
    expect(actual).toBe(EXPECTED_HASH);
  });

  test("hash is deterministic across runs", async () => {
    const a = await payloadHash(fixturePayload());
    const b = await payloadHash(fixturePayload());
    expect(a).toBe(b);
  });

  test("single-bit change propagates to the hash", async () => {
    const base = fixturePayload();
    const tampered: BundlePayload = {
      ...base,
      scores: { ...base.scores, prompt_quality: base.scores.prompt_quality + 1 },
    };
    expect(await payloadHash(base)).not.toBe(await payloadHash(tampered));
  });

  test("fixture key order in source does NOT affect hash", async () => {
    // Build the same fixture with deliberately shuffled key order
    const base = fixturePayload();
    const shuffled: BundlePayload = {
      l2: base.l2,
      l1: base.l1,
      scores: base.scores,
      previous_hash: base.previous_hash,
      devprofile_version: base.devprofile_version,
      created_at: base.created_at,
    };
    expect(await payloadHash(shuffled)).toBe(await payloadHash(base));
  });
});

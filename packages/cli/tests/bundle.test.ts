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
import {
  BUNDLE_VERSION,
  type Bundle,
  type BundleAttestation,
  type BundlePayload,
} from "../src/bundle/types";

// ── shared fixture (mirror in packages/engine/tests/test_bundle.py) ─────────

function fixturePayload(): BundlePayload {
  return {
    created_at: "2026-05-14T00:00:00+00:00",
    beheld_version: "0.2.0",
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
    core: {
      total_repos: 2,
      total_commits: 1200,
      earliest_commit: "2023-01-01T00:00:00+00:00",
      latest_commit: "2026-05-13T00:00:00+00:00",
      ecosystems: { python: true, rails: true },
      platforms: { docker: true, github: true },
      avg_test_ratio: 0.42,
      root_commit_hashes: [
        { hash: "a".repeat(40), first_seen_at: "2026-04-01T00:00:00+00:00" },
        { hash: "b".repeat(40), first_seen_at: "2026-04-15T00:00:00+00:00" },
      ],
    },
    enrichment: {
      harness_sources: [
        { harness: "claude_code", capture_fidelity: "native_hook", sessions: 30 },
      ],
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
    engine_version_hash: "0".repeat(64),
    // Schema v4 (F6.12) — public retrato overlays embedded in signed bytes.
    // Shapes mirror the Python fixture exactly; any drift fails this test.
    stack: {
      language_distribution: [
        {
          language: "Ruby",
          commit_count: 100,
          file_count: 200,
          first_seen: "2024-01",
          last_seen: "2026-05",
          weight_pct: 60.0,
        },
        {
          language: "Python",
          commit_count: 50,
          file_count: 80,
          first_seen: "2025-01",
          last_seen: "2025-12",
          weight_pct: 40.0,
        },
      ],
      architecture_patterns: [
        { pattern: "mvc", repo_count: 1, confidence: "strong" },
      ],
      total_commits_analyzed: 150,
      repos_analyzed: 2,
    },
    signals: {
      schema_version: "1",
      ecosystems: { dominant: ["rails"], secondary: [] },
      test_pattern: { discipline: "moderate", approach: "test-after" },
      timing: { peak_period: "morning", consistency: "regular" },
      tooling: { platforms: ["docker", "github"] },
    },
    identity: {
      identity_long: "Dev Ruby/Python com hábito test-after.",
      identity_short: "Dev Ruby/Python.",
      confidence: "medium",
      generation_path: "llm",
      model_used: "claude-haiku",
      generated_at: "2026-05-14T00:00:00+00:00",
    },
    emergent: {
      pattern: "tdd",
      recent_share: 0.4,
      older_share: 0.2,
      delta_pp: 20,
      recent_window_days: 30,
      baseline_window_days: 180,
    },
    // Schema v5 — insights bullets embedded in signed bytes.
    insights: {
      insights: [
        "Prompts curtos detectados — adicionar contexto de arquivo melhora as respostas",
        "Baixa cobertura de testes — oportunidade de crescimento com TDD",
      ],
      generated_at: "2026-05-14T00:00:00+00:00",
    },
  };
}

// Bundle schema v6 (R1.1) — see comment in models.py / types.ts. Regenerate via
// the engine's payload_to_canonical + payload_hash if the fixture changes:
//   cd packages/engine && PYTHONPATH=src python3 -c "from tests.test_bundle \
//     import _fixture_payload; from bundle import payload_to_canonical, \
//     payload_hash; p=_fixture_payload(); print(payload_to_canonical(p)); \
//     print(payload_hash(p))"
const EXPECTED_CANONICAL =
  '{"beheld_version":"0.2.0",' +
  '"core":{"avg_test_ratio":0.42,' +
  '"earliest_commit":"2023-01-01T00:00:00+00:00",' +
  '"ecosystems":{"python":true,"rails":true},' +
  '"latest_commit":"2026-05-13T00:00:00+00:00",' +
  '"platforms":{"docker":true,"github":true},' +
  '"root_commit_hashes":[' +
  '{"first_seen_at":"2026-04-01T00:00:00+00:00","hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},' +
  '{"first_seen_at":"2026-04-15T00:00:00+00:00","hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}' +
  '],' +
  '"total_commits":1200,"total_repos":2},' +
  '"created_at":"2026-05-14T00:00:00+00:00",' +
  '"emergent":{"baseline_window_days":180,"delta_pp":20,"older_share":0.2,' +
  '"pattern":"tdd","recent_share":0.4,"recent_window_days":30},' +
  '"engine_version_hash":"0000000000000000000000000000000000000000000000000000000000000000",' +
  '"enrichment":{"ecosystems":{"rails":8,"react":4},' +
  '"harness_sources":[{"capture_fidelity":"native_hook","harness":"claude_code","sessions":30}],' +
  '"period_days":30,' +
  '"platforms":{"docker":10,"github":5},"project_categories":{"saas_b2b":1},' +
  '"sessions_analyzed":30,' +
  '"workflow_distribution":{"tdd":0.2,"test-after":0.6},' +
  '"workflow_metrics":{"bash_to_read_ratio":0,"ecosystem_concentration":0,' +
  '"edit_to_test_lag_min":0,"median_test_delay_min":0,' +
  '"prompt_avg_chars":0,"prompt_median_chars":0,' +
  '"session_avg_duration_min":0,"test_after_ratio":0.6,' +
  '"test_first_ratio":0,"tool_variety_avg":0}},' +
  '"identity":{"confidence":"medium","generated_at":"2026-05-14T00:00:00+00:00",' +
  '"generation_path":"llm","identity_long":"Dev Ruby/Python com hábito test-after.",' +
  '"identity_short":"Dev Ruby/Python.","model_used":"claude-haiku"},' +
  '"insights":{"generated_at":"2026-05-14T00:00:00+00:00",' +
  '"insights":["Prompts curtos detectados — adicionar contexto de arquivo melhora as respostas",' +
  '"Baixa cobertura de testes — oportunidade de crescimento com TDD"]},' +
  '"previous_hash":null,' +
  '"scores":{"date":"2026-05-13","growth_rate":30,"overall":35,' +
  '"prompt_quality":50,"sessions_analyzed":30,"tech_breadth":40,' +
  '"test_maturity":20},' +
  '"signals":{"ecosystems":{"dominant":["rails"],"secondary":[]},' +
  '"schema_version":"1",' +
  '"test_pattern":{"approach":"test-after","discipline":"moderate"},' +
  '"timing":{"consistency":"regular","peak_period":"morning"},' +
  '"tooling":{"platforms":["docker","github"]}},' +
  '"stack":{"architecture_patterns":[{"confidence":"strong","pattern":"mvc","repo_count":1}],' +
  '"language_distribution":[' +
  '{"commit_count":100,"file_count":200,"first_seen":"2024-01","language":"Ruby",' +
  '"last_seen":"2026-05","weight_pct":60},' +
  '{"commit_count":50,"file_count":80,"first_seen":"2025-01","language":"Python",' +
  '"last_seen":"2025-12","weight_pct":40}],' +
  '"repos_analyzed":2,"total_commits_analyzed":150}}';

const EXPECTED_HASH =
  "sha256:3cd9ef34f20a9e1abf6dc3de2bc43bfe909d7ac29d21975cd69c931c177a5985";

// ── canonical_json basics ────────────────────────────────────────────────────

describe("canonicalJson — primitives", () => {
  test("BUNDLE_VERSION is the current wire schema string", () => {
    // R1.2c — current wire is v7 (Optional scores in canonical). v6/v5/v1
    // bundles still verify via the fallback chain in summarizeManifest.
    expect(BUNDLE_VERSION).toBe("7");
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
    expect(actual.length).toBe(2567);
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
    // Build the same fixture with deliberately shuffled key order — must
    // include ALL v6 fields (stack, signals, identity, emergent, insights)
    // or the payloads diverge and the assertion becomes meaningless.
    const base = fixturePayload();
    const shuffled: BundlePayload = {
      emergent: base.emergent,
      enrichment: base.enrichment,
      insights: base.insights,
      identity: base.identity,
      engine_version_hash: base.engine_version_hash,
      core: base.core,
      stack: base.stack,
      scores: base.scores,
      signals: base.signals,
      previous_hash: base.previous_hash,
      beheld_version: base.beheld_version,
      created_at: base.created_at,
    };
    expect(await payloadHash(shuffled)).toBe(await payloadHash(base));
  });
});

// ── attestation wrapper (Phase 5 / F5.6) ──────────────────────────────────────

function fixtureAttestation(): BundleAttestation {
  return {
    payload: {
      type: "beheld-identity-attestation/v1",
      platform_key_id: "beheld-platform-2026-q2",
      dev_pubkey: "ed25519-pub:AAAA",
      github: { user_id: 12345, login: "octocat", verified_at: "2026-05-19T18:00:00Z" },
      attested_at: "2026-05-19T18:00:00Z",
    },
    signature: "ed25519:AAAA",
  };
}

describe("Bundle wrapper — attestation field (Phase 5 / F5.6)", () => {
  test("attestation field is optional on Bundle", () => {
    const bundle: Bundle = {
      version: BUNDLE_VERSION,
      payload: fixturePayload(),
      hash: "sha256:dead",
      signature: "ed25519:dead",
      public_key: "ed25519:beef",
    };
    expect(bundle.attestation).toBeUndefined();
  });

  test("adding attestation at wrapper does NOT change payload hash", async () => {
    const payload = fixturePayload();
    const hashWithout = await payloadHash(payload);
    const bundle: Bundle = {
      version: BUNDLE_VERSION,
      payload,
      hash: hashWithout,
      signature: "ed25519:dead",
      public_key: "ed25519:beef",
      attestation: fixtureAttestation(),
    };
    expect(await payloadHash(bundle.payload)).toBe(hashWithout);
  });

  test("attestation survives canonicalization of full bundle wrapper", () => {
    const bundle: Bundle = {
      version: BUNDLE_VERSION,
      payload: fixturePayload(),
      hash: "sha256:dead",
      signature: "ed25519:dead",
      public_key: "ed25519:beef",
      attestation: fixtureAttestation(),
    };
    const out = JSON.parse(canonicalJson(bundle));
    expect(out.attestation.payload.github.login).toBe("octocat");
    expect(out.attestation.signature).toBe("ed25519:AAAA");
  });
});

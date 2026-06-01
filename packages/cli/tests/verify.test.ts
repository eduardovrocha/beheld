import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { payloadHash, payloadToCanonical } from "../src/bundle/canonical";
import {
  summarize,
  summarizeManifest,
  verifyBundle,
  verifyChain,
  type BundleResolver,
} from "../src/bundle/verify";
import { BUNDLE_VERSION, type Bundle, type BundlePayload } from "../src/bundle/types";
import {
  ensureKeys,
  loadPrivateKey,
  loadPublicJwk,
} from "../src/keys/keystore";

let workDir: string;
let savedEnv: string | undefined;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "beheld-verify-"));
  savedEnv = process.env.BEHELD_DATA_DIR;
  process.env.BEHELD_DATA_DIR = workDir;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.BEHELD_DATA_DIR;
  else process.env.BEHELD_DATA_DIR = savedEnv;
  rmSync(workDir, { recursive: true, force: true });
});

function fixturePayload(previousHash: string | null = null): BundlePayload {
  return {
    created_at: "2026-05-14T03:00:00+00:00",
    beheld_version: "0.2.0",
    previous_hash: previousHash,
    scores: {
      date: "2026-05-13",
      prompt_quality: 50, test_maturity: 20, tech_breadth: 40,
      growth_rate: 30, overall: 35, sessions_analyzed: 30,
    },
    l1: {
      total_repos: 0,
      total_commits: 0,
      earliest_commit: null,
      latest_commit: null,
      ecosystems: {},
      platforms: {},
      avg_test_ratio: 0,
      root_commit_hashes: [],
    },
    l2: {
      platforms: { docker: 10 },
      ecosystems: { rails: 8 },
      workflow_distribution: { tdd: 0.2 },
      project_categories: { saas_b2b: 1.0 },
      workflow_metrics: {
        test_after_ratio: 0.6, test_first_ratio: 0,
        median_test_delay_min: 0, edit_to_test_lag_min: 0,
        bash_to_read_ratio: 0, prompt_avg_chars: 0,
        prompt_median_chars: 0, session_avg_duration_min: 0,
        tool_variety_avg: 0, ecosystem_concentration: 0,
      },
      sessions_analyzed: 30,
      period_days: 30,
    },
  };
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Sign a payload with the keystore's current key and return a valid Bundle. */
async function buildValidBundle(payload: BundlePayload): Promise<Bundle> {
  await ensureKeys();
  const canonical = payloadToCanonical(payload);
  const hash = await payloadHash(payload);
  const priv = await loadPrivateKey();
  const sigBuf = await crypto.subtle.sign(
    { name: "Ed25519" },
    priv,
    new TextEncoder().encode(canonical),
  );
  const pub = loadPublicJwk();
  return {
    version: BUNDLE_VERSION,
    payload,
    hash,
    signature: `ed25519:${toHex(sigBuf)}`,
    public_key: `ed25519:${pub.x}`,
  };
}

// ── schema validation ──────────────────────────────────────────────────────

describe("verifyBundle — schema validation", () => {
  test("rejects non-object input", async () => {
    const result = await verifyBundle("not an object");
    expect(result.ok).toBe(false);
    expect(result.checks.schema.ok).toBe(false);
  });

  test("rejects missing top-level fields", async () => {
    const result = await verifyBundle({ version: "1" });
    expect(result.checks.schema.ok).toBe(false);
  });

  test("rejects malformed hash", async () => {
    const bundle = await buildValidBundle(fixturePayload());
    const result = await verifyBundle({ ...bundle, hash: "not-a-hash" });
    expect(result.checks.schema.ok).toBe(false);
    expect(result.checks.schema.reason).toContain("hash");
  });

  test("rejects malformed signature", async () => {
    const bundle = await buildValidBundle(fixturePayload());
    const result = await verifyBundle({ ...bundle, signature: "garbage" });
    expect(result.checks.schema.ok).toBe(false);
    expect(result.checks.schema.reason).toContain("signature");
  });

  test("rejects malformed public_key", async () => {
    const bundle = await buildValidBundle(fixturePayload());
    const result = await verifyBundle({ ...bundle, public_key: "rsa:abc" });
    expect(result.checks.schema.ok).toBe(false);
  });

  test("rejects payload missing 'scores'", async () => {
    const bundle = await buildValidBundle(fixturePayload());
    const { scores: _scores, ...withoutScores } = bundle.payload;
    const result = await verifyBundle({ ...bundle, payload: withoutScores });
    expect(result.checks.schema.ok).toBe(false);
    expect(result.checks.schema.reason).toContain("scores");
  });
});

// ── happy path ──────────────────────────────────────────────────────────────

describe("verifyBundle — happy path", () => {
  test("a freshly built bundle verifies", async () => {
    const bundle = await buildValidBundle(fixturePayload());
    const result = await verifyBundle(bundle);
    expect(result.ok).toBe(true);
    expect(result.checks.schema.ok).toBe(true);
    expect(result.checks.hash.ok).toBe(true);
    expect(result.checks.signature.ok).toBe(true);
  });

  test("summarize() reports score + sessions + created_at date", () => {
    const out = summarize(fixturePayload());
    expect(out).toContain("score 35/100");
    expect(out).toContain("30 sessões");
    expect(out).toContain("2026-05-14"); // from payload.created_at
  });
});

// ── adversarial: F5.3.9 ────────────────────────────────────────────────────

describe("verifyBundle — tampering detection (F5.3.9)", () => {
  test("altered payload field without rehashing → hash check fails", async () => {
    const bundle = await buildValidBundle(fixturePayload());
    const tampered: Bundle = {
      ...bundle,
      payload: {
        ...bundle.payload,
        scores: { ...bundle.payload.scores, overall: 100 }, // pump the score
      },
    };
    const result = await verifyBundle(tampered);
    expect(result.checks.hash.ok).toBe(false);
    expect(result.ok).toBe(false);
  });

  test("altered hash field (rehash claimed but payload unchanged) → signature fails", async () => {
    const bundle = await buildValidBundle(fixturePayload());
    // Replace hash with a different-but-valid-format string — sig also won't match
    const fakeHash = "sha256:" + "a".repeat(64);
    const tampered = { ...bundle, hash: fakeHash };
    const result = await verifyBundle(tampered);
    // hash check fails because recomputed != claimed
    expect(result.checks.hash.ok).toBe(false);
  });

  test("swapped public_key (attacker replaces with own) → signature fails", async () => {
    const bundle = await buildValidBundle(fixturePayload());
    // Generate an unrelated key and swap pubkey only
    const otherPair = await crypto.subtle.generateKey(
      { name: "Ed25519" }, true, ["sign", "verify"],
    );
    const otherJwk = await crypto.subtle.exportKey("jwk", otherPair.publicKey);
    const tampered: Bundle = { ...bundle, public_key: `ed25519:${otherJwk.x}` };
    const result = await verifyBundle(tampered);
    expect(result.checks.signature.ok).toBe(false);
  });

  test("forged signature (random hex) → signature fails", async () => {
    const bundle = await buildValidBundle(fixturePayload());
    const forged = "ed25519:" + "ff".repeat(64);
    const tampered = { ...bundle, signature: forged };
    const result = await verifyBundle(tampered);
    expect(result.checks.signature.ok).toBe(false);
  });

  test("attacker re-signs altered payload with their own key → still fails (pubkey not user's)", async () => {
    // Original user's bundle
    const original = await buildValidBundle(fixturePayload());

    // Attacker generates their own keypair, signs a modified payload
    const attackerPair = await crypto.subtle.generateKey(
      { name: "Ed25519" }, true, ["sign", "verify"],
    );
    const attackerPubJwk = await crypto.subtle.exportKey("jwk", attackerPair.publicKey);

    const evilPayload: BundlePayload = {
      ...original.payload,
      scores: { ...original.payload.scores, overall: 100 },
    };
    const evilCanonical = payloadToCanonical(evilPayload);
    const evilHash = await payloadHash(evilPayload);
    const evilSig = await crypto.subtle.sign(
      { name: "Ed25519" },
      attackerPair.privateKey,
      new TextEncoder().encode(evilCanonical),
    );
    // The attacker swaps in their pubkey AND signature. Internally consistent.
    const evilBundle: Bundle = {
      version: original.version,
      payload: evilPayload,
      hash: evilHash,
      signature: `ed25519:${toHex(evilSig)}`,
      public_key: `ed25519:${attackerPubJwk.x}`,
    };

    // The bundle itself "verifies" by its own pubkey — that's by design.
    // Detection happens upstream: verifiers compare the bundle's public_key
    // against the expected user's key (trust anchor) — out of scope for this
    // pure check. Document this explicitly:
    const result = await verifyBundle(evilBundle);
    expect(result.ok).toBe(true);
    // …but pubkey is different from the original — caller must compare.
    expect(evilBundle.public_key).not.toBe(original.public_key);
  });
});

// ── chain verification (F5.2.5 / F5.3.8 --chain) ────────────────────────────

describe("verifyChain", () => {
  async function buildChain(n: number): Promise<Bundle[]> {
    const bundles: Bundle[] = [];
    let prevHash: string | null = null;
    for (let i = 0; i < n; i++) {
      const payload: BundlePayload = {
        ...fixturePayload(prevHash),
        created_at: `2026-05-14T0${i}:00:00+00:00`,
      };
      const b = await buildValidBundle(payload);
      bundles.push(b);
      prevHash = b.hash;
    }
    return bundles;
  }

  function resolverFor(bundles: Bundle[]): BundleResolver {
    const map = new Map(bundles.map((b) => [b.hash, b]));
    return async (hash: string) => map.get(hash) ?? null;
  }

  test("genesis bundle (previous_hash=null) returns ok with 0 links", async () => {
    const [genesis] = await buildChain(1);
    const result = await verifyChain(genesis, resolverFor([genesis]));
    expect(result.ok).toBe(true);
    expect(result.links_verified).toBe(0);
  });

  test("walks all links of a valid 3-chain", async () => {
    const chain = await buildChain(3);
    const tail = chain[chain.length - 1];
    const result = await verifyChain(tail, resolverFor(chain));
    expect(result.ok).toBe(true);
    expect(result.links_verified).toBe(2);
  });

  test("fails when a previous bundle is missing from the resolver", async () => {
    const chain = await buildChain(3);
    const tail = chain[chain.length - 1];
    // Resolver only knows the genesis and the tail — middle is missing
    const partial = resolverFor([chain[0], tail]);
    const result = await verifyChain(tail, partial);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not found");
  });

  test("fails when an intermediate bundle has been tampered with", async () => {
    const chain = await buildChain(3);
    // Tamper middle bundle's payload (without re-hashing)
    const middle = chain[1];
    const tamperedMiddle: Bundle = {
      ...middle,
      payload: {
        ...middle.payload,
        scores: { ...middle.payload.scores, overall: 99 },
      },
    };
    const tail = chain[chain.length - 1];
    // The resolver maps the middle hash to a tampered bundle.
    const map = new Map(chain.map((b) => [b.hash, b]));
    map.set(middle.hash, tamperedMiddle);
    const resolver: BundleResolver = async (h) => map.get(h) ?? null;

    const result = await verifyChain(tail, resolver);
    expect(result.ok).toBe(false);
  });

  test("fails when resolver returns a bundle with a hash that doesn't match the link", async () => {
    const chain = await buildChain(2);
    const tail = chain[1];
    // Resolver returns the WRONG bundle for the requested hash
    const wrongBundle = await buildValidBundle({
      ...fixturePayload(),
      created_at: "2026-05-14T99:00:00+00:00",
    });
    const resolver: BundleResolver = async () => wrongBundle;
    const result = await verifyChain(tail, resolver);
    expect(result.ok).toBe(false);
  });
});

// ── command path: read file and report ──────────────────────────────────────

describe("verifyCommand — file I/O", () => {
  async function writeBundle(bundle: Bundle): Promise<string> {
    const file = join(workDir, "test.beheld");
    writeFileSync(file, JSON.stringify(bundle, null, 2));
    return file;
  }

  test("verifyCommand exits 1 on tampered file (smoke through command path)", async () => {
    const bundle = await buildValidBundle(fixturePayload());
    const tampered = {
      ...bundle,
      payload: { ...bundle.payload, scores: { ...bundle.payload.scores, overall: 99 } },
    };
    const file = await writeBundle(tampered as Bundle);

    const { verifyCommand } = await import("../src/commands/verify?v=verify-cmd1");
    let exitCode: number | null = null;
    const realExit = process.exit;
    process.exit = ((code?: number) => {
      exitCode = code ?? 0;
      throw new Error("EXIT");
    }) as typeof process.exit;
    const realLog = console.log;
    console.log = () => {};
    try {
      await verifyCommand(file);
    } catch (e) {
      expect((e as Error).message).toBe("EXIT");
    } finally {
      process.exit = realExit;
      console.log = realLog;
    }
    expect(exitCode).toBe(1);
  });

  test("verifyCommand prints checkmarks for a valid file", async () => {
    const bundle = await buildValidBundle(fixturePayload());
    const file = await writeBundle(bundle);

    const { verifyCommand } = await import("../src/commands/verify?v=verify-cmd2");
    const logs: string[] = [];
    const realLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
    try {
      await verifyCommand(file);
    } finally {
      console.log = realLog;
    }
    const out = logs.join("\n");
    // ANSI-stripped checks
    expect(out.replace(/\x1b\[[0-9;]*m/g, "")).toContain("✓ schema");
    expect(out.replace(/\x1b\[[0-9;]*m/g, "")).toContain("✓ hash");
    expect(out.replace(/\x1b\[[0-9;]*m/g, "")).toContain("✓ signature");
    expect(out).toContain("score 35/100");
  });
});

// ── F6.8: L1 / L2 validation in verifyBundle ────────────────────────────────

describe("verifyBundle — L1 / L2 sections (F6.8)", () => {
  test("reports L1 ok with repo_count when present", async () => {
    const payload = fixturePayload();
    payload.l1 = {
      total_repos: 7,
      total_commits: 42,
      earliest_commit: null,
      latest_commit: null,
      ecosystems: {},
      platforms: {},
      avg_test_ratio: 0,
      root_commit_hashes: [],
    };
    const bundle = await buildValidBundle(payload);
    const result = await verifyBundle(bundle);
    expect(result.checks.l1_section.ok).toBe(true);
    expect(result.checks.l1_section.repo_count).toBe(7);
    expect(result.checks.l2_section.ok).toBe(true);
    expect(result.checks.l2_section.session_count).toBe(30);
  });

  test("warns (does not fail) when L1 section is absent", async () => {
    // Build a v1-style payload manually (omit l1, use legacy `signals` key).
    const v1Payload = {
      created_at: "2026-05-14T03:00:00+00:00",
      beheld_version: "0.2.0",
      previous_hash: null,
      scores: {
        date: "2026-05-13",
        prompt_quality: 50, test_maturity: 20, tech_breadth: 40,
        growth_rate: 30, overall: 35, sessions_analyzed: 30,
      },
      signals: {
        platforms: {}, ecosystems: {}, workflow_distribution: {},
        project_categories: {},
        workflow_metrics: {
          test_after_ratio: 0, test_first_ratio: 0,
          median_test_delay_min: 0, edit_to_test_lag_min: 0,
          bash_to_read_ratio: 0, prompt_avg_chars: 0,
          prompt_median_chars: 0, session_avg_duration_min: 0,
          tool_variety_avg: 0, ecosystem_concentration: 0,
        },
        sessions_analyzed: 30, period_days: 30,
      },
    };
    const bundle = await buildValidBundle(v1Payload as unknown as BundlePayload);
    const result = await verifyBundle(bundle);
    expect(result.ok).toBe(true);
    expect(result.checks.l1_section.ok).toBe(false);
    // R1.1 — warning message says "Seção core ausente" (was "Seção L1 ausente").
    expect(result.warnings.some((w) => w.includes("core ausente"))).toBe(true);
    // L2 still parses via the legacy `signals` key.
    expect(result.checks.l2_section.ok).toBe(true);
    expect(result.checks.l2_section.session_count).toBe(30);
  });

  test("verifyCommand surfaces ⚠ L1 line when section is missing", async () => {
    const v1Payload = {
      created_at: "2026-05-14T03:00:00+00:00",
      beheld_version: "0.2.0",
      previous_hash: null,
      scores: {
        date: "2026-05-13",
        prompt_quality: 50, test_maturity: 20, tech_breadth: 40,
        growth_rate: 30, overall: 35, sessions_analyzed: 30,
      },
      signals: {
        platforms: {}, ecosystems: {}, workflow_distribution: {},
        project_categories: {},
        workflow_metrics: {
          test_after_ratio: 0, test_first_ratio: 0,
          median_test_delay_min: 0, edit_to_test_lag_min: 0,
          bash_to_read_ratio: 0, prompt_avg_chars: 0,
          prompt_median_chars: 0, session_avg_duration_min: 0,
          tool_variety_avg: 0, ecosystem_concentration: 0,
        },
        sessions_analyzed: 30, period_days: 30,
      },
    };
    const bundle = await buildValidBundle(v1Payload as unknown as BundlePayload);
    const file = join(workDir, "v1.beheld");
    writeFileSync(file, JSON.stringify(bundle, null, 2));

    const { verifyCommand } = await import("../src/commands/verify?v=verify-cmd-l1");
    const logs: string[] = [];
    const realLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
    try {
      await verifyCommand(file);
    } finally {
      console.log = realLog;
    }
    const out = logs.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    // R1.1 — surface label is now "core" (was "L1") and reason mentions core.
    expect(out).toContain("⚠ core");
    expect(out).toContain("Seção core ausente");
  });
});

// ── R1.1 §3.3 — manifest (schema + sections + capture_fidelity per source) ───

describe("summarizeManifest — pure detection", () => {
  test("v7 full bundle: schema=v7, sections=[core, enrichment], harness_sources extracted", () => {
    const bundle = {
      version: "7",
      payload: {
        core: { total_repos: 1 },
        enrichment: {
          harness_sources: [
            { harness: "claude_code", capture_fidelity: "native_hook", sessions: 30 },
            { harness: "cursor", capture_fidelity: "local_log_tail", sessions: 12 },
          ],
          sessions_analyzed: 42,
        },
      },
    };
    const m = summarizeManifest(bundle);
    expect(m.schema).toBe("v7");
    expect(m.schemaLabel).toBe("v7");
    expect(m.sections).toEqual(["core", "enrichment"]);
    expect(m.harnessSources).toHaveLength(2);
    expect(m.harnessSources[0]).toEqual({
      harness: "claude_code",
      capture_fidelity: "native_hook",
      sessions: 30,
    });
    expect(m.harnessSources[1]?.capture_fidelity).toBe("local_log_tail");
  });

  test("v7 core-only bundle: schema=v7, sections=[core], no harness_sources", () => {
    const bundle = {
      version: "7",
      payload: {
        core: { total_repos: 3 },
      },
    };
    const m = summarizeManifest(bundle);
    expect(m.schema).toBe("v7");
    expect(m.sections).toEqual(["core"]);
    expect(m.harnessSources).toEqual([]);
  });

  test("v6 legacy bundle: schema=v6_legacy, payload shape identical, label flagged as legacy", () => {
    // R1.2c — v6 bundles still verify but are marked legacy because v7
    // is the current wire (scores can be null). v6 and v7 share the
    // same payload shape (core/enrichment) — only bundle.version differs.
    const bundle = {
      version: "6",
      payload: {
        core: { total_repos: 1 },
        enrichment: {
          harness_sources: [
            { harness: "claude_code", capture_fidelity: "native_hook", sessions: 30 },
          ],
        },
      },
    };
    const m = summarizeManifest(bundle);
    expect(m.schema).toBe("v6_legacy");
    expect(m.schemaLabel).toBe("v6 (legacy)");
    expect(m.sections).toEqual(["core", "enrichment"]);
    expect(m.harnessSources).toHaveLength(1);
  });

  test("v5 legacy bundle: schema=v5_legacy, sections=[l1, l2], no harness_sources", () => {
    const bundle = {
      version: "5",
      payload: {
        l1: { total_repos: 1 },
        l2: { sessions_analyzed: 10 },
      },
    };
    const m = summarizeManifest(bundle);
    expect(m.schema).toBe("v5_legacy");
    expect(m.schemaLabel).toBe("v5 (legacy)");
    expect(m.sections).toEqual(["l1", "l2"]);
    expect(m.harnessSources).toEqual([]);
  });

  test("v1 legacy bundle: schema=v1_legacy, sections=[signals]", () => {
    const bundle = {
      version: "1",
      payload: {
        signals: { sessions_analyzed: 5 },
      },
    };
    const m = summarizeManifest(bundle);
    expect(m.schema).toBe("v1_legacy");
    expect(m.schemaLabel).toBe("v1 (legacy)");
    expect(m.sections).toEqual(["signals"]);
  });

  test("unknown shape: schema=unknown, empty sections, never throws", () => {
    const m = summarizeManifest({ version: "?", payload: { mystery: 1 } });
    expect(m.schema).toBe("unknown");
    expect(m.sections).toEqual([]);
    expect(m.harnessSources).toEqual([]);
  });

  test("malformed harness_sources entries are filtered out (not crash)", () => {
    const bundle = {
      version: "7",
      payload: {
        core: {},
        enrichment: {
          harness_sources: [
            { harness: "claude_code", capture_fidelity: "native_hook", sessions: 30 },
            null,
            { harness: "broken" /* missing fields */ },
            { harness: "cursor", capture_fidelity: "local_log_tail", sessions: 12 },
          ],
        },
      },
    };
    const m = summarizeManifest(bundle);
    expect(m.harnessSources).toHaveLength(2);
    expect(m.harnessSources.map((s) => s.harness)).toEqual(["claude_code", "cursor"]);
  });

  test("R1.2c — bundle.version='7' is authoritative even when payload shape is core/enrichment", () => {
    // Cross-check: with bundle.version="7", schema MUST be v7 (current),
    // not v6_legacy. The version field is the discriminator between v6
    // and v7 since payload shape is identical.
    const v7 = { version: "7", payload: { core: {} } };
    expect(summarizeManifest(v7).schema).toBe("v7");

    // Conversely, version="6" with same payload → v6_legacy.
    const v6 = { version: "6", payload: { core: {} } };
    expect(summarizeManifest(v6).schema).toBe("v6_legacy");
  });

  test("R1.2c — payload-only fallback (no bundle.version) treats core+enrichment as v6_legacy", () => {
    // Defensive: when a caller passes only a payload-shaped record without
    // bundle.version, we fall back to shape-based detection. The most
    // permissive current schema with that shape is v6_legacy (v7 requires
    // the explicit version label).
    const m = summarizeManifest({ payload: { core: {} } });
    expect(m.schema).toBe("v6_legacy");
  });
});

describe("manifest matches the on-disk fixtures", () => {
  const FIXTURES = join(import.meta.dir, "fixtures");

  test("bundle_v7_full.json: v7 + core+enrichment + claude_code/native_hook (current schema)", () => {
    const bundle = JSON.parse(readFileSync(join(FIXTURES, "bundle_v7_full.json"), "utf8"));
    const m = summarizeManifest(bundle);
    expect(m.schema).toBe("v7");
    expect(m.sections).toEqual(["core", "enrichment"]);
    expect(m.harnessSources).toEqual([
      { harness: "claude_code", capture_fidelity: "native_hook", sessions: 42 },
    ]);
  });

  test("bundle_v7_core_only.json: v7 + only core + zero harness_sources + null scores", () => {
    const bundle = JSON.parse(readFileSync(join(FIXTURES, "bundle_v7_core_only.json"), "utf8"));
    const m = summarizeManifest(bundle);
    expect(m.schema).toBe("v7");
    expect(m.sections).toEqual(["core"]);
    expect(m.harnessSources).toEqual([]);
    // R1.2c — scores carry null for absent dimensions.
    expect(bundle.payload.scores.prompt_quality).toBeNull();
    expect(bundle.payload.scores.growth_rate).toBeNull();
    expect(bundle.payload.scores.overall).toBeNull();
    // test_maturity / tech_breadth keep numeric values.
    expect(typeof bundle.payload.scores.test_maturity).toBe("number");
    expect(typeof bundle.payload.scores.tech_breadth).toBe("number");
  });

  test("bundle_v6_full.json: v6_legacy + core+enrichment (read-only fallback)", () => {
    const bundle = JSON.parse(readFileSync(join(FIXTURES, "bundle_v6_full.json"), "utf8"));
    const m = summarizeManifest(bundle);
    expect(m.schema).toBe("v6_legacy");
    expect(m.sections).toEqual(["core", "enrichment"]);
    expect(m.harnessSources).toEqual([
      { harness: "claude_code", capture_fidelity: "native_hook", sessions: 30 },
    ]);
  });

  test("bundle_v6_core_only.json: v6_legacy + only core + zero harness_sources", () => {
    const bundle = JSON.parse(readFileSync(join(FIXTURES, "bundle_v6_core_only.json"), "utf8"));
    const m = summarizeManifest(bundle);
    expect(m.schema).toBe("v6_legacy");
    expect(m.sections).toEqual(["core"]);
    expect(m.harnessSources).toEqual([]);
  });

  test("bundle_v5_legacy.json: v5_legacy + l1+l2 + no harness_sources", () => {
    const bundle = JSON.parse(readFileSync(join(FIXTURES, "bundle_v5_legacy.json"), "utf8"));
    const m = summarizeManifest(bundle);
    expect(m.schema).toBe("v5_legacy");
    expect(m.sections).toEqual(["l1", "l2"]);
    expect(m.harnessSources).toEqual([]);
  });
});

// NOTA: testes E2E do verifyCommand não estão aqui porque o comando tem
// process.exit nos paths de erro, o que mata o runner. A função pura
// summarizeManifest é coberta pelos 6 testes acima + 3 fixture-load tests.
// O wiring do print de manifest é mecânico (3 console.log lines em
// commands/verify.ts) e validado por inspeção manual rodando
// `beheld verify <fixture>.beheld`.

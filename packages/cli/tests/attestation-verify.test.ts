import { describe, expect, test } from "bun:test";

import { canonicalJson } from "../src/bundle/canonical";
import { verifyAttestation } from "../src/bundle/attestation-verify";
import type {
  Bundle,
  BundleAttestation,
  BundlePayload,
} from "../src/bundle/types";
import type { PlatformKey as EmbeddedPlatformKey } from "../src/keys/platform-keys";

// ── helpers ───────────────────────────────────────────────────────────────────

function fixturePayload(): BundlePayload {
  return {
    created_at: "2026-05-14T03:00:00+00:00",
    beheld_version: "0.3.0",
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
      platforms: {},
      ecosystems: {},
      workflow_distribution: {},
      project_categories: {},
      workflow_metrics: {
        test_after_ratio: 0,
        test_first_ratio: 0,
        median_test_delay_min: 0,
        edit_to_test_lag_min: 0,
        bash_to_read_ratio: 0,
        prompt_avg_chars: 0,
        prompt_median_chars: 0,
        session_avg_duration_min: 0,
        tool_variety_avg: 0,
        ecosystem_concentration: 0,
      },
      sessions_analyzed: 0,
      period_days: 0,
    },
  };
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function bytesToB64Url(bytes: Uint8Array): string {
  return bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface TestKey {
  privateKey: CryptoKey;
  pubB64Std: string;     // for embedded key fixture (ed25519-pub:<std>)
  pubB64Url: string;     // for bundle.public_key (ed25519:<url>)
  rawPub: Uint8Array;
}

async function makeTestPlatformKey(): Promise<TestKey> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const x = jwk.x!;
  const std = x.replace(/-/g, "+").replace(/_/g, "/");
  const stdB64 = std + "=".repeat((4 - (std.length % 4)) % 4);
  // Decode to raw bytes for symmetric reuse
  const rawPub = Uint8Array.from(atob(stdB64), (c) => c.charCodeAt(0));
  return { privateKey: kp.privateKey, pubB64Std: stdB64, pubB64Url: x, rawPub };
}

async function signWith(privateKey: CryptoKey, payload: object): Promise<string> {
  const canonical = new TextEncoder().encode(canonicalJson(payload));
  const sigBuf = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, canonical);
  return bytesToB64(new Uint8Array(sigBuf));
}

function embedded(
  key: TestKey,
  opts: Partial<EmbeddedPlatformKey> = {},
): EmbeddedPlatformKey {
  return {
    key_id: "test-platform-key",
    algorithm: "ed25519",
    public_key: `ed25519-pub:${key.pubB64Std}`,
    active: true,
    revoked: false,
    created_at: "2026-01-01T00:00:00Z",
    rotated_at: null,
    revoked_at: null,
    revoked_reason: null,
    ...opts,
  };
}

async function buildSignedBundle(
  platformKey: TestKey,
  embeddedKey: EmbeddedPlatformKey,
  opts: { devKey?: TestKey; tamperPayload?: boolean; mismatchedDevPubkey?: boolean } = {},
): Promise<Bundle> {
  const devKey = opts.devKey ?? (await makeTestPlatformKey());
  const devPubB64 = opts.mismatchedDevPubkey
    ? bytesToB64(new Uint8Array(32).fill(0xff))
    : devKey.pubB64Std;
  const payload = {
    type: "beheld-identity-attestation/v1",
    platform_key_id: embeddedKey.key_id,
    dev_pubkey: `ed25519-pub:${devPubB64}`,
    github: {
      user_id: 12345,
      login: "octocat",
      verified_at: "2026-05-19T18:00:00Z",
    },
    attested_at: "2026-05-19T18:00:00Z",
  };
  const sigB64 = await signWith(platformKey.privateKey, payload);

  // Optionally tamper after signing
  const finalPayload = opts.tamperPayload
    ? { ...payload, github: { ...payload.github, login: "evil" } }
    : payload;

  const attestation: BundleAttestation = {
    payload: finalPayload,
    signature: `ed25519:${sigB64}`,
  };
  return {
    version: "3",
    payload: fixturePayload(),
    hash: "sha256:0000",
    signature: "ed25519:0000",
    public_key: `ed25519:${devKey.pubB64Url}`,
    attestation,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("verifyAttestation", () => {
  test("retorna present=false quando bundle não tem attestation", async () => {
    const bundle: Bundle = {
      version: "3",
      payload: fixturePayload(),
      hash: "sha256:0",
      signature: "ed25519:0",
      public_key: "ed25519:AAAA",
    };
    const result = await verifyAttestation(bundle, []);
    expect(result.present).toBe(false);
    expect(result.signature_valid).toBe(false);
  });

  test("attestation legítima → present + payload_valid + signature_valid + key_status=active + dev_pubkey_matches", async () => {
    const k = await makeTestPlatformKey();
    const emb = embedded(k);
    const bundle = await buildSignedBundle(k, emb);

    const result = await verifyAttestation(bundle, [emb]);
    expect(result.present).toBe(true);
    expect(result.payload_valid).toBe(true);
    expect(result.signature_valid).toBe(true);
    expect(result.key_status).toBe("active");
    expect(result.dev_pubkey_matches).toBe(true);
    expect(result.github).toEqual({ user_id: 12345, login: "octocat" });
    expect(result.platform_key_id).toBe("test-platform-key");
  });

  test("signature_valid=false quando payload foi adulterado pós-assinatura", async () => {
    const k = await makeTestPlatformKey();
    const emb = embedded(k);
    const bundle = await buildSignedBundle(k, emb, { tamperPayload: true });

    const result = await verifyAttestation(bundle, [emb]);
    expect(result.payload_valid).toBe(true);
    expect(result.signature_valid).toBe(false);
    expect(result.reason).toContain("does not match");
  });

  test("dev_pubkey_matches=false quando attestation referencia outro dev_pubkey", async () => {
    const k = await makeTestPlatformKey();
    const emb = embedded(k);
    const bundle = await buildSignedBundle(k, emb, { mismatchedDevPubkey: true });

    const result = await verifyAttestation(bundle, [emb]);
    expect(result.signature_valid).toBe(true); // signature still valid for the swapped payload
    expect(result.dev_pubkey_matches).toBe(false);
  });

  test("key_status=unknown quando platform_key_id não está nas embedded keys", async () => {
    const k = await makeTestPlatformKey();
    const emb = embedded(k);
    const bundle = await buildSignedBundle(k, emb);

    const result = await verifyAttestation(bundle, []);
    expect(result.present).toBe(true);
    expect(result.payload_valid).toBe(true);
    expect(result.signature_valid).toBe(false);
    expect(result.key_status).toBe("unknown");
    expect(result.reason).toContain("not in embedded keys");
  });

  test("key_status=rotated quando chave está active=false sem revoked", async () => {
    const k = await makeTestPlatformKey();
    const emb = embedded(k, { active: false, revoked: false });
    const bundle = await buildSignedBundle(k, emb);

    const result = await verifyAttestation(bundle, [emb]);
    expect(result.signature_valid).toBe(true);
    expect(result.key_status).toBe("rotated");
  });

  test("key_status=revoked + revoked_reason quando chave está revoked=true", async () => {
    const k = await makeTestPlatformKey();
    const emb = embedded(k, {
      active: false,
      revoked: true,
      revoked_reason: "exposed in CI log",
    });
    const bundle = await buildSignedBundle(k, emb);

    const result = await verifyAttestation(bundle, [emb]);
    expect(result.signature_valid).toBe(true);
    expect(result.key_status).toBe("revoked");
    expect(result.revoked_reason).toBe("exposed in CI log");
  });

  test("payload_valid=false quando type não é o esperado", async () => {
    const k = await makeTestPlatformKey();
    const emb = embedded(k);
    const bundle = await buildSignedBundle(k, emb);
    bundle.attestation!.payload.type = "wrong/type";

    const result = await verifyAttestation(bundle, [emb]);
    expect(result.payload_valid).toBe(false);
    expect(result.reason).toContain("unsupported");
  });

  test("payload_valid=false quando github não tem login", async () => {
    const k = await makeTestPlatformKey();
    const emb = embedded(k);
    const bundle = await buildSignedBundle(k, emb);
    // @ts-expect-error — deliberately removing field
    delete bundle.attestation!.payload.github.login;

    const result = await verifyAttestation(bundle, [emb]);
    expect(result.payload_valid).toBe(false);
    expect(result.reason).toContain("login");
  });

  test("payload_valid=false quando signature está malformada", async () => {
    const k = await makeTestPlatformKey();
    const emb = embedded(k);
    const bundle = await buildSignedBundle(k, emb);
    bundle.attestation!.signature = "not-a-signature";

    const result = await verifyAttestation(bundle, [emb]);
    expect(result.payload_valid).toBe(false);
    expect(result.reason).toContain("signature");
  });
});

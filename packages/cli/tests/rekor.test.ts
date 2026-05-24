/**
 * F5.8 — Sigstore Rekor submission + trust tier derivation.
 *
 * `submitToRekor` is contract-bound to NEVER throw: every failure path
 * resolves to `{ ok: false, reason, detail }` so the CLI can surface an
 * honest message instead of a catch-all "rede indisponível". These tests
 * pin both the wire-format contract (PEM key, SHA-512 hash, hashedrekord
 * shape) and each failure reason.
 *
 * Live integration: set REKOR_LIVE=1 to also hit rekor.sigstore.dev.
 * Skipped by default so PRs don't depend on the public log being up.
 */
import { describe, expect, test } from "bun:test";

import {
  buildHashedRekord,
  ed25519HexToPemB64,
  parseRekorResponse,
  rekorEntryUrl,
  submitToRekor,
} from "../src/lib/rekor";
import { computeTier, type TrustTier } from "../src/lib/tier";
import type { Bundle, RekorEntry } from "../src/bundle/types";

// ── helpers ─────────────────────────────────────────────────────────────────

const HASH_HEX = "a".repeat(128); // SHA-512 = 64 bytes = 128 hex chars
const SIG_HEX = "b".repeat(128);  // Ed25519 = 64 bytes = 128 hex chars
const PUB_HEX = "c".repeat(64);   // Ed25519 pub = 32 bytes = 64 hex chars
const SAMPLE_UUID = "abc123uuid";

function rekorSuccessBody(): unknown {
  return {
    [SAMPLE_UUID]: {
      body: "<base64 body>",
      integratedTime: 1748793600, // 2025-06-01T16:00:00Z
      logIndex: 12345678,
      verification: {
        signedEntryTimestamp: "MEUCIQ==",
        inclusionProof: {
          logIndex: 12345678,
          treeSize: 99,
          rootHash: "deadbeef",
        },
      },
    },
  };
}

function rekorResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeArgs(over: Partial<{ pub: string; hash: string; sig: string }> = {}) {
  return {
    rekorHashHex: over.hash ?? HASH_HEX,
    rekorSignatureHex: over.sig ?? SIG_HEX,
    publicKeyHex: over.pub ?? PUB_HEX,
  };
}

function bareBundle(): Bundle {
  return {
    version: "5",
    payload: {
      created_at: "2026-05-21T00:00:00+00:00",
      beheld_version: "0.1.1",
      previous_hash: null,
      scores: {
        date: "2026-05-21",
        prompt_quality: 10, test_maturity: 10, tech_breadth: 10,
        growth_rate: 10, overall: 10, sessions_analyzed: 1,
      },
      l1: {
        total_repos: 0, total_commits: 0, earliest_commit: null,
        latest_commit: null, ecosystems: {}, platforms: {},
        avg_test_ratio: 0, root_commit_hashes: [],
      },
      l2: {
        platforms: {}, ecosystems: {}, workflow_distribution: {},
        project_categories: {},
        workflow_metrics: {
          test_after_ratio: 0, test_first_ratio: 0,
          median_test_delay_min: 0, edit_to_test_lag_min: 0,
          bash_to_read_ratio: 0, prompt_avg_chars: 0,
          prompt_median_chars: 0, session_avg_duration_min: 0,
          tool_variety_avg: 0, ecosystem_concentration: 0,
        },
        sessions_analyzed: 1, period_days: 30,
      },
      engine_version_hash: null,
    },
    hash: `sha256:${"a".repeat(64)}`,
    signature: `ed25519:${SIG_HEX}`,
    public_key: `ed25519:${"A".repeat(43)}`,
  };
}

function attestationFixture() {
  return {
    payload: {
      type: "beheld-identity-attestation/v1",
      platform_key_id: "beheld-platform-2026-q2",
      dev_pubkey: "ed25519-pub:AAAA",
      github: { user_id: 42, login: "octocat", verified_at: "2026-05-19T18:00:00Z" },
      attested_at: "2026-05-19T18:00:00Z",
    },
    signature: "ed25519:AAAA",
  };
}

const VALID_REKOR: RekorEntry = {
  logIndex: 999,
  uuid: "u-999",
  integratedTime: "2026-05-21T00:00:00.000Z",
  signedEntryTimestamp: "set==",
};

// ── PEM wrapping (the bug that silently broke production) ──────────────────

describe("ed25519HexToPemB64", () => {
  test("wraps a 32-byte raw key in PEM envelope (base64)", () => {
    const pemB64 = ed25519HexToPemB64("00".repeat(32));
    const pem = Buffer.from(pemB64, "base64").toString("utf8");
    expect(pem.startsWith("-----BEGIN PUBLIC KEY-----")).toBe(true);
    expect(pem.includes("-----END PUBLIC KEY-----")).toBe(true);
    // PEM body is base64 of DER SPKI — strip envelope and check length.
    const der = Buffer.from(
      pem.split("-----")[2]!.replace(/\s+/g, ""),
      "base64",
    );
    expect(der.length).toBe(44); // SPKI prefix (12) + raw key (32)
    expect(der.toString("hex").startsWith("302a300506032b6570032100")).toBe(true);
  });

  test("rejects non-32-byte input", () => {
    expect(() => ed25519HexToPemB64("ab")).toThrow();
    expect(() => ed25519HexToPemB64("a".repeat(63))).toThrow();
  });

  test("PEM body line-wraps at 64 chars (RFC 7468)", () => {
    const pem = Buffer.from(
      ed25519HexToPemB64("00".repeat(32)),
      "base64",
    ).toString("utf8");
    const bodyLines = pem
      .split("\n")
      .filter((l) => l && !l.startsWith("-----"));
    for (const line of bodyLines) {
      expect(line.length).toBeLessThanOrEqual(64);
    }
  });
});

describe("buildHashedRekord", () => {
  test("emits the shape Rekor's POST endpoint expects (sha512 + PEM key)", () => {
    const body = buildHashedRekord({
      payloadHashHex: HASH_HEX,
      signatureHex: SIG_HEX,
      publicKeyHex: PUB_HEX,
    }) as {
      kind: string;
      apiVersion: string;
      spec: {
        data: { hash: { algorithm: string; value: string } };
        signature: { content: string; publicKey: { content: string } };
      };
    };
    expect(body.kind).toBe("hashedrekord");
    expect(body.apiVersion).toBe("0.0.1");
    // Rekor's Ed25519 verifier requires sha512 — sha256 is rejected.
    expect(body.spec.data.hash.algorithm).toBe("sha512");
    expect(body.spec.data.hash.value).toBe(HASH_HEX);
    expect(body.spec.signature.content).toBe(
      Buffer.from(SIG_HEX, "hex").toString("base64"),
    );
    // publicKey is PEM-wrapped, not raw DER.
    const pem = Buffer.from(
      body.spec.signature.publicKey.content,
      "base64",
    ).toString("utf8");
    expect(pem.startsWith("-----BEGIN PUBLIC KEY-----")).toBe(true);
  });
});

// ── submitToRekor — discriminated result, one branch per reason ─────────────

describe("submitToRekor", () => {
  test("returns ok=true + entry on HTTP 201 with valid body", async () => {
    const fetchImpl = (async () =>
      rekorResponse(201, rekorSuccessBody())) as typeof fetch;
    const r = await submitToRekor(makeArgs(), { fetchImpl });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entry.logIndex).toBe(12345678);
      expect(r.entry.uuid).toBe(SAMPLE_UUID);
      expect(r.entry.integratedTime).toBe("2025-06-01T16:00:00.000Z");
      expect(r.entry.signedEntryTimestamp).toBe("MEUCIQ==");
    }
  });

  test("reason='network' when fetch throws", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const r = await submitToRekor(makeArgs(), { fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("network");
      expect(r.detail).toContain("ECONNREFUSED");
    }
  });

  test("reason='rejected' on HTTP 400 — surfaces Rekor's error body", async () => {
    const fetchImpl = (async () =>
      rekorResponse(400, { code: 400, message: "invalid public key" })) as typeof fetch;
    const r = await submitToRekor(makeArgs(), { fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("rejected");
      expect(r.detail).toContain("HTTP 400");
      expect(r.detail).toContain("invalid public key");
    }
  });

  test("reason='rejected' on HTTP 500", async () => {
    const fetchImpl = (async () =>
      rekorResponse(500, { error: "internal" })) as typeof fetch;
    const r = await submitToRekor(makeArgs(), { fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("rejected");
  });

  test("reason='malformed' when body parses to something Rekor-incompatible", async () => {
    const fetchImpl = (async () =>
      rekorResponse(201, { not_a_rekor_response: true })) as typeof fetch;
    const r = await submitToRekor(makeArgs(), { fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed");
  });

  test("reason='timeout' when fetch aborts at timeoutMs", async () => {
    const fetchImpl = (async (_url, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted) {
          const e = new Error("aborted"); (e as { name: string }).name = "AbortError";
          reject(e); return;
        }
        signal?.addEventListener("abort", () => {
          const e = new Error("aborted"); (e as { name: string }).name = "AbortError";
          reject(e);
        });
      });
    }) as typeof fetch;
    const t0 = Date.now();
    const r = await submitToRekor(makeArgs(), { fetchImpl, timeoutMs: 50 });
    const elapsed = Date.now() - t0;
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("timeout");
      expect(r.detail).toContain("50ms");
    }
    expect(elapsed).toBeLessThan(2000);
  });

  test("reason='encoding' on bad pubkey hex (never reaches network)", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return rekorResponse(201, rekorSuccessBody());
    }) as typeof fetch;
    const r = await submitToRekor(makeArgs({ pub: "deadbeef" }), { fetchImpl });
    expect(called).toBe(false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("encoding");
  });
});

describe("parseRekorResponse", () => {
  test("returns null for empty / wrong shape", () => {
    expect(parseRekorResponse(null)).toBeNull();
    expect(parseRekorResponse({})).toBeNull();
    expect(parseRekorResponse({ uuid: { /* no logIndex */ } })).toBeNull();
  });

  test("tolerates top-level logIndex (older API shape)", () => {
    const body = {
      "uuid-x": {
        logIndex: 7,
        integratedTime: 1700000000,
        verification: { signedEntryTimestamp: "x==" },
      },
    };
    const e = parseRekorResponse(body);
    expect(e?.logIndex).toBe(7);
    expect(e?.uuid).toBe("uuid-x");
  });
});

describe("rekorEntryUrl", () => {
  test("uses the public Sigstore base by default", () => {
    expect(rekorEntryUrl("u")).toBe("https://rekor.sigstore.dev/api/v1/log/entries/u");
  });
  test("respects an override base URL", () => {
    expect(rekorEntryUrl("u", "http://localhost:9999")).toBe(
      "http://localhost:9999/api/v1/log/entries/u",
    );
  });
});

// ── computeTier — unchanged contract ───────────────────────────────────────

describe("computeTier", () => {
  test("unsigned: missing wrapper signature", () => {
    const b = bareBundle();
    (b as { signature?: string }).signature = "";
    expect(computeTier(b)).toBe<TrustTier>("unsigned");
  });

  test("signature_only: signed but no chain, no identity, no rekor, no engine hash", () => {
    expect(computeTier(bareBundle())).toBe<TrustTier>("signature_only");
  });

  test("chain_intact: previous_hash links to an ancestor", () => {
    const b = bareBundle();
    b.payload.previous_hash = "sha256:" + "9".repeat(64);
    expect(computeTier(b)).toBe<TrustTier>("chain_intact");
  });

  test("identity_verified: attestation present but no engine_version_hash", () => {
    const b = bareBundle();
    b.attestation = attestationFixture();
    expect(computeTier(b)).toBe<TrustTier>("identity_verified");
  });

  test("engine_verified: identity + engine_version_hash present, no rekor", () => {
    const b = bareBundle();
    b.attestation = attestationFixture();
    b.payload.engine_version_hash = "e".repeat(64);
    expect(computeTier(b)).toBe<TrustTier>("engine_verified");
  });

  test("fully_verifiable: rekor.logIndex present (wins over every other tier)", () => {
    const b = bareBundle();
    b.attestation = attestationFixture();
    b.payload.engine_version_hash = "e".repeat(64);
    b.rekor = VALID_REKOR;
    expect(computeTier(b)).toBe<TrustTier>("fully_verifiable");
  });

  test("fully_verifiable does NOT require chain or identity — Rekor alone is enough", () => {
    const b = bareBundle();
    b.rekor = VALID_REKOR;
    expect(computeTier(b)).toBe<TrustTier>("fully_verifiable");
  });
});

// ── live integration (opt-in via REKOR_LIVE=1) ─────────────────────────────
//
// Exercises the full path against the public rekor.sigstore.dev. Skipped by
// default so PRs don't depend on the public log being up. Uses ephemeral
// crypto.subtle keys — nothing local is touched.

const LIVE = process.env.REKOR_LIVE === "1";

(LIVE ? describe : describe.skip)("live — rekor.sigstore.dev", () => {
  test("real submission produces a logIndex + the entry is fetchable", async () => {
    // Generate a fresh ephemeral Ed25519 keypair for this test.
    const kp = await crypto.subtle.generateKey(
      { name: "Ed25519" } as unknown as Algorithm,
      true,
      ["sign", "verify"],
    ) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey) as JsonWebKey;
    const pubHex = Buffer.from(jwk.x as string, "base64url").toString("hex");

    // Sign a SHA-512 of some unique bytes (Rekor would reject a duplicate).
    const unique = `beheld-live-test-${Date.now()}-${Math.random()}`;
    const data = new TextEncoder().encode(unique);
    const sha512 = await crypto.subtle.digest("SHA-512", data);
    const sig = await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, sha512);

    const hashHex = Array.from(new Uint8Array(sha512))
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    const sigHex = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0")).join("");

    const r = await submitToRekor(
      { rekorHashHex: hashHex, rekorSignatureHex: sigHex, publicKeyHex: pubHex },
      { timeoutMs: 15000 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(typeof r.entry.logIndex).toBe("number");
      expect(r.entry.logIndex).toBeGreaterThan(0);
      expect(r.entry.uuid.length).toBeGreaterThan(20);
    }
  }, 30000);
});

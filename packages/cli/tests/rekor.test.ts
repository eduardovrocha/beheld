/**
 * F5.8 — Sigstore Rekor submission + trust tier derivation.
 *
 * `submitToRekor` is contract-bound to NEVER throw: any failure (network,
 * timeout, HTTP error, malformed response) must resolve to `null`. These
 * tests pin that contract by injecting a `fetchImpl` test seam.
 */
import { describe, expect, test } from "bun:test";

import {
  buildHashedRekord,
  ed25519HexToDerB64,
  parseRekorResponse,
  rekorEntryUrl,
  submitToRekor,
} from "../src/lib/rekor";
import { computeTier, type TrustTier } from "../src/lib/tier";
import type { Bundle, RekorEntry } from "../src/bundle/types";

// ── helpers ─────────────────────────────────────────────────────────────────

const HASH_HEX = "a".repeat(64);
const SIG_HEX = "b".repeat(128);
const PUB_HEX = "c".repeat(64);
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

function bareBundle(): Bundle {
  return {
    version: "3",
    payload: {
      created_at: "2026-05-21T00:00:00+00:00",
      beheld_version: "0.1.1",
      previous_hash: null,
      scores: {
        date: "2026-05-21",
        prompt_quality: 10,
        test_maturity: 10,
        tech_breadth: 10,
        growth_rate: 10,
        overall: 10,
        sessions_analyzed: 1,
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
        sessions_analyzed: 1,
        period_days: 30,
      },
      engine_version_hash: null,
    },
    hash: `sha256:${HASH_HEX}`,
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

// ── DER + body shape ────────────────────────────────────────────────────────

describe("ed25519HexToDerB64", () => {
  test("wraps a 32-byte raw key with the SPKI prefix", () => {
    const der = Buffer.from(ed25519HexToDerB64("00".repeat(32)), "base64");
    expect(der.length).toBe(44);
    expect(der.toString("hex").startsWith("302a300506032b6570032100")).toBe(true);
  });

  test("rejects non-32-byte input", () => {
    expect(() => ed25519HexToDerB64("ab")).toThrow();
  });
});

describe("buildHashedRekord", () => {
  test("emits the hashedrekord shape Rekor's POST endpoint expects", () => {
    const body = buildHashedRekord({
      payloadHashHex: HASH_HEX,
      signatureHex: SIG_HEX,
      publicKeyHex: PUB_HEX,
    }) as {
      kind: string;
      apiVersion: string;
      spec: { data: { hash: { algorithm: string; value: string } }; signature: { content: string; publicKey: { content: string } } };
    };
    expect(body.kind).toBe("hashedrekord");
    expect(body.apiVersion).toBe("0.0.1");
    expect(body.spec.data.hash.algorithm).toBe("sha256");
    expect(body.spec.data.hash.value).toBe(HASH_HEX);
    expect(body.spec.signature.content).toBe(Buffer.from(SIG_HEX, "hex").toString("base64"));
    // publicKey is wrapped in DER SPKI envelope
    const der = Buffer.from(body.spec.signature.publicKey.content, "base64");
    expect(der.length).toBe(44);
  });
});

// ── submitToRekor — happy & sad paths ───────────────────────────────────────

describe("submitToRekor", () => {
  test("returns RekorEntry on HTTP 201 with valid body", async () => {
    const fetchImpl = (async () => rekorResponse(201, rekorSuccessBody())) as typeof fetch;
    const entry = await submitToRekor(HASH_HEX, SIG_HEX, PUB_HEX, { fetchImpl });
    expect(entry).not.toBeNull();
    expect(entry!.logIndex).toBe(12345678);
    expect(entry!.uuid).toBe(SAMPLE_UUID);
    expect(entry!.integratedTime).toBe("2025-06-01T16:00:00.000Z");
    expect(entry!.signedEntryTimestamp).toBe("MEUCIQ==");
  });

  test("returns null on network error (fetch throws)", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const entry = await submitToRekor(HASH_HEX, SIG_HEX, PUB_HEX, { fetchImpl });
    expect(entry).toBeNull();
  });

  test("returns null on HTTP 500", async () => {
    const fetchImpl = (async () => rekorResponse(500, { error: "internal" })) as typeof fetch;
    const entry = await submitToRekor(HASH_HEX, SIG_HEX, PUB_HEX, { fetchImpl });
    expect(entry).toBeNull();
  });

  test("returns null when response body is malformed", async () => {
    const fetchImpl = (async () => rekorResponse(201, "not-json")) as typeof fetch;
    const entry = await submitToRekor(HASH_HEX, SIG_HEX, PUB_HEX, { fetchImpl });
    expect(entry).toBeNull();
  });

  test("aborts and returns null after the configured timeout", async () => {
    const fetchImpl = (async (_url, init?: RequestInit) => {
      // Honour the AbortSignal by rejecting when aborted, like real fetch.
      const signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted) reject(new Error("aborted"));
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
        // Otherwise hang.
      });
    }) as typeof fetch;
    const t0 = Date.now();
    const entry = await submitToRekor(HASH_HEX, SIG_HEX, PUB_HEX, {
      fetchImpl,
      timeoutMs: 50,
    });
    const elapsed = Date.now() - t0;
    expect(entry).toBeNull();
    // Timed out close to the limit (allow generous slack on slow CI).
    expect(elapsed).toBeLessThan(2000);
  });

  test("returns null when the DER conversion fails (invalid pubkey)", async () => {
    // Force the body builder to throw before any HTTP call happens.
    const fetchImpl = (async () => {
      throw new Error("should not be called");
    }) as typeof fetch;
    const entry = await submitToRekor(HASH_HEX, SIG_HEX, "deadbeef", { fetchImpl });
    expect(entry).toBeNull();
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

// ── computeTier ─────────────────────────────────────────────────────────────

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

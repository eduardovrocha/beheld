/**
 * Offline .beheld verification (Phase 5 / F5.3.8).
 *
 * Pure functions — no filesystem, no network. The CLI command at
 * commands/verify.ts wires these to disk I/O + console output.
 *
 * Three independent checks:
 *   1. schema    — shape sanity (defensive — `verifyBundle` is sometimes given
 *                  unknown input loaded from disk by a user)
 *   2. hash      — recomputed SHA-256 of canonical(payload) matches bundle.hash
 *   3. signature — Ed25519 verify with the embedded public_key
 *
 * Optional fourth check via `verifyChain`:
 *   4. chain     — walks previous_hash recursively, verifying each link
 */
import { payloadHash, payloadToCanonical } from "./canonical";
import type { Bundle, BundlePayload } from "./types";

export interface CheckResult {
  ok: boolean;
  reason?: string;
}

export interface VerifyResult {
  ok: boolean;
  checks: {
    schema: CheckResult;
    hash: CheckResult;
    signature: CheckResult;
    /** Phase 6 / F6.8 — L1 section presence. `ok=false` here is a warning,
     *  not a failure: bundles generated before Phase 6 are still valid. */
    l1_section: CheckResult & { repo_count?: number };
    /** Phase 6 / F6.8 — L2 section presence. v2 bundles use `l2`; v1 bundles
     *  use the legacy `signals` key (accepted for backward compatibility). */
    l2_section: CheckResult & { session_count?: number };
  };
  /** Total `ok` excluding the L1 warning — the verifier still passes a bundle
   *  that has no L1 section as long as schema/hash/signature/l2 are valid. */
  warnings: string[];
}

const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const SIG_RE = /^ed25519:[0-9a-f]{128}$/;
const PUBKEY_RE = /^ed25519:[A-Za-z0-9_-]+$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateSchema(raw: unknown): CheckResult {
  if (!isObject(raw)) return { ok: false, reason: "not a JSON object" };
  if (raw.version === undefined) return { ok: false, reason: "missing 'version'" };
  if (typeof raw.hash !== "string" || !HASH_RE.test(raw.hash))
    return { ok: false, reason: "malformed 'hash'" };
  if (typeof raw.signature !== "string" || !SIG_RE.test(raw.signature))
    return { ok: false, reason: "malformed 'signature'" };
  if (typeof raw.public_key !== "string" || !PUBKEY_RE.test(raw.public_key))
    return { ok: false, reason: "malformed 'public_key'" };
  if (!isObject(raw.payload)) return { ok: false, reason: "missing or invalid 'payload'" };
  const payload = raw.payload as Record<string, unknown>;
  for (const required of ["created_at", "beheld_version", "previous_hash", "scores"]) {
    if (!(required in payload)) {
      return { ok: false, reason: `payload missing '${required}'` };
    }
  }
  // Schema discrimination (R1.1):
  //   v6 → core + enrichment   (current generator)
  //   v5 → l1   + l2           (Phase 6, pre-rename)
  //   v1 → signals             (pre-Phase 6)
  // Verifier accepts all three; the manifest output shows which schema was
  // detected so consumers can interpret the section labels correctly.
  const hasV6 = "core" in payload && "enrichment" in payload;
  const hasV5 = "l1" in payload && "l2" in payload;
  const hasV1 = "signals" in payload;
  if (!hasV6 && !hasV5 && !hasV1) {
    return {
      ok: false,
      reason: "payload missing required sections (no 'core'/'enrichment', no 'l1'/'l2', no legacy 'signals')",
    };
  }
  return { ok: true };
}

interface PayloadView {
  // v6 (current)
  core?: { total_repos?: number; root_commit_hashes?: unknown[] };
  enrichment?: {
    sessions_analyzed?: number;
    harness_sources?: Array<{ harness?: string; capture_fidelity?: string; sessions?: number }>;
  };
  // v5 legacy
  l1?: { total_repos?: number; root_commit_hashes?: unknown[] };
  l2?: { sessions_analyzed?: number };
  // v1 legacy
  signals?: { sessions_analyzed?: number };
}

function validateCoreSection(payload: PayloadView): VerifyResult["checks"]["l1_section"] {
  // Fallback order: v6 core → v5 l1. Both shapes mirror BundleCoreSection.
  const core = payload.core ?? payload.l1;
  if (!core || typeof core !== "object") {
    return {
      ok: false,
      reason: "Seção core ausente — bundle gerado com versão anterior do Beheld",
    };
  }
  const count = typeof core.total_repos === "number" ? core.total_repos : 0;
  return { ok: true, repo_count: count };
}

function validateEnrichmentSection(payload: PayloadView): VerifyResult["checks"]["l2_section"] {
  // Fallback order: v6 enrichment → v5 l2 → v1 signals.
  const enrichment = payload.enrichment ?? payload.l2 ?? payload.signals;
  if (!enrichment || typeof enrichment !== "object") {
    return { ok: false, reason: "enrichment section missing (no 'enrichment'/'l2'/'signals')" };
  }
  const count = typeof enrichment.sessions_analyzed === "number" ? enrichment.sessions_analyzed : 0;
  return { ok: true, session_count: count };
}

async function verifyHash(bundle: Bundle): Promise<CheckResult> {
  const recomputed = await payloadHash(bundle.payload);
  if (recomputed === bundle.hash) return { ok: true };
  return {
    ok: false,
    reason: `hash mismatch — expected ${recomputed.slice(0, 24)}…, found ${bundle.hash.slice(0, 24)}…`,
  };
}

async function verifySignature(bundle: Bundle): Promise<CheckResult> {
  const x = bundle.public_key.replace(/^ed25519:/, "");
  let pubKey: CryptoKey;
  try {
    pubKey = await crypto.subtle.importKey(
      "jwk",
      { kty: "OKP", crv: "Ed25519", x },
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch (e) {
    return { ok: false, reason: `cannot import public_key: ${(e as Error).message}` };
  }

  const sigHex = bundle.signature.replace(/^ed25519:/, "");
  const sigMatches = sigHex.match(/.{2}/g);
  if (!sigMatches) return { ok: false, reason: "signature not valid hex" };
  const sigBytes = Uint8Array.from(sigMatches.map((b) => parseInt(b, 16)));

  const canonical = new TextEncoder().encode(payloadToCanonical(bundle.payload));

  let ok: boolean;
  try {
    ok = await crypto.subtle.verify({ name: "Ed25519" }, pubKey, sigBytes, canonical);
  } catch (e) {
    return { ok: false, reason: `verify threw: ${(e as Error).message}` };
  }
  return ok ? { ok: true } : { ok: false, reason: "signature does not match payload" };
}

export async function verifyBundle(raw: unknown): Promise<VerifyResult> {
  const skipped: CheckResult = { ok: false, reason: "skipped (schema failed)" };
  const schema = validateSchema(raw);
  if (!schema.ok) {
    return {
      ok: false,
      warnings: [],
      checks: {
        schema,
        hash: skipped,
        signature: skipped,
        l1_section: { ...skipped },
        l2_section: { ...skipped },
      },
    };
  }
  const bundle = raw as Bundle;
  const hashCheck = await verifyHash(bundle);
  const sigCheck = hashCheck.ok
    ? await verifySignature(bundle)
    : { ok: false, reason: "skipped (hash failed)" };

  const payloadView = (bundle.payload as unknown) as PayloadView;
  const l1Check = validateCoreSection(payloadView);
  const l2Check = validateEnrichmentSection(payloadView);

  const warnings: string[] = [];
  if (!l1Check.ok && l1Check.reason) warnings.push(l1Check.reason);

  // core absence is a warning, not a failure — keep old bundles verifiable.
  return {
    ok: schema.ok && hashCheck.ok && sigCheck.ok && l2Check.ok,
    warnings,
    checks: { schema, hash: hashCheck, signature: sigCheck, l1_section: l1Check, l2_section: l2Check },
  };
}

// ── chain verification ──────────────────────────────────────────────────────

export type BundleResolver = (hash: string) => Promise<Bundle | null>;

export interface ChainResult extends CheckResult {
  links_verified: number;
}

const MAX_CHAIN_DEPTH = 1000;

export async function verifyChain(
  bundle: Bundle,
  resolve: BundleResolver,
): Promise<ChainResult> {
  let current: Bundle = bundle;
  let links = 0;

  while (current.payload.previous_hash !== null) {
    if (links >= MAX_CHAIN_DEPTH) {
      return { ok: false, links_verified: links, reason: "chain too deep — possible cycle" };
    }
    const prevHash = current.payload.previous_hash;
    const prev = await resolve(prevHash);
    if (!prev) {
      return {
        ok: false,
        links_verified: links,
        reason: `previous bundle ${prevHash.slice(0, 24)}… not found locally`,
      };
    }
    if (prev.hash !== prevHash) {
      return {
        ok: false,
        links_verified: links,
        reason: `resolved bundle hash differs from link (resolver returned wrong file?)`,
      };
    }
    const prevResult = await verifyBundle(prev);
    if (!prevResult.ok) {
      const failed = Object.entries(prevResult.checks).find(([, v]) => !v.ok);
      return {
        ok: false,
        links_verified: links,
        reason: `previous bundle ${prevHash.slice(0, 24)}… failed ${failed?.[0]}: ${failed?.[1].reason ?? "?"}`,
      };
    }
    current = prev;
    links++;
  }

  return { ok: true, links_verified: links };
}

// ── helper: extract embedded data for display ───────────────────────────────

export function summarize(payload: BundlePayload): string {
  const s = payload.scores;
  return `score ${s.overall}/100 · ${s.sessions_analyzed} sessões · ${payload.created_at.slice(0, 10)}`;
}

/** Two-line composition string surfaced by `beheld snapshot` and
 *  `beheld verify`. Falls back when L1 is empty / absent. */
export function composition(payload: BundlePayload | Record<string, unknown>): {
  base: string;
  trajectory: string;
} {
  const view = payload as unknown as PayloadView;
  // R1.1 — read v6 core/enrichment first, fall back to v5 l1/l2 then v1 signals.
  const core = view.core ?? view.l1;
  const enrichment = view.enrichment ?? view.l2 ?? view.signals;
  const sessionCount =
    typeof enrichment?.sessions_analyzed === "number" ? enrichment.sessions_analyzed : 0;
  // `period_days` lives on the same shape for v6 (enrichment), v5 (l2), and v1 (signals).
  const periodDays =
    typeof (enrichment as { period_days?: number } | undefined)?.period_days === "number"
      ? (enrichment as { period_days?: number }).period_days!
      : 0;
  const trajectory = `${sessionCount} sessões · ${periodDays} dias`;

  if (!core || (typeof core.total_repos === "number" && core.total_repos === 0)) {
    return {
      base: "não disponível (execute beheld import)",
      trajectory,
    };
  }
  const repos = typeof core.total_repos === "number" ? core.total_repos : 0;
  const commits =
    typeof (core as { total_commits?: number }).total_commits === "number"
      ? (core as { total_commits?: number }).total_commits!
      : 0;
  return {
    base: `${repos} repositórios · ${commits.toLocaleString("pt-BR")} commits`,
    trajectory,
  };
}

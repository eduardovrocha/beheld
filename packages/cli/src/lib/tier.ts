/**
 * Trust tier derivation (Phase 5 / F5.8).
 *
 * The tier is NEVER stored in the bundle — it is recomputed every time a
 * verifier inspects the wrapper. This keeps bundles immutable while letting
 * the same artifact climb tiers as the surrounding evidence accumulates
 * (an attestation is added, Rekor inclusion lands, etc.).
 *
 * Order of evaluation (highest tier wins):
 *   1. unsigned          — missing the wrapper signature
 *   2. fully_verifiable  — rekor.logIndex is present
 *   3. engine_verified   — engine_version_hash + identity_verified both set
 *   4. identity_verified — identity attestation present and bound
 *   5. chain_intact      — payload.previous_hash links to an ancestor
 *   6. signature_only    — wrapper is signed but nothing else is established
 *                          (also covers genesis bundles)
 */
import type { Bundle } from "../bundle/types";

export type TrustTier =
  | "unsigned"
  | "signature_only"
  | "chain_intact"
  | "identity_verified"
  | "engine_verified"
  | "fully_verifiable";

function hasIdentity(bundle: Bundle): boolean {
  const a = bundle.attestation;
  return Boolean(a && a.payload && a.payload.github && a.signature);
}

function hasEngineHash(bundle: Bundle): boolean {
  const h = (bundle.payload as { engine_version_hash?: string | null } | undefined)
    ?.engine_version_hash;
  return typeof h === "string" && h.length === 64;
}

function hasRekor(bundle: Bundle): boolean {
  const r = bundle.rekor;
  return !!(r && typeof r.logIndex === "number" && typeof r.uuid === "string");
}

function hasChain(bundle: Bundle): boolean {
  return typeof bundle.payload?.previous_hash === "string"
    && bundle.payload.previous_hash.length > 0;
}

export function computeTier(bundle: Bundle): TrustTier {
  if (!bundle?.signature) return "unsigned";
  if (hasRekor(bundle)) return "fully_verifiable";
  if (hasEngineHash(bundle) && hasIdentity(bundle)) return "engine_verified";
  if (hasIdentity(bundle)) return "identity_verified";
  if (hasChain(bundle)) return "chain_intact";
  return "signature_only";
}

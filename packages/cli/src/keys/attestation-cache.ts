/**
 * On-disk cache for the platform-issued identity attestation
 * (Phase 5 / F5.6.1.d).
 *
 * The CLI runs `beheld attest`, completes the OAuth flow with the
 * platform backend, and stores the signed attestation here. `beheld
 * snapshot` reads from this file and embeds the attestation into each
 * .beheld it produces.
 *
 * Format on disk: the exact JSON returned by `POST /api/attestation/claim`.
 * File location: <BEHELD_DATA_DIR or ~/.beheld>/attestation.json
 * Permissions: 0600 (the file is a verifiable identity binding, not a
 * secret per se, but tightening keeps it consistent with the keystore).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface CachedAttestation {
  payload: {
    type: string;
    platform_key_id: string;
    /** Wire format matches Rails' build_payload: "ed25519-pub:<std-base64>". */
    dev_pubkey: string;
    github: {
      user_id: number;
      login: string;
      verified_at: string;
    };
    attested_at: string;
  };
  /** "ed25519:<base64>" — Ed25519 signature over canonical(payload). */
  signature: string;
}

export function attestationCachePath(baseDir?: string): string {
  const base =
    baseDir ??
    (process.env.BEHELD_DATA_DIR
      ? join(process.env.BEHELD_DATA_DIR, ".beheld")
      : join(homedir(), ".beheld"));
  return join(base, "attestation.json");
}

export function loadAttestationCache(baseDir?: string): CachedAttestation | null {
  const p = attestationCachePath(baseDir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as CachedAttestation;
  } catch {
    return null;
  }
}

export function saveAttestationCache(att: CachedAttestation, baseDir?: string): void {
  const p = attestationCachePath(baseDir);
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, JSON.stringify(att, null, 2) + "\n");
  chmodSync(p, 0o600);
}

export function clearAttestationCache(baseDir?: string): boolean {
  const p = attestationCachePath(baseDir);
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}

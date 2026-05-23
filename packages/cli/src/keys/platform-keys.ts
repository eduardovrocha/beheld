/**
 * Embedded platform signing keys for offline attestation verification
 * (Phase 5 / F5.6.0.d).
 *
 * Frozen snapshot of `web/source/backend/keys/platform/` from the
 * beheld-web repo, captured at the moment of the last CLI release.
 * Refresh after rotating or revoking a platform key:
 *
 *   bun run sync:platform-keys
 *
 * Used by the offline-first verifier in `bundle/verify.ts` (the CLI must
 * be able to confirm an attestation signature without reaching the
 * `/api/platform-keys` endpoint over the network). Revocation status here
 * is the snapshot at sync time; live revocation requires an opt-in online
 * cross-check.
 */
import platformKeysData from "./platform-keys.json";

export interface PlatformKey {
  key_id: string;
  algorithm: "ed25519";
  /** Wire format: "ed25519-pub:<base64-encoded raw 32 bytes>". */
  public_key: string;
  active: boolean;
  revoked: boolean;
  created_at: string;
  rotated_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
}

export const EMBEDDED_PLATFORM_KEYS: ReadonlyArray<PlatformKey> =
  platformKeysData.keys as ReadonlyArray<PlatformKey>;

export const EMBEDDED_KEYS_SOURCE: string = platformKeysData.source;

export function findPlatformKey(keyId: string): PlatformKey | undefined {
  return EMBEDDED_PLATFORM_KEYS.find((k) => k.key_id === keyId);
}

export function activePlatformKeys(): PlatformKey[] {
  return EMBEDDED_PLATFORM_KEYS.filter((k) => k.active && !k.revoked);
}

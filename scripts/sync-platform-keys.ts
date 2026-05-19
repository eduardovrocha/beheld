#!/usr/bin/env bun
/**
 * Sync platform pub keys from devprofile-web → packages/cli/src/keys.
 *
 * Reads the source-of-truth at `web/source/backend/keys/platform/` (which
 * lives in the gitignored sibling repo `devprofile-web`) and writes a
 * single JSON snapshot at `packages/cli/src/keys/platform-keys.json`.
 *
 * The compiled CLI binary embeds this JSON at build time, so the offline
 * verifier has the platform's pub keys available without reaching the
 * `/api/platform-keys` endpoint over the network.
 *
 * Run after rotating or revoking a platform key, before tagging a CLI
 * release:
 *
 *   bun run sync:platform-keys
 *
 * Phase 5 / F5.6.0.d.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const WEB_KEYS_DIR = "web/source/backend/keys/platform";
const EMBED_PATH = "packages/cli/src/keys/platform-keys.json";

export interface SyncedKey {
  key_id: string;
  algorithm: string;
  public_key: string;
  active: boolean;
  revoked: boolean;
  created_at: string;
  rotated_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
}

export interface SyncOutput {
  source: string;
  keys: SyncedKey[];
}

export function buildSyncOutput(
  webKeysDir: string,
  sourceLabel: string,
): SyncOutput {
  if (!existsSync(webKeysDir)) {
    throw new Error(
      `Missing ${webKeysDir}. The devprofile-web repo must be checked out as a sibling at web/.`,
    );
  }
  const files = readdirSync(webKeysDir)
    .filter((f) => f.endsWith(".info.json"))
    .sort();
  const keys = files.map((f): SyncedKey => {
    const infoPath = join(webKeysDir, f);
    const info = JSON.parse(readFileSync(infoPath, "utf8"));
    const pubPath = join(webKeysDir, `${info.key_id}.pub`);
    if (!existsSync(pubPath)) {
      throw new Error(`Missing .pub file for ${info.key_id} at ${pubPath}`);
    }
    const pub = readFileSync(pubPath, "utf8").trim();
    return {
      key_id: info.key_id,
      algorithm: info.algorithm,
      public_key: `ed25519-pub:${pub}`,
      active: Boolean(info.active),
      revoked: Boolean(info.revoked),
      created_at: info.created_at,
      rotated_at: info.rotated_at ?? null,
      revoked_at: info.revoked_at ?? null,
      revoked_reason: info.revoked_reason ?? null,
    };
  });
  return { source: sourceLabel, keys };
}

if (import.meta.main) {
  const output = buildSyncOutput(WEB_KEYS_DIR, WEB_KEYS_DIR);
  writeFileSync(EMBED_PATH, JSON.stringify(output, null, 2) + "\n");
  console.log(
    `Synced ${output.keys.length} platform key(s) → ${EMBED_PATH}`,
  );
}

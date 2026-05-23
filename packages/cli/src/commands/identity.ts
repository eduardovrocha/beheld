/**
 * `beheld identity link` / `beheld identity status` (Phase 5 / F5.6).
 *
 * Surface-level alias over `beheld attest` so the F5.6 spec's naming is
 * reachable from the CLI. The underlying flow, schema, and on-disk cache
 * (`~/.beheld/attestation.json`) are unchanged — `attest` and `identity link`
 * are two names for the same operation.
 *
 * `identity status` reads the cache and prints the bound GitHub identity, or
 * a hint to run `beheld identity link` when no attestation is present.
 */
import { attestCommand, type AttestOptions } from "./attest";
import { loadAttestationCache } from "../keys/attestation-cache";
import { arrow, bold, brand, meta } from "../ui/styles";

export async function identityLinkCommand(opts: AttestOptions = {}): Promise<void> {
  await attestCommand(opts);
}

export interface IdentityStatusOptions {
  /** Test seam — override the cache directory. */
  dataDir?: string;
}

export async function identityStatusCommand(opts: IdentityStatusOptions = {}): Promise<void> {
  console.log(brand("identidade GitHub"));
  const cached = loadAttestationCache(opts.dataDir);
  if (!cached) {
    console.log(arrow("não vinculada"));
    console.log(`  ${meta("execute:")} ${bold("beheld identity link")}`);
    return;
  }
  console.log(arrow("vinculada"));
  console.log(`  ${bold("github:")}        @${cached.payload.github.login} (id=${cached.payload.github.user_id})`);
  console.log(`  ${bold("platform_key:")}  ${cached.payload.platform_key_id}`);
  console.log(`  ${bold("attested_at:")}   ${cached.payload.attested_at}`);
}

/**
 * .beheld wire format — TypeScript twin of engine/src/models.py.
 *
 * Any change here MUST bump BUNDLE_VERSION and update the Python twin in the
 * same commit. The cross-language canonical hash test catches drift.
 */

export const BUNDLE_VERSION = "5";

export interface BundleScores {
  date: string;
  prompt_quality: number;
  test_maturity: number;
  tech_breadth: number;
  growth_rate: number;
  overall: number;
  sessions_analyzed: number;
}

export interface BundleWorkflowMetrics {
  test_after_ratio: number;
  test_first_ratio: number;
  median_test_delay_min: number;
  edit_to_test_lag_min: number;
  bash_to_read_ratio: number;
  prompt_avg_chars: number;
  prompt_median_chars: number;
  session_avg_duration_min: number;
  tool_variety_avg: number;
  ecosystem_concentration: number;
}

/** Reference to a repo in the L1 section. `first_seen_at` (F5.7.2) is the
 *  ISO-8601 UTC timestamp of the first import — immutable across re-imports. */
export interface L1RepositoryRef {
  hash: string;
  first_seen_at: string;
}

/** L1 — git-history signals (Phase 6). Always present in v2 payloads;
 *  empty (zeros / empty lists / null timestamps) when no repo has been imported. */
export interface BundleL1Section {
  total_repos: number;
  total_commits: number;
  earliest_commit: string | null;
  latest_commit: string | null;
  ecosystems: Record<string, boolean>;
  platforms: Record<string, boolean>;
  avg_test_ratio: number;
  root_commit_hashes: L1RepositoryRef[];
}

/** L2 — session signals (Phase 2–5). Same shape as the legacy `signals`
 *  field; renamed to surface the layered model. */
export interface BundleL2Section {
  platforms: Record<string, number>;
  ecosystems: Record<string, number>;
  workflow_distribution: Record<string, number>;
  project_categories: Record<string, number>;
  workflow_metrics: BundleWorkflowMetrics;
  sessions_analyzed: number;
  period_days: number;
}

/** Back-compat alias. New code should use BundleL2Section. */
export type BundleSignals = BundleL2Section;

/** F6.12 / schema v4 — language-weight + architecture-pattern aggregation
 *  embedded in the signed payload. Shape mirrors the engine's
 *  GET /l1/stack response. Inner items are loosely typed because they're
 *  consumed structurally by the HTML renderer (not by the verifier). */
export interface BundleStackLanguage {
  language: string;
  commit_count: number;
  file_count: number;
  first_seen: string;
  last_seen: string;
  weight_pct: number;
}
export interface BundleStackPattern {
  pattern: string;
  repo_count: number;
  confidence: "strong" | "weak";
}
export interface BundleStackSection {
  language_distribution: BundleStackLanguage[];
  architecture_patterns: BundleStackPattern[];
  total_commits_analyzed: number;
  repos_analyzed: number;
}

/** F6.12 — human-facing overlays that used to be fetched ad-hoc by the CLI
 *  when generating the HTML page. Embedded in v4 so the signed bytes carry
 *  what the HTML renders, making the shared `.html` portable. All four are
 *  optional/nullable — older bundles or fail-soft paths leave them null. */
export interface BundlePayload {
  created_at: string;
  beheld_version: string;
  previous_hash: string | null;
  scores: BundleScores;
  l1: BundleL1Section;
  l2: BundleL2Section;
  /** F5.7.2 — SHA-256 hex of the engine binary that produced the payload.
   *  Null when the engine ran unfrozen or the hash lookup failed. */
  engine_version_hash: string | null;
  /** F6.12 — stack analytics rolled up across imported repos. */
  stack?: BundleStackSection | null;
  /** F6.12 — public-facing signals overlay (ecosystems, test pattern,
   *  timing, tooling). Distinct from the L2 session counts above. */
  signals?: Record<string, unknown> | null;
  /** F6.12 — identity phrase produced by the IdentityGenerator at snapshot
   *  time. Stable for this snapshot — the HTML renders identity_long. */
  identity?: Record<string, unknown> | null;
  /** F6.12 — emergent-pattern diff (recent vs baseline). Null when no
   *  meaningful shift was detected. */
  emergent?: Record<string, unknown> | null;
  /** F6.12 / schema v5 — insights bullets generated at snapshot time.
   *  Shape: `{ insights: string[]; generated_at: string | null }` mirroring
   *  the engine's GET /insights response. */
  insights?: { insights?: string[]; generated_at?: string | null } | null;
}

/** Legacy v1 payload shape — only used by `verifyBundle` to detect bundles
 *  generated before Phase 6 and emit a friendly warning. */
export interface BundlePayloadV1 {
  created_at: string;
  beheld_version: string;
  previous_hash: string | null;
  scores: BundleScores;
  signals: BundleL2Section;
}

/** Identity attestation issued by the Beheld platform key
 *  (Phase 5 / F5.6). Lives at the WRAPPER level — sibling of hash and
 *  signature — so adding it to a bundle does not change the bundle hash.
 *  Bundles without an attestation field are still valid; verifiers report
 *  them as `identity_unverified`. */
export interface AttestationGithub {
  user_id: number;
  login: string;
  verified_at: string;
}

export interface AttestationPayload {
  type: string;            // "beheld-identity-attestation/v1"
  platform_key_id: string; // joins to GET /api/platform-keys + embedded keys
  dev_pubkey: string;      // "ed25519-pub:<std-base64>"
  github: AttestationGithub;
  attested_at: string;
}

export interface BundleAttestation {
  payload: AttestationPayload;
  signature: string; // "ed25519:<base64>" — Ed25519 sig over canonical(payload)
}

/** Sigstore Rekor inclusion proof (Phase 5 / F5.8). Lives at the WRAPPER
 *  level — sibling of hash/signature/attestation — so appending it after
 *  bundle generation never changes the payload hash. `null` when offline
 *  submission failed; can be back-filled via `beheld snapshot --rekor-submit`. */
export interface RekorEntry {
  /** Monotonically increasing position in the Rekor append-only log. */
  logIndex: number;
  /** Rekor entry UUID — appears in the public URL
   *  https://rekor.sigstore.dev/api/v1/log/entries/<uuid>. */
  uuid: string;
  /** ISO-8601 UTC of when Rekor included the entry. */
  integratedTime: string;
  /** Base64-encoded SET (Signed Entry Timestamp) issued by Rekor. */
  signedEntryTimestamp: string;
}

export interface Bundle {
  version: string;
  payload: BundlePayload;
  hash: string;        // "sha256:<hex>"
  signature: string;   // "ed25519:<hex>"
  public_key: string;  // "ed25519:<base64url-x>"
  attestation?: BundleAttestation | null;  // F5.6 — optional, wrapper-level
  rekor?: RekorEntry | null;               // F5.8 — optional, wrapper-level
}

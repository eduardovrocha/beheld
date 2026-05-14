/**
 * .dpbundle wire format — TypeScript twin of engine/src/models.py.
 *
 * Any change here MUST bump BUNDLE_VERSION and update the Python twin in the
 * same commit. The cross-language canonical hash test catches drift.
 */

export const BUNDLE_VERSION = "2";

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
  root_commit_hashes: string[];
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

export interface BundlePayload {
  created_at: string;
  devprofile_version: string;
  previous_hash: string | null;
  scores: BundleScores;
  l1: BundleL1Section;
  l2: BundleL2Section;
}

/** Legacy v1 payload shape — only used by `verifyBundle` to detect bundles
 *  generated before Phase 6 and emit a friendly warning. */
export interface BundlePayloadV1 {
  created_at: string;
  devprofile_version: string;
  previous_hash: string | null;
  scores: BundleScores;
  signals: BundleL2Section;
}

export interface Bundle {
  version: string;
  payload: BundlePayload;
  hash: string;        // "sha256:<hex>"
  signature: string;   // "ed25519:<hex>"
  public_key: string;  // "ed25519:<base64url-x>"
}

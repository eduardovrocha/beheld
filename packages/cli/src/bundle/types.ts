/**
 * .dpbundle wire format — TypeScript twin of engine/src/models.py.
 *
 * Any change here MUST bump BUNDLE_VERSION and update the Python twin in the
 * same commit. The cross-language canonical hash test catches drift.
 */

export const BUNDLE_VERSION = "1";

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

export interface BundleSignals {
  platforms: Record<string, number>;
  ecosystems: Record<string, number>;
  workflow_distribution: Record<string, number>;
  project_categories: Record<string, number>;
  workflow_metrics: BundleWorkflowMetrics;
  sessions_analyzed: number;
  period_days: number;
}

export interface BundlePayload {
  created_at: string;
  devprofile_version: string;
  previous_hash: string | null;
  scores: BundleScores;
  signals: BundleSignals;
}

export interface Bundle {
  version: string;
  payload: BundlePayload;
  hash: string;        // "sha256:<hex>"
  signature: string;   // "ed25519:<hex>"
  public_key: string;  // "ed25519:<base64url-x>"
}

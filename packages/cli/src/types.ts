export interface Scores {
  prompt_quality: number;
  test_maturity: number;
  tech_breadth: number;
  growth_rate: number;
  overall: number;
  sessions_analyzed: number;
  updated_at: string | null;
}

export interface DaemonStatus {
  running: boolean;
  session_active: boolean;
  events_today: number;
  sessions_today: number;
  pid: number;
}

export interface SessionMetrics {
  active: boolean;
  session_id?: string;
  duration_minutes?: number;
  event_count?: number;
  tools_used?: string[];
  has_test_context?: boolean;
}

export interface ProfileSummary {
  total_sessions: number;
  platforms: string[];
  ecosystems: string[];
  workflow_distribution: Record<string, number>;
  project_categories: Record<string, number>;
  last_scored_at: string | null;
  overall_score: number;
}

export interface Insight {
  insights: string[];
  generated_at: string | null;
  model?: string;
}

export interface ProcessResult {
  status: string;
  processed: number;
}

export interface ProfileData {
  scores: Scores | null;
  summary: ProfileSummary | null;
  insights: string[];
  session: SessionMetrics | null;
}

export interface ViewFlags {
  json: boolean;
  scoresOnly: boolean;
}

export interface WizardDimensions {
  prompt_quality: boolean;
  test_maturity: boolean;
  tech_breadth: boolean;
  work_hours: boolean;
  project_type: boolean;
}

export interface WizardEnvironments {
  claudeCode: boolean;
  continueDev: boolean;
}

export interface BeheldConfig {
  version: string;
  initialized_at: string;
  dimensions: WizardDimensions;
  environments: WizardEnvironments;
  /** Author email used to filter commits during L1 import. */
  author_email?: string;
}

export interface L1ImportResponse {
  status: "processing";
  repo_url: string;
}

export interface L1ImportStatus {
  status: "idle" | "processing" | "done" | "error";
  repo_url: string | null;
  progress_pct: number;
  result:
    | null
    | {
        status:
          | "imported"
          | "already_imported"
          | "author_not_found"
          | "needs_pat"
          | "clone_error";
        root_commit_hash?: string;
        commit_count?: number;
        detail?: string;
        ecosystems?: string[];
        test_ratio?: number;
        first_commit_at?: string;
        last_commit_at?: string;
      };
}

export interface L1Repository {
  root_commit_hash: string;
  imported_at: string;
  commit_count: number;
}

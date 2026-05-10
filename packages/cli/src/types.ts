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

export interface DevProfileConfig {
  version: string;
  initialized_at: string;
  dimensions: WizardDimensions;
  environments: WizardEnvironments;
}

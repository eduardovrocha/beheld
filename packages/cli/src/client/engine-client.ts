import type { Insight, ProcessResult, ProfileSummary, Scores } from "../types";
import { getLastCachedScores, type CachedScores } from "../storage/local-cache";

export interface EngineStatus {
  ok: boolean;
  version: string;
  sessions_processed: number;
  unprocessed_events: number;
  last_processed_at: string | null;
}

export interface EngineReadiness {
  ready: boolean;
  sessions_count: number;
  sessions_required: number;
  sessions_remaining: number;
}

const BASE = process.env.DEVPROFILE_ENGINE_URL ?? "http://127.0.0.1:7338";
const TIMEOUT = 3000;

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function post<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function engineHealth(): Promise<{ ok: boolean } | null> {
  return get<{ ok: boolean; version?: string }>("/health");
}

export async function scoresCurrent(): Promise<CachedScores | null> {
  try {
    const res = await fetch(`${BASE}/scores/current`, {
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) throw new Error("engine error");
    return { ...(await res.json()) as Omit<CachedScores, "source">, source: "live" };
  } catch {
    return getLastCachedScores();
  }
}

export async function scoresHistory(days = 30): Promise<Scores[] | null> {
  return get<Scores[]>(`/scores/history?days=${days}`);
}

export async function profileSummary(): Promise<ProfileSummary | null> {
  return get<ProfileSummary>("/profile/summary");
}

export async function insights(): Promise<Insight | null> {
  return get<Insight>("/insights");
}

export async function processNew(): Promise<ProcessResult | null> {
  return post<ProcessResult>("/process");
}

export async function engineStatus(): Promise<EngineStatus | null> {
  return get<EngineStatus>("/status");
}

export async function readiness(): Promise<EngineReadiness | null> {
  return get<EngineReadiness>("/profile/readiness");
}

export interface CoachPattern {
  id: string;
  label: string;
  evidence: string;
  metric: Record<string, number>;
  confidence: number;
  trend_30d: string;
  severity: string;
  applies_to_current_session: boolean;
}

export interface CoachPayload {
  version: number;
  as_of: string;
  data_freshness: "live" | "cache" | "insufficient";
  scores: {
    overall: number;
    sessions_analyzed: number;
    [k: string]: unknown;
  };
  context_for_session: {
    current_project_category: string;
    ecosystems_recent: string[];
    session_phase_hint: string;
  };
  patterns: CoachPattern[];
  coaching_guidance: {
    tone: string;
    must: string[];
    must_not: string[];
    good_example: string;
    bad_example: string;
  };
  suggested_followups: string[];
}

export async function coach(sessionHint = "unknown"): Promise<CoachPayload | null> {
  return get<CoachPayload>(`/coach?session_hint=${encodeURIComponent(sessionHint)}`);
}

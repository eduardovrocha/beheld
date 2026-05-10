import type { Insight, ProcessResult, ProfileSummary, Scores } from "../types";

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

export async function scoresCurrent(): Promise<Scores | null> {
  return get<Scores>("/scores/current");
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

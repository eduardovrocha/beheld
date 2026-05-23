import type { DaemonStatus, SessionMetrics } from "../types";

const BASE = process.env.BEHELD_MCP_URL ?? "http://127.0.0.1:7337";
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

export async function mcpHealth(): Promise<{ ok: boolean } | null> {
  return get<{ ok: boolean }>("/health");
}

export async function mcpStatus(): Promise<DaemonStatus | null> {
  return get<DaemonStatus>("/status");
}

export async function mcpSessionCurrent(): Promise<SessionMetrics | null> {
  return get<SessionMetrics>("/session/current");
}

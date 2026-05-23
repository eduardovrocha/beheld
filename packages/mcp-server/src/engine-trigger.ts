const TIMEOUT_MS = 10_000;
const COALESCE_WINDOW_MS = 30_000;

// Per-session dedupe state. Claude Code fires Stop multiple times per session
// (subagents finishing, end-of-turn, etc.) and the engine's /process reads
// from the JSONL cursor regardless of which session_id was passed — so calling
// it twice within a few seconds for the same session is pure waste and pure
// log noise. The 60s APScheduler tick on the engine catches anything missed.
const lastTriggeredAt = new Map<string, number>();
const inFlight = new Set<string>();

/** Test-only: clears coalesce state so each test starts clean. */
export function _resetCoalesceState(): void {
  lastTriggeredAt.clear();
  inFlight.clear();
}

export async function triggerEngineProcessing(sessionId: string): Promise<void> {
  if (inFlight.has(sessionId)) return;
  const last = lastTriggeredAt.get(sessionId);
  if (last !== undefined && Date.now() - last < COALESCE_WINDOW_MS) return;

  const engineUrl = process.env.BEHELD_ENGINE_URL ?? "http://127.0.0.1:7338";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  inFlight.add(sessionId);

  try {
    const res = await fetch(`${engineUrl}/process`, {
      method: "POST",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`engine error: ${res.status}`);
    console.debug("[stop] engine triggered", { session_id: sessionId, latency_ms: Date.now() - t0 });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      console.debug("[stop] engine trigger timeout — APScheduler will retry", {
        session_id: sessionId,
        timeout_ms: TIMEOUT_MS,
      });
    } else {
      console.debug("[stop] engine offline — APScheduler will retry", { session_id: sessionId });
    }
  } finally {
    clearTimeout(timer);
    inFlight.delete(sessionId);
    lastTriggeredAt.set(sessionId, Date.now());
  }
}

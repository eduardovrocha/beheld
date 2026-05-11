const TIMEOUT_MS = 3_000;

export async function triggerEngineProcessing(sessionId: string): Promise<void> {
  const engineUrl = process.env.DEVPROFILE_ENGINE_URL ?? "http://127.0.0.1:7338";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0 = Date.now();

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
  }
}

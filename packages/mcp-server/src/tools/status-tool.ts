import type { McpTool } from "./types";

const ENGINE_URL = process.env.BEHELD_ENGINE_URL ?? "http://127.0.0.1:7338";

interface EngineScores {
  // R1.2c — overall may be null when every dimension is absent.
  overall: number | null;
  sessions_analyzed: number;
  updated_at: string | null;
  sessions_today?: number;
  top_insight?: string | null;
}

export const statusTool: McpTool = {
  name: "beheld_status",
  description: "Retorna score atual do Beheld para exibição na sidebar do Continue.dev",
  inputSchema: { type: "object", properties: {} },
  async handler(_args) {
    try {
      const r = await fetch(`${ENGINE_URL}/scores/current`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!r.ok) throw new Error(`engine returned ${r.status}`);
      const scores = (await r.json()) as EngineScores;
      // R1.2c — label renders "—/100" when overall is null (every
      // dimension absent), preserving the structure for the sidebar.
      const labelOverall = scores.overall === null ? "—" : String(scores.overall);
      return {
        score: scores.overall,
        label: `Beheld ${labelOverall}/100`,
        sessions_today: scores.sessions_today ?? scores.sessions_analyzed,
        last_updated: scores.updated_at,
        top_insight: scores.top_insight ?? null,
      };
    } catch {
      return { error: "Beheld engine offline" };
    }
  },
};

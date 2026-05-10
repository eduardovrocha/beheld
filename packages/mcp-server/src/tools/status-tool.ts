import type { McpTool } from "./types";

const ENGINE_URL = "http://127.0.0.1:7338";

export const statusTool: McpTool = {
  name: "devprofile_status",
  description: "Status atual do DevProfile para exibição na sidebar do Continue.dev",
  inputSchema: { type: "object", properties: {} },
  async handler(_args) {
    try {
      const r = await fetch(`${ENGINE_URL}/scores/current`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!r.ok) throw new Error(`engine returned ${r.status}`);
      const scores = (await r.json()) as {
        overall: number;
        sessions_analyzed: number;
        updated_at: string | null;
      };
      return {
        score: scores.overall,
        sessions_today: scores.sessions_analyzed,
        last_updated: scores.updated_at,
        top_insight: null,
      };
    } catch {
      return { score: 0, sessions_today: 0, last_updated: null, top_insight: null };
    }
  },
};

import type { McpTool } from "./types";

const ENGINE_URL = "http://127.0.0.1:7338";

interface EngineScores {
  prompt_quality: number;
  test_maturity: number;
  tech_breadth: number;
  growth_rate: number;
  overall: number;
  sessions_analyzed: number;
  updated_at: string | null;
}

async function fetchScores(): Promise<EngineScores | null> {
  try {
    const r = await fetch(`${ENGINE_URL}/scores/current`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return null;
    return (await r.json()) as EngineScores;
  } catch {
    return null;
  }
}

function bar(score: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(score / 10)));
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

function formatScores(scores: EngineScores, view: string): string {
  if (scores.sessions_analyzed === 0) {
    return "DevProfile: no sessions analyzed yet. Keep using Claude Code — check back after a few sessions.";
  }

  if (view === "scores") {
    return [
      `Prompt quality  ${scores.prompt_quality}  ${bar(scores.prompt_quality)}`,
      `Test maturity   ${scores.test_maturity}  ${bar(scores.test_maturity)}`,
      `Tech breadth    ${scores.tech_breadth}  ${bar(scores.tech_breadth)}`,
      `Growth rate     ${scores.growth_rate}  ${bar(scores.growth_rate)}`,
    ].join("\n");
  }

  return [
    `Score geral: ${scores.overall}/100 · ${scores.sessions_analyzed} sessões analisadas`,
    "",
    `Prompt quality  ${scores.prompt_quality}  ${bar(scores.prompt_quality)}`,
    `Test maturity   ${scores.test_maturity}  ${bar(scores.test_maturity)}`,
    `Tech breadth    ${scores.tech_breadth}  ${bar(scores.tech_breadth)}`,
    `Growth rate     ${scores.growth_rate}  ${bar(scores.growth_rate)}`,
  ].join("\n");
}

export const devprofileTool: McpTool = {
  name: "devprofile",
  description: "Exibe o perfil de desenvolvedor baseado no uso do Claude",
  inputSchema: {
    type: "object",
    properties: {
      view: { type: "string", enum: ["summary", "scores", "insights", "full"] },
    },
  },
  async handler(args) {
    const view = (args.view as string) ?? "summary";
    const scores = await fetchScores();
    if (!scores) {
      return "DevProfile: engine not running. Start it with `devprofile start`.";
    }
    return formatScores(scores, view);
  },
};

import type { McpTool } from "./types";

const ENGINE_URL = process.env.DEVPROFILE_ENGINE_URL ?? "http://127.0.0.1:7338";

interface EngineScores {
  prompt_quality: number;
  test_maturity: number;
  tech_breadth: number;
  growth_rate: number;
  overall: number;
  sessions_analyzed: number;
  updated_at: string | null;
}

interface ProfileSummary {
  total_sessions: number;
  platforms: string[];
  ecosystems: string[];
  workflow_distribution: Record<string, number>;
  project_categories: Record<string, number>;
}

interface Insight {
  insights: string[];
  generated_at: string | null;
}

async function fetchScores(): Promise<EngineScores | null> {
  try {
    const r = await fetch(`${ENGINE_URL}/scores/current`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) return null;
    return (await r.json()) as EngineScores;
  } catch {
    return null;
  }
}

async function fetchSummary(): Promise<ProfileSummary | null> {
  try {
    const r = await fetch(`${ENGINE_URL}/profile/summary`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) return null;
    return (await r.json()) as ProfileSummary;
  } catch {
    return null;
  }
}

async function fetchInsights(): Promise<Insight | null> {
  try {
    const r = await fetch(`${ENGINE_URL}/insights`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) return null;
    return (await r.json()) as Insight;
  } catch {
    return null;
  }
}

function bar(score: number, width = 10): string {
  const filled = Math.max(0, Math.min(width, Math.round((score / 100) * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function formatSummary(scores: EngineScores, insights: string[]): string {
  if (scores.sessions_analyzed === 0) {
    return "DevProfile: nenhuma sessão analisada ainda. Continue usando o Claude Code — volte após algumas sessões.";
  }
  const lines: string[] = [
    `Score geral: ${scores.overall}/100  ${bar(scores.overall)}  (${scores.sessions_analyzed} sessões)`,
    "",
  ];
  for (const insight of insights.slice(0, 3)) {
    lines.push(`→ ${insight}`);
  }
  if (insights.length === 0) {
    lines.push("→ Continue usando o Claude Code para gerar insights personalizados.");
  }
  return lines.join("\n");
}

function formatScores(scores: EngineScores): string {
  if (scores.sessions_analyzed === 0) {
    return "DevProfile: nenhuma sessão analisada ainda.";
  }
  return [
    `Prompt quality  ${String(scores.prompt_quality).padStart(3)}  ${bar(scores.prompt_quality)}`,
    `Test maturity   ${String(scores.test_maturity).padStart(3)}  ${bar(scores.test_maturity)}`,
    `Tech breadth    ${String(scores.tech_breadth).padStart(3)}  ${bar(scores.tech_breadth)}`,
    `Growth rate     ${String(scores.growth_rate).padStart(3)}  ${bar(scores.growth_rate)}`,
    "",
    `Overall         ${String(scores.overall).padStart(3)}`,
  ].join("\n");
}

function formatInsight(insights: string[]): string {
  const next = insights[0];
  if (!next) return "DevProfile: nenhum insight disponível no momento.";
  return `→ ${next}`;
}

function formatFull(scores: EngineScores, summary: ProfileSummary | null, insights: string[]): string {
  if (scores.sessions_analyzed === 0) {
    return "DevProfile: nenhuma sessão analisada ainda. Continue usando o Claude Code.";
  }

  const lines: string[] = [
    `Score geral: ${scores.overall}/100  ${bar(scores.overall)}  (${scores.sessions_analyzed} sessões)`,
    "",
    `Prompt quality  ${String(scores.prompt_quality).padStart(3)}  ${bar(scores.prompt_quality)}`,
    `Test maturity   ${String(scores.test_maturity).padStart(3)}  ${bar(scores.test_maturity)}`,
    `Tech breadth    ${String(scores.tech_breadth).padStart(3)}  ${bar(scores.tech_breadth)}`,
    `Growth rate     ${String(scores.growth_rate).padStart(3)}  ${bar(scores.growth_rate)}`,
  ];

  if (summary && summary.total_sessions > 0) {
    lines.push("");
    if (summary.platforms.length > 0) {
      lines.push(`Plataformas  ${summary.platforms.slice(0, 5).join(" · ")}`);
    }
    if (summary.ecosystems.length > 0) {
      lines.push(`Ecosystems   ${summary.ecosystems.slice(0, 6).join(" · ")}`);
    }
    const workflows = Object.entries(summary.workflow_distribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k} (${Math.round(v * 100)}%)`)
      .join(" · ");
    if (workflows) lines.push(`Workflow     ${workflows}`);
  }

  if (insights.length > 0) {
    lines.push("");
    for (const insight of insights.slice(0, 3)) {
      lines.push(`→ ${insight}`);
    }
  }

  return lines.join("\n");
}

export const devprofileTool: McpTool = {
  name: "devprofile",
  description: "Exibe o perfil de desenvolvedor baseado no uso do Claude",
  inputSchema: {
    type: "object",
    properties: {
      view: { type: "string", enum: ["summary", "scores", "insight", "full"] },
    },
  },
  async handler(args) {
    const view = (args.view as string) ?? "summary";

    const scores = await fetchScores();
    if (!scores) {
      return "DevProfile: engine not running. Start it with `devprofile start`.";
    }

    if (view === "scores") {
      return formatScores(scores);
    }

    if (view === "insight") {
      const insightData = await fetchInsights();
      return formatInsight(insightData?.insights ?? []);
    }

    if (view === "full") {
      const [summary, insightData] = await Promise.all([fetchSummary(), fetchInsights()]);
      return formatFull(scores, summary, insightData?.insights ?? []);
    }

    // summary (default)
    const insightData = await fetchInsights();
    return formatSummary(scores, insightData?.insights ?? []);
  },
};

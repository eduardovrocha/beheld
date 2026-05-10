import type { ProfileData, Scores, ViewFlags } from "../types";

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";

function color(score: number): string {
  if (score >= 75) return GREEN;
  if (score >= 50) return YELLOW;
  return RED;
}

function bold(s: string): string {
  return `${BOLD}${s}${RESET}`;
}

function bar(score: number, width = 20): string {
  const filled = Math.max(0, Math.min(width, Math.round((score / 100) * width)));
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

function scoreLine(label: string, score: number): string {
  const c = color(score);
  const padded = label.padEnd(18);
  return `  ${padded} ${c}${String(score).padStart(3)}${RESET}  ${c}${bar(score)}${RESET}`;
}

// ── renderProfile ─────────────────────────────────────────────────────────────

export function renderProfile(data: ProfileData, flags: ViewFlags): string {
  if (flags.json) {
    return JSON.stringify(data, null, 2);
  }

  const { scores, summary, insights, session } = data;

  if (flags.scoresOnly) {
    if (!scores) return "0 0 0 0";
    return [
      scores.prompt_quality,
      scores.test_maturity,
      scores.tech_breadth,
      scores.growth_rate,
    ].join(" ");
  }

  const lines: string[] = [];

  lines.push("");
  lines.push(bold(`${CYAN}DevProfile${RESET}${BOLD} — seu perfil de desenvolvedor${RESET}`));
  lines.push("");

  // ── Scores ─────────────────────────────────────────────────────────────────
  if (scores) {
    if (scores.sessions_analyzed === 0) {
      lines.push(
        `${DIM}Nenhuma sessão analisada ainda. Continue usando o Claude Code — volte após algumas sessões.${RESET}`,
      );
    } else {
      lines.push(bold("Scores"));
      lines.push(scoreLine("Prompt quality", scores.prompt_quality));
      lines.push(scoreLine("Test maturity", scores.test_maturity));
      lines.push(scoreLine("Tech breadth", scores.tech_breadth));
      lines.push(scoreLine("Growth rate", scores.growth_rate));
      lines.push("");
      const oc = color(scores.overall);
      lines.push(
        `  ${bold("Overall")}                ${oc}${scores.overall}/100${RESET}  ${DIM}(${scores.sessions_analyzed} sessões)${RESET}`,
      );
    }
  } else {
    lines.push(`${DIM}Engine offline — rode ${bold("devprofile start")} para ver os scores.${RESET}`);
  }

  lines.push("");

  // ── Summary ────────────────────────────────────────────────────────────────
  if (summary && summary.total_sessions > 0) {
    lines.push(bold("Perfil técnico"));
    if (summary.ecosystems.length > 0) {
      lines.push(`  ${DIM}Ecossistemas:${RESET}  ${summary.ecosystems.slice(0, 6).join(", ")}`);
    }
    if (summary.platforms.length > 0) {
      lines.push(`  ${DIM}Plataformas:${RESET}   ${summary.platforms.slice(0, 5).join(", ")}`);
    }
    const topWorkflow = Object.entries(summary.workflow_distribution)[0];
    if (topWorkflow) {
      lines.push(`  ${DIM}Workflow:${RESET}      ${topWorkflow[0]} (${Math.round(topWorkflow[1] * 100)}%)`);
    }
    lines.push(`  ${DIM}Total sessões:${RESET} ${summary.total_sessions}`);
    lines.push("");
  }

  // ── Insights ───────────────────────────────────────────────────────────────
  if (insights.length > 0) {
    lines.push(bold("Insights"));
    for (const insight of insights) {
      lines.push(`  • ${insight}`);
    }
    lines.push("");
  }

  // ── Session ────────────────────────────────────────────────────────────────
  if (session?.active) {
    lines.push(bold("Sessão atual"));
    lines.push(`  Duração: ${session.duration_minutes ?? 0} min`);
    lines.push(`  Eventos: ${session.event_count ?? 0}`);
    if (session.tools_used?.length) {
      lines.push(`  Tools: ${session.tools_used.join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

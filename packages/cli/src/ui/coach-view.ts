import type { CoachPayload } from "../client/engine-client";
import { RESET, BOLD, DIM, GREEN, YELLOW, RED } from "./styles";

function severityColor(severity: string): string {
  if (severity === "high") return RED;
  if (severity === "medium") return YELLOW;
  return GREEN;
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s;
  return s + " ".repeat(width - s.length);
}

export function renderCoachText(payload: CoachPayload): string {
  if (payload.data_freshness === "insufficient") {
    const got = payload.scores.sessions_analyzed;
    const need = Math.max(0, 3 - got);
    const verbo = need === 1 ? "falta" : "faltam";
    const subst = need === 1 ? "sessão" : "sessões";
    return [
      "",
      `  ${BOLD}Beheld · coach${RESET} ${DIM}(coletando dados)${RESET}`,
      "",
      `  ${got}/3 sessões — ${verbo} ${need} ${subst}.`,
      `  ${DIM}Continue usando o Claude Code; o coaching será habilitado automaticamente.${RESET}`,
      "",
    ].join("\n");
  }

  const lines: string[] = [
    "",
    `  ${BOLD}Beheld · coach${RESET} ${DIM}(v${payload.version} · ${payload.data_freshness})${RESET}`,
    "",
  ];

  if (payload.patterns.length === 0) {
    lines.push(`  ${DIM}Sem padrões observáveis no momento — siga normalmente.${RESET}`);
    lines.push("");
  } else {
    lines.push(`  ${BOLD}Padrões (${payload.patterns.length}):${RESET}`);
    lines.push("");
    for (const p of payload.patterns) {
      const sevC = severityColor(p.severity);
      const tag = `[${pad(p.severity, 6)}]`;
      const conf = `conf ${p.confidence.toFixed(2)}`;
      const applies = p.applies_to_current_session ? "✓" : " ";
      lines.push(`  ${applies} ${sevC}${tag}${RESET} ${BOLD}${p.label}${RESET}  ${DIM}${conf}${RESET}`);
      lines.push(`     ${DIM}${p.evidence}${RESET}`);
      lines.push("");
    }
  }

  const ctx = payload.context_for_session;
  if (ctx.ecosystems_recent.length > 0 || ctx.session_phase_hint !== "unknown") {
    const ecos = ctx.ecosystems_recent.slice(0, 3).join(" · ") || "—";
    lines.push(`  ${DIM}Contexto: ${ctx.session_phase_hint} · ${ecos}${RESET}`);
  }

  lines.push(
    `  ${DIM}Score: ${payload.scores.overall}/100 · ${payload.scores.sessions_analyzed} sessões${RESET}`,
  );
  lines.push("");

  return lines.join("\n");
}

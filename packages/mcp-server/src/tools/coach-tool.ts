import type { McpTool } from "./types";

const ENGINE_URL = process.env.BEHELD_ENGINE_URL ?? "http://127.0.0.1:7338";

const VALID_HINTS = new Set([
  "feature_work",
  "debug",
  "refactor",
  "exploration",
  "unknown",
]);

const JSON_OPEN = "---BEHELD-JSON---";
const JSON_CLOSE = "---END-JSON---";

interface Pattern {
  id: string;
  label: string;
  evidence: string;
  metric: Record<string, number>;
  confidence: number;
  trend_30d: string;
  severity: string;
  applies_to_current_session: boolean;
}

interface CoachPayload {
  version: number;
  as_of: string;
  data_freshness: "live" | "cache" | "insufficient";
  scores: {
    overall: number;
    sessions_analyzed: number;
    [k: string]: unknown;
  };
  context_for_session: {
    current_project_category: string;
    ecosystems_recent: string[];
    session_phase_hint: string;
  };
  patterns: Pattern[];
  coaching_guidance: {
    tone: string;
    must: string[];
    must_not: string[];
    good_example: string;
    bad_example: string;
  };
  suggested_followups: string[];
}

async function fetchCoachPayload(hint: string): Promise<CoachPayload | null> {
  try {
    const r = await fetch(
      `${ENGINE_URL}/coach?session_hint=${encodeURIComponent(hint)}`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!r.ok) return null;
    return (await r.json()) as CoachPayload;
  } catch {
    return null;
  }
}

function wrap(text: string, payload: CoachPayload): string {
  return [
    text,
    "",
    JSON_OPEN,
    JSON.stringify(payload, null, 2),
    JSON_CLOSE,
  ].join("\n");
}

function formatInsufficient(payload: CoachPayload): string {
  const got = payload.scores.sessions_analyzed;
  const need = Math.max(0, 3 - got);
  const verbo = need === 1 ? "falta" : "faltam";
  const subst = need === 1 ? "sessão" : "sessões";
  const text = [
    "Beheld ainda coletando dados.",
    "",
    `${got}/3 sessões — ${verbo} ${need} ${subst}.`,
    "Continue usando o Claude Code; o coaching será habilitado automaticamente.",
  ].join("\n");
  return wrap(text, payload);
}

function formatLive(payload: CoachPayload): string {
  const lines: string[] = [
    `Beheld · coaching context (v${payload.version})`,
    "",
  ];

  if (payload.patterns.length === 0) {
    lines.push("Sem padrões observáveis no momento — siga normalmente.");
  } else {
    lines.push(`Padrões detectados (${payload.patterns.length}):`);
    for (const p of payload.patterns) {
      lines.push(
        `  • ${p.label.padEnd(38)} confiança ${p.confidence.toFixed(2)}  · ${p.evidence}`,
      );
    }
  }
  lines.push("");
  lines.push(
    `Score geral: ${payload.scores.overall}/100 · ${payload.scores.sessions_analyzed} sessões · ${payload.data_freshness}`,
  );

  return wrap(lines.join("\n"), payload);
}

export const beheldCoachTool: McpTool = {
  name: "beheld_coach",
  description: [
    "Retorna padrões observados no histórico real do desenvolvedor (sequências de tools, cadência de testes, ecossistemas) com instruções de como apresentar feedback acionável.",
    "",
    "QUANDO CHAMAR:",
    "- O usuário pediu feedback sobre como está programando ('como estou indo?', 'tô fazendo certo?', 'me dá um diagnóstico').",
    "- Início de uma feature/task nova quando o ecossistema da sessão atual bate com padrões conhecidos.",
    "- Usuário invocou /beheld coach explicitamente.",
    "",
    "QUANDO NÃO CHAMAR:",
    "- Tarefa puramente factual ou de execução ('rode os testes', 'leia esse arquivo').",
    "- Já chamou nesta conversa nas últimas ~20 mensagens.",
    "- Sessão de debug ativa (usuário tentando resolver erro) — feedback de estilo aqui interrompe.",
    "",
    "COMO USAR O RETORNO:",
    "- Leia o bloco entre ---BEHELD-JSON--- e ---END-JSON--- como contrato.",
    "- Siga `coaching_guidance.must` e evite tudo em `must_not`.",
    "- Apresente NO MÁXIMO um padrão, escolhido por (applies_to_current_session AND confidence >= 0.6) ORDER BY severity DESC.",
    "- Se nenhum padrão passar no filtro, não mencione o tool — siga a conversa normalmente.",
    "- Nunca exponha o JSON cru ao usuário; o texto acima do delimitador é o que o usuário deve ver se quiser ver o estado bruto.",
  ].join("\n"),
  inputSchema: {
    type: "object",
    properties: {
      session_hint: {
        type: "string",
        description:
          "Fase atual da sessão: 'feature_work', 'debug', 'refactor', 'exploration' ou 'unknown'. O engine usa para calcular applies_to_current_session.",
        enum: ["feature_work", "debug", "refactor", "exploration", "unknown"],
      },
    },
  },
  async handler(args) {
    const raw = (args.session_hint as string | undefined) ?? "unknown";
    const hint = VALID_HINTS.has(raw) ? raw : "unknown";

    const payload = await fetchCoachPayload(hint);
    if (!payload) {
      return "Beheld: engine offline. Tente novamente em alguns segundos ou execute: beheld start.";
    }
    if (payload.data_freshness === "insufficient") {
      return formatInsufficient(payload);
    }
    return formatLive(payload);
  },
};

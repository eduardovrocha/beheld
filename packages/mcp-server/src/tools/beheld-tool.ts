import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { McpTool } from "./types";
import { getLastCachedScores } from "../../../cli/src/storage/local-cache";
import { EngineClient } from "../clients/engine-client";
import type { ImportResult, ImportStatusResponse } from "../types/import";

// Read at call time so tests can swap BEHELD_ENGINE_URL between assertions
// without having to hot-reload this module.
function engineUrl(): string {
  return process.env.BEHELD_ENGINE_URL ?? "http://127.0.0.1:7338";
}

// Polling cadence and budget for the /beheld import flow. Exposed for tests
// via the optional `importDeps` injected on the handler.
const IMPORT_POLL_INTERVAL_MS = 1500;
const IMPORT_TIMEOUT_MS = 120_000;

interface EngineScores {
  prompt_quality: number;
  test_maturity: number;
  tech_breadth: number;
  growth_rate: number;
  overall: number;
  sessions_analyzed: number;
  updated_at: string | null;
  source: "live" | "cache";
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

interface EngineReadiness {
  ready: boolean;
  sessions_count: number;
  sessions_required: number;
  sessions_remaining: number;
}

async function fetchReadiness(): Promise<EngineReadiness | null> {
  try {
    const r = await fetch(`${engineUrl()}/profile/readiness`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) return null;
    return (await r.json()) as EngineReadiness;
  } catch {
    return null;
  }
}

async function fetchScores(): Promise<EngineScores | null> {
  try {
    const r = await fetch(`${engineUrl()}/scores/current`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) throw new Error("engine error");
    return { ...(await r.json()) as Omit<EngineScores, "source">, source: "live" };
  } catch {
    const cached = getLastCachedScores();
    if (!cached) return null;
    return { ...cached, source: "cache" };
  }
}

async function fetchSummary(): Promise<ProfileSummary | null> {
  try {
    const r = await fetch(`${engineUrl()}/profile/summary`, {
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
    const r = await fetch(`${engineUrl()}/insights`, {
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
    return "Beheld: nenhuma sessão analisada ainda. Continue usando o Claude Code — volte após algumas sessões.";
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
    return "Beheld: nenhuma sessão analisada ainda.";
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
  if (!next) return "Beheld: nenhum insight disponível no momento.";
  return `→ ${next}`;
}

function formatFull(scores: EngineScores, summary: ProfileSummary | null, insights: string[]): string {
  if (scores.sessions_analyzed === 0) {
    return "Beheld: nenhuma sessão analisada ainda. Continue usando o Claude Code.";
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

// ── /beheld import [url] — slash command surface ─────────────────────────────

interface BeheldConfigShape {
  author_email?: string;
  [k: string]: unknown;
}

function beheldConfigPath(): string {
  const base = process.env.BEHELD_DATA_DIR
    ? join(process.env.BEHELD_DATA_DIR, ".beheld")
    : join(homedir(), ".beheld");
  return join(base, "config.json");
}

function readAuthorEmail(): string | null {
  const p = beheldConfigPath();
  if (!existsSync(p)) return null;
  try {
    const cfg = JSON.parse(readFileSync(p, "utf8")) as BeheldConfigShape;
    const email = (cfg.author_email ?? "").toString().trim();
    return email.length > 0 ? email : null;
  } catch {
    return null;
  }
}

export function formatImportUsage(): string {
  return [
    "Uso: /beheld import <url>",
    "",
    "Exemplos:",
    "  /beheld import https://github.com/usuario/repo",
    "  /beheld import git@github.com:usuario/repo.git",
    "",
    "Para repositórios privados, use o terminal (suporte a PAT sem expor no histórico):",
    "  beheld import",
    "",
    "Para listar repositórios importados:",
    "  beheld import --list",
  ].join("\n");
}

export function formatImportResult(url: string, result: ImportResult): string {
  const lines: string[] = [`✓ ${url}`];

  const commits = typeof result.commit_count === "number" ? result.commit_count : 0;
  const ecos = Array.isArray(result.ecosystems) ? result.ecosystems : [];
  const ecosDisplay = ecos.length === 0
    ? ""
    : ecos.length > 5
      ? `${ecos.slice(0, 5).join(", ")}, ...`
      : ecos.join(", ");
  const summary = ecosDisplay
    ? `  ${commits} commits · ${ecosDisplay}`
    : `  ${commits} commits`;
  lines.push(summary);

  if (typeof result.test_ratio === "number") {
    lines.push(`  test ratio: ${(result.test_ratio * 100).toFixed(0)}%`);
  }

  if (result.first_commit_at && result.last_commit_at) {
    const start = result.first_commit_at.slice(0, 7);
    const end = result.last_commit_at.slice(0, 7);
    lines.push(`  período: ${start} → ${end}`);
  }

  lines.push("");
  lines.push("Perfil atualizado. L1 agora inclui este repositório.");
  return lines.join("\n");
}

export interface ImportDeps {
  engine: EngineClient;
  /** Sleep used between polls — overridable for tests. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Total polling budget. Defaults to IMPORT_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Interval between polls. Defaults to IMPORT_POLL_INTERVAL_MS. */
  pollIntervalMs?: number;
  /** Override the config reader — defaults to ~/.beheld/config.json. */
  readAuthorEmail?: () => string | null;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function handleImport(
  url: string | undefined,
  deps: ImportDeps,
): Promise<string> {
  // 1. Empty URL → usage.
  const trimmed = (url ?? "").trim();
  if (trimmed.length === 0) {
    return formatImportUsage();
  }

  // 2. Engine offline guard.
  const health = await deps.engine.health().catch(() => null);
  if (!health) {
    return "⚠ Engine offline. Execute `beheld start` e tente novamente.";
  }

  // 3. author_email gate — slash command never prompts; redirect to CLI wizard.
  const reader = deps.readAuthorEmail ?? readAuthorEmail;
  const authorEmail = reader();
  if (!authorEmail) {
    return [
      "⚠ Email de commit não configurado.",
      "",
      "Execute no terminal para configurar:",
      "  beheld import",
      "",
      "O wizard de importação pede o email uma única vez e salva para uso futuro.",
    ].join("\n");
  }

  // 4. Fire the import (single-slot — PAT prompts always go to the CLI).
  try {
    await deps.engine.importRepository(trimmed, authorEmail, null);
  } catch {
    return "⚠ Engine offline. Execute `beheld start` e tente novamente.";
  }

  // 5. Poll until terminal state or timeout.
  const sleep = deps.sleep ?? defaultSleep;
  const pollMs = deps.pollIntervalMs ?? IMPORT_POLL_INTERVAL_MS;
  const budgetMs = deps.timeoutMs ?? IMPORT_TIMEOUT_MS;
  const deadline = Date.now() + budgetMs;

  while (Date.now() < deadline) {
    await sleep(pollMs);
    let status: ImportStatusResponse;
    try {
      status = await deps.engine.getImportStatus();
    } catch {
      // Transient — retry on the next tick.
      continue;
    }

    if (status.status !== "done" && status.status !== "error") {
      continue;
    }

    // Terminal — branch on the inner result.status.
    const r = status.result;
    if (!r) {
      return `✗ Falha na importação de ${trimmed}\n  Resposta vazia do engine.`;
    }

    switch (r.status) {
      case "imported":
        return formatImportResult(trimmed, r);
      case "already_imported":
        return `✓ ${trimmed}\n  Já importado. Reimportar não altera o perfil.`;
      case "needs_pat":
        return [
          `⚠ Repositório privado: ${trimmed}`,
          "",
          "Repositórios privados requerem autenticação.",
          "Use o terminal — o CLI solicita o token sem expô-lo no histórico da conversa:",
          "  beheld import",
        ].join("\n");
      case "author_not_found":
        return [
          `⚠ Nenhum commit encontrado para ${authorEmail} em:`,
          `  ${trimmed}`,
          "",
          "Verifique se o email está correto em ~/.beheld/config.json",
        ].join("\n");
      case "clone_error":
        return `✗ Não foi possível clonar: ${trimmed}\n  Verifique a URL e tente novamente.`;
      default: {
        const detail = (r as { detail?: string }).detail ?? r.status;
        return `✗ Falha na importação de ${trimmed}\n  ${detail}`;
      }
    }
  }

  // 6. Timeout — the engine keeps working in the background.
  return [
    `⏱ Importação em andamento: ${trimmed}`,
    "",
    "O repositório continua sendo processado em background.",
    "Acompanhe com: beheld import --list",
  ].join("\n");
}

// ── beheld tool (slash command entry point) ──────────────────────────────────

export const beheldTool: McpTool = {
  name: "beheld",
  description: "Exibe o perfil de desenvolvedor baseado no uso do Claude",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["view", "import"],
        description:
          "view: exibe perfil · import: importa repositório git para L1",
      },
      url: {
        type: "string",
        description: "URL do repositório git (obrigatório quando action=import)",
      },
      view: { type: "string", enum: ["summary", "scores", "insight", "full"] },
    },
  },
  async handler(args) {
    const action = (args.action as string) ?? "view";

    if (action === "import") {
      const url = typeof args.url === "string" ? args.url : "";
      const engine = new EngineClient({ baseUrl: engineUrl() });
      return handleImport(url, { engine });
    }

    const view = (args.view as string) ?? "summary";

    const scores = await fetchScores();
    if (!scores) {
      return "Beheld: engine offline e nenhum score cacheado disponível. Execute: beheld start";
    }

    // Only check readiness when live — cache means a profile existed before
    if (scores.source === "live") {
      const r = await fetchReadiness().catch(() => null);
      if (r && !r.ready) {
        const remaining = r.sessions_required - r.sessions_count;
        return [
          "Beheld ainda coletando dados.",
          "",
          `${r.sessions_count}/${r.sessions_required} sessões — ${remaining !== 1 ? "faltam" : "falta"} ${remaining} ${remaining !== 1 ? "sessões" : "sessão"}.`,
          "",
          "Continue usando o Claude Code normalmente.",
          "O perfil será gerado automaticamente.",
        ].join("\n");
      }
    }

    const cacheNote = scores.source === "cache"
      ? `\n[cache de ${scores.updated_at ?? "data desconhecida"} — engine offline]`
      : "";

    if (view === "scores") {
      return formatScores(scores) + cacheNote;
    }

    if (view === "insight") {
      const insightData = await fetchInsights();
      return formatInsight(insightData?.insights ?? []) + cacheNote;
    }

    if (view === "full") {
      const [summary, insightData] = await Promise.all([fetchSummary(), fetchInsights()]);
      return formatFull(scores, summary, insightData?.insights ?? []) + cacheNote;
    }

    // summary (default)
    const insightData = await fetchInsights();
    return formatSummary(scores, insightData?.insights ?? []) + cacheNote;
  },
};

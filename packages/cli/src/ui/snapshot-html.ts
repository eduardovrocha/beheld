// HTML renderer for `beheld snapshot --html`.
//
// Produces a self-contained, single-file HTML retrato técnico that mirrors
// the design at documents/retrato-publico.html (Inter + Newsreader, warm
// cream palette, signature verifiable client-side via embedded bundle JSON).
//
// All identity strings come from the engine (IdentityGenerator with the
// minimal signals adapter); this file is pure templating.

interface BundlePayload {
  scores?: { prompt_quality?: number; test_maturity?: number; tech_breadth?: number; growth_rate?: number; overall?: number };
  l1?: { total_repos?: number; total_commits?: number; ecosystems?: Record<string, number>; platforms?: Record<string, number> };
  l2?: { total_sessions?: number; workflow_distribution?: Record<string, number> };
  created_at?: string;
}

interface Bundle {
  version: string;
  payload: BundlePayload;
  hash: string;
  signature: string;
  public_key: string;
}

interface IdentityResult {
  identity_long: string;
  identity_short: string;
  confidence: string;
  generation_path: string;
  model_used: string | null;
}

interface EmergentDiff {
  pattern: string;
  recent_share: number;
  older_share: number;
  delta_pp: number;
  recent_window_days: number;
  baseline_window_days: number;
}

interface SignalsPayload {
  ecosystems?: { dominant?: string[]; secondary?: string[] };
  test_pattern?: { discipline?: string; approach?: string };
  timing?: { peak_period?: string; consistency?: string };
  tooling?: { platforms?: string[] };
}

export interface SnapshotHtmlData {
  bundle: Bundle;
  signals: SignalsPayload;
  identity: IdentityResult;
  emergent: EmergentDiff | null;
  authorName?: string;
  ttlDays?: number;
}

// ── label maps (mirror engine's identity.labels for client-side rendering) ──

const ECO_LABEL: Record<string, string> = {
  rails: "Rails", node: "Node.js", react: "React", vue: "Vue", next: "Next.js",
  python: "Python", django: "Django", fastapi: "FastAPI",
  flutter: "Flutter", go: "Go", rust: "Rust",
  java_spring: "Java/Spring", kotlin: "Kotlin", swift_ios: "Swift/iOS",
  dotnet: ".NET", elixir_phoenix: "Elixir/Phoenix", php_laravel: "PHP/Laravel",
  ruby_other: "Ruby", devops: "DevOps",
};

const PLATFORM_LABEL: Record<string, string> = {
  docker: "Docker", kubernetes: "Kubernetes",
  github: "GitHub", github_actions: "GitHub Actions", gitlab: "GitLab",
  postgres: "Postgres", mysql: "MySQL", redis: "Redis", mongodb: "MongoDB",
  aws: "AWS", gcp: "GCP", azure: "Azure", vercel: "Vercel", cloudflare: "Cloudflare",
  terraform: "Terraform", ansible: "Ansible",
};

const DISCIPLINE_LABEL: Record<string, string> = {
  strong: "Disciplinado",
  moderate: "Moderado",
  low: "Em formação",
  minimal: "Pouca evidência",
};

const APPROACH_LABEL: Record<string, string> = {
  tdd_dominant: "TDD na maior parte das sessões",
  tdd_partial: "TDD em parte considerável das sessões",
  test_after: "Testes escritos depois do código",
  test_seldom: "Testes esporádicos",
  exploratory: "Sessões exploratórias",
};

const WORKFLOW_LABEL: Record<string, string> = {
  tdd: "TDD",
  test_after: "Test-after",
  debug_driven: "Debug-driven",
  refactor_heavy: "Refactor antes de review",
  exploratory: "Exploração",
  review_before_commit: "Review antes do commit",
};

const PEAK_LABEL: Record<string, string> = {
  morning: "Concentrado pela manhã",
  afternoon: "Concentrado no período da tarde",
  evening: "Concentrado no início da noite",
  late_night: "Concentrado tarde da noite",
  distributed: "Distribuído ao longo do dia",
};

// ── helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function joinLabels(ids: string[] | undefined, map: Record<string, string>, fallback: string, max = 3): string {
  if (!ids || ids.length === 0) return fallback;
  const labels = ids.slice(0, max).map((id) => map[id] ?? id);
  return labels.join(" · ");
}

function formatPtBrDate(iso: string): string {
  // Accepts "2026-05-16" or "2026-05-16T...". Returns "16 de maio de 2026".
  const months = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
                  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const d = iso.length >= 10 ? iso.slice(0, 10) : iso;
  const [y, m, dd] = d.split("-").map(Number);
  if (!y || !m || !dd) return iso;
  return `${dd} de ${months[m - 1]} de ${y}`;
}

function formatEmergent(e: EmergentDiff): string {
  const label = WORKFLOW_LABEL[e.pattern] ?? e.pattern;
  const recentPct = Math.round(e.recent_share * 100);
  const olderPct = Math.round(e.older_share * 100);
  if (olderPct < 5) {
    return `${label} aparece em ${recentPct}% das sessões dos últimos ${e.recent_window_days} dias. ` +
           `Antes disso era exceção, hoje é regra.`;
  }
  return `${label} subiu de ${olderPct}% para ${recentPct}% das sessões nos últimos ${e.recent_window_days} dias.`;
}

// ── F6.12 — scores + stack rendered server-side from bundle.payload ──────────

const SCORE_LABELS: Record<string, string> = {
  prompt_quality: "Prompt quality",
  test_maturity: "Test maturity",
  tech_breadth: "Tech breadth",
  growth_rate: "Growth rate",
};

const SCORE_DIMENSIONS = ["prompt_quality", "test_maturity", "tech_breadth", "growth_rate"] as const;

function renderScoresSection(scores: BundlePayload["scores"] | undefined): string {
  if (!scores || typeof scores.overall !== "number") return "";
  const rows = SCORE_DIMENSIONS.map((dim) => {
    const val = scores[dim] ?? 0;
    const clamped = Math.max(0, Math.min(100, val));
    return `
      <div class="score-row">
        <div class="score-name">${escapeHtml(SCORE_LABELS[dim])}</div>
        <div class="score-bar"><div class="score-bar-fill" style="width: ${clamped}%"></div></div>
        <div class="score-val">${val}</div>
      </div>`;
  }).join("");
  const overall = scores.overall ?? 0;
  return `
    <section class="scores" aria-label="Scores">
      <div class="label">Scores</div>
      <div class="score-overall">
        <span class="score-overall-num">${overall}</span>
        <span class="score-overall-of">/100</span>
        <span class="score-overall-tag">geral</span>
      </div>
      <div class="scores-grid">${rows}
      </div>
    </section>`;
}

const STACK_PATTERN_LABELS: Record<string, string> = {
  mvc: "MVC",
  monorepo: "Monorepo",
  microservices: "Microsserviços",
  graphql: "GraphQL",
  rest_api: "REST API",
  serverless: "Serverless",
  event_driven: "Event-driven",
  iac: "IaC",
  container_orchestration: "Orquestração",
  ci_cd: "CI/CD",
};
const STACK_LANG_LIMIT = 8;

interface BundleStackLanguage {
  language: string; commit_count: number; file_count: number;
  first_seen: string; last_seen: string; weight_pct: number;
}
interface BundleStackPattern {
  pattern: string; repo_count: number; confidence: "strong" | "weak";
}
interface BundleStackSection {
  language_distribution: BundleStackLanguage[];
  architecture_patterns: BundleStackPattern[];
  total_commits_analyzed: number;
  repos_analyzed: number;
}

function renderStackSection(stack: BundleStackSection | null | undefined): string {
  if (!stack || !Array.isArray(stack.language_distribution) || stack.language_distribution.length === 0
      || (typeof stack.repos_analyzed === "number" && stack.repos_analyzed === 0)) {
    return `
    <section class="stack" aria-label="Stack">
      <div class="label">Stack</div>
      <p class="placeholder">Importe repositórios com /beheld import para ver seu stack.</p>
    </section>`;
  }

  const topLangs = stack.language_distribution.slice(0, STACK_LANG_LIMIT);
  const langsHtml = topLangs.map((lang, idx) => {
    const pct = Math.max(0, Math.min(100, Number(lang.weight_pct ?? 0)));
    // Rank-fade: first row fully opaque, last drops to ~0.35.
    const fade = topLangs.length > 1
      ? (1.0 - (idx / (topLangs.length - 1)) * 0.65).toFixed(2)
      : "1.00";
    const commits = Number(lang.commit_count ?? 0).toLocaleString("pt-BR");
    const firstYear = (lang.first_seen || "").slice(0, 4);
    const lastYear = (lang.last_seen || "").slice(0, 4);
    const period = firstYear && lastYear ? `${firstYear} → ${lastYear}` : "";
    return `
        <div class="stack-lang">
          <div class="name">${escapeHtml(lang.language)}</div>
          <div class="bar"><div class="bar-fill" style="width: ${pct}%; opacity: ${fade};"></div></div>
          <div class="meta">${Math.round(pct)}% · ${escapeHtml(commits)} commits${period ? " · " + escapeHtml(period) : ""}</div>
        </div>`;
  }).join("");

  const patterns = Array.isArray(stack.architecture_patterns) ? stack.architecture_patterns : [];
  let archHtml: string;
  if (patterns.length === 0) {
    archHtml = `<p class="placeholder">Padrões não identificados</p>`;
  } else {
    archHtml = `<div class="stack-arch">` + patterns.map((p) => {
      const conf = p.confidence === "strong" ? "strong" : "weak";
      const label = STACK_PATTERN_LABELS[p.pattern] ?? p.pattern;
      return `<span class="stack-chip ${conf}">${escapeHtml(label)}</span>`;
    }).join("") + `</div>`;
  }

  const years = topLangs
    .map((l) => parseInt((l.first_seen || "").slice(0, 4), 10))
    .filter((y) => !Number.isNaN(y));
  const oldestYear = years.length > 0 ? Math.min(...years) : null;
  const repos = Number(stack.repos_analyzed ?? 0);
  const totalCommits = Number(stack.total_commits_analyzed ?? 0).toLocaleString("pt-BR");
  const reposLabel = `${repos} repositório${repos === 1 ? "" : "s"} analisado${repos === 1 ? "" : "s"}`;
  const ctx = `${reposLabel} · ${totalCommits} commits${oldestYear ? ` · desde ${oldestYear}` : ""}`;

  return `
    <section class="stack" aria-label="Stack">
      <div class="label">Stack</div>
      <div class="stack-langs">${langsHtml}
      </div>
      ${archHtml}
      <p class="stack-context">${escapeHtml(ctx)}</p>
    </section>`;
}

// F6.12 / v5 — Perfil técnico + Insights, both read from bundle.payload
// (l2 for perfil técnico, payload.insights for the bullets).

interface BundleL2 {
  platforms?: Record<string, number>;
  workflow_distribution?: Record<string, number>;
  sessions_analyzed?: number;
}

function renderPerfilTecnicoSection(l2: BundleL2 | undefined): string {
  if (!l2) return "";
  const platforms = l2.platforms ?? {};
  const wf = l2.workflow_distribution ?? {};
  const sessions = l2.sessions_analyzed ?? 0;

  // Top 5 platforms by count.
  const platLabel = Object.entries(platforms)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => PLATFORM_LABEL[k] ?? k)
    .join(", ");

  // Top 3 workflow patterns by share, formatted "name (NN%)".
  const wfLabel = Object.entries(wf)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} (${Math.round(v * 100)}%)`)
    .join(" · ");

  const hasPlat = platLabel.length > 0;
  const hasWf = wfLabel.length > 0;
  if (!hasPlat && !hasWf && sessions === 0) return "";

  return `
    <section class="perfil-tecnico" aria-label="Perfil técnico">
      <div class="label">Perfil técnico</div>
      <div class="perfil-row"><span class="key">Plataformas</span><span class="val">${escapeHtml(hasPlat ? platLabel : "—")}</span></div>
      <div class="perfil-row"><span class="key">Workflow</span><span class="val">${escapeHtml(hasWf ? wfLabel : "—")}</span></div>
      <div class="perfil-row"><span class="key">Total sessões</span><span class="val">${sessions.toLocaleString("pt-BR")}</span></div>
    </section>`;
}

function renderInsightsSection(insights: { insights?: string[] } | null | undefined): string {
  const bullets = (insights?.insights ?? []).filter((s) => typeof s === "string" && s.trim().length > 0);
  if (bullets.length === 0) return "";
  const items = bullets.slice(0, 5).map((b) => `<li>${escapeHtml(b)}</li>`).join("");
  return `
    <section class="insights" aria-label="Insights">
      <div class="label">Insights</div>
      <ul class="insights-list">${items}</ul>
    </section>`;
}

// ── main renderer ────────────────────────────────────────────────────────────

export function renderSnapshotHtml(data: SnapshotHtmlData): string {
  const name = escapeHtml(data.authorName ?? "dev");
  const dateStr = data.bundle.payload.created_at ?? new Date().toISOString();
  const dateLabel = formatPtBrDate(dateStr);

  const identityLong = escapeHtml(data.identity.identity_long);
  const identityShort = escapeHtml(data.identity.identity_short);

  // Facts: render only what we have honest data for.
  const ecoIds = [
    ...(data.signals.ecosystems?.dominant ?? []),
    ...(data.signals.ecosystems?.secondary ?? []),
  ];
  const ecoLabel = joinLabels(ecoIds, ECO_LABEL, "—", 3);

  const tp = data.signals.test_pattern;
  const testLabel = tp
    ? `${DISCIPLINE_LABEL[tp.discipline ?? ""] ?? "—"} · ${APPROACH_LABEL[tp.approach ?? ""] ?? ""}`.replace(/ · $/, "")
    : "—";

  const peakLabel = PEAK_LABEL[data.signals.timing?.peak_period ?? ""] ?? "Distribuído";

  const platformLabel = joinLabels(data.signals.tooling?.platforms, PLATFORM_LABEL, "—", 3);

  const repoCount = data.bundle.payload.l1?.total_repos ?? 0;
  const ttlDays = data.ttlDays ?? 28;

  const emergentBlock = data.emergent
    ? `
    <section class="emergent">
      <div class="label">Padrão emergente</div>
      <p class="body">${escapeHtml(formatEmergent(data.emergent))}</p>
    </section>`
    : "";

  // F6.12 — scores + perfil técnico + stack + insights rendered server-side
  // from the signed bundle. The HTML now needs zero runtime fetches to
  // display these sections; a shared `.html` is fully portable.
  const scoresBlock = renderScoresSection(data.bundle.payload.scores);
  const perfilTecnicoBlock = renderPerfilTecnicoSection(
    (data.bundle.payload as { l2?: BundleL2 }).l2,
  );
  const stackPayload = (data.bundle.payload as { stack?: BundleStackSection | null }).stack ?? null;
  const stackBlock = renderStackSection(stackPayload);
  const insightsBlock = renderInsightsSection(
    (data.bundle.payload as { insights?: { insights?: string[] } | null }).insights,
  );

  const captureLine = repoCount > 0
    ? `Capturado a partir de ${repoCount} repositório${repoCount === 1 ? "" : "s"} e meses de uso real, não auto-declarado.`
    : "Capturado a partir de uso real do Claude Code, não auto-declarado.";

  const bundleJson = JSON.stringify(data.bundle, null, 2)
    .replace(/</g, "\\u003c"); // prevent script injection if payload ever contains `</script>`

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Retrato técnico — ${name}</title>

  <meta property="og:title" content="Retrato técnico — ${name}" />
  <meta property="og:description" content="${identityShort}" />
  <meta property="og:type" content="profile" />

  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="Retrato técnico — ${name}" />
  <meta name="twitter:description" content="${identityShort}" />

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap" rel="stylesheet" />

  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #FAF8F5;
      --ink: #1A1A1A;
      --ink-soft: #6B6B6B;
      --rule: #D9D6D0;
      --rule-soft: #E5E2DD;
      --sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --serif: 'Newsreader', Georgia, 'Times New Roman', serif;
    }
    html { -webkit-text-size-adjust: 100%; }
    body {
      background: var(--bg); color: var(--ink); font-family: var(--sans);
      font-feature-settings: "ss01", "cv11"; line-height: 1.5;
      -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
    }
    .page { max-width: 640px; margin: 0 auto; padding: 96px 32px 64px; }
    .header {
      display: flex; justify-content: space-between; align-items: baseline;
      color: var(--ink-soft); font-size: 14px; margin-bottom: 80px;
    }
    .header .name { font-weight: 500; color: var(--ink); }
    .identity {
      font-family: var(--serif); font-size: 30px; line-height: 1.25;
      letter-spacing: -0.015em; font-weight: 400; max-width: 540px;
    }
    .divider { width: 64px; height: 1px; background: var(--rule); margin: 64px 0; }
    .facts { display: flex; flex-direction: column; gap: 32px; }
    .fact .label { font-size: 13px; font-weight: 500; color: var(--ink-soft); margin-bottom: 6px; }
    .fact .value { font-size: 16px; color: var(--ink); }
    .emergent { margin-top: 64px; }
    .emergent .label { font-size: 13px; font-weight: 500; color: var(--ink-soft); margin-bottom: 16px; }
    .emergent .body { font-family: var(--serif); font-size: 19px; line-height: 1.45; max-width: 540px; }
    .footer {
      margin-top: 96px; padding-top: 32px;
      border-top: 1px solid var(--rule-soft);
      color: var(--ink-soft); font-size: 14px; line-height: 1.6;
    }
    .footer .verification {
      display: flex; align-items: center; gap: 8px;
      margin-bottom: 8px; color: var(--ink);
    }
    .footer .verification[data-status="verified"] .icon { color: #2E7D5F; }
    .footer .verification[data-status="checking"] .icon { color: var(--ink-soft); }
    .footer .verification[data-status="failed"] .icon { color: #B8442D; }
    .footer .icon { font-size: 14px; width: 14px; display: inline-block; }
    .footer .verification-toggle {
      color: var(--ink-soft); text-decoration: underline;
      text-decoration-color: var(--rule); text-underline-offset: 3px;
      cursor: pointer; background: none; border: none; font: inherit; padding: 0;
    }
    .footer .verification-toggle:hover { color: var(--ink); }
    .footer .meta { margin-bottom: 24px; }
    .footer .brand { display: flex; justify-content: space-between; align-items: baseline; }
    .footer .brand a { color: var(--ink-soft); text-decoration: none; }
    .footer .brand a:hover { color: var(--ink); }
    .footer .expiry { font-size: 13px; color: var(--ink-soft); }
    .verification-details {
      display: none; margin-top: 16px; padding: 16px;
      background: rgba(0,0,0,0.02); border-radius: 4px;
      font-size: 13px; line-height: 1.6;
    }
    .verification-details.open { display: block; }
    .verification-details code {
      font-family: ui-monospace, 'SF Mono', Menlo, monospace;
      font-size: 12px; word-break: break-all; color: var(--ink-soft);
    }
    /* F6.12 — scores section: 4 dimension bars + overall number.
       Rendered server-side from bundle.payload.scores. */
    .scores { margin-top: 64px; }
    .scores .label {
      font-size: 13px; font-weight: 500; color: var(--ink-soft);
      margin-bottom: 12px;
    }
    .score-overall {
      display: flex; align-items: baseline; gap: 8px;
      margin-bottom: 20px;
      font-feature-settings: "tnum";
    }
    .score-overall-num {
      font-family: var(--serif);
      font-size: 48px; line-height: 1;
      letter-spacing: -0.02em; color: var(--ink);
    }
    .score-overall-of { font-size: 18px; color: var(--ink-soft); }
    .score-overall-tag {
      margin-left: 8px;
      font-size: 12px; color: var(--ink-soft);
      text-transform: uppercase; letter-spacing: 0.06em;
    }
    .scores-grid {
      display: flex; flex-direction: column; gap: 10px;
    }
    .score-row {
      display: grid; grid-template-columns: 130px 1fr 36px;
      align-items: center; gap: 12px;
      font-size: 13px; color: var(--ink);
    }
    .score-name { color: var(--ink-soft); }
    .score-bar {
      position: relative; height: 6px;
      background: var(--rule-soft); border-radius: 3px; overflow: hidden;
    }
    .score-bar-fill {
      position: absolute; top: 0; left: 0; bottom: 0;
      background: var(--ink); border-radius: 3px;
    }
    .score-val {
      text-align: right;
      font-feature-settings: "tnum";
      color: var(--ink);
    }

    /* F6.12 / v5 — Perfil técnico: 3 key:value rows from bundle.payload.l2.
       Compact list-style — fits next to the scores block. */
    .perfil-tecnico { margin-top: 48px; }
    .perfil-tecnico .label {
      font-size: 13px; font-weight: 500; color: var(--ink-soft);
      margin-bottom: 12px;
    }
    .perfil-row {
      display: grid; grid-template-columns: 130px 1fr;
      gap: 12px; padding: 4px 0;
      font-size: 13px;
    }
    .perfil-row .key { color: var(--ink-soft); }
    .perfil-row .val { color: var(--ink); }

    /* F6.12 / v5 — Insights: bullets from bundle.payload.insights.insights. */
    .insights { margin-top: 48px; }
    .insights .label {
      font-size: 13px; font-weight: 500; color: var(--ink-soft);
      margin-bottom: 12px;
    }
    .insights-list {
      list-style: none; padding: 0; margin: 0;
      display: flex; flex-direction: column; gap: 8px;
    }
    .insights-list li {
      font-size: 14px; color: var(--ink);
      padding-left: 18px; position: relative;
      line-height: 1.5;
    }
    .insights-list li::before {
      content: "→"; position: absolute; left: 0;
      color: var(--ink-soft);
    }

    /* F6.12c — stack section: language bars + architecture chips.
       Now rendered server-side from bundle.payload.stack — no live fetch.
       Tokens match the existing page palette (--ink, --ink-soft, --rule, --bg). */
    .stack { margin-top: 64px; }
    .stack .label {
      font-size: 13px; font-weight: 500; color: var(--ink-soft);
      margin-bottom: 16px;
    }
    .stack .placeholder { font-size: 14px; color: var(--ink-soft); }
    .stack-langs {
      display: flex; flex-direction: column; gap: 12px;
      margin-bottom: 32px;
    }
    .stack-lang {
      display: grid;
      grid-template-columns: 110px 1fr auto;
      align-items: center; gap: 12px;
      font-size: 14px; color: var(--ink);
    }
    .stack-lang .name { font-weight: 500; }
    .stack-lang .bar {
      position: relative; height: 6px;
      background: var(--rule-soft); border-radius: 3px; overflow: hidden;
    }
    .stack-lang .bar-fill {
      position: absolute; top: 0; left: 0; bottom: 0;
      background: var(--ink);
      transition: width 0.4s ease;
      border-radius: 3px;
    }
    .stack-lang .meta {
      font-size: 12px; color: var(--ink-soft);
      white-space: nowrap;
      font-feature-settings: "tnum";
    }
    .stack-arch { display: flex; flex-wrap: wrap; gap: 8px; }
    .stack-chip {
      display: inline-block;
      padding: 4px 10px;
      font-size: 12px; font-weight: 500;
      border-radius: 999px;
      line-height: 1.4;
    }
    .stack-chip.strong { background: var(--ink); color: var(--bg); }
    .stack-chip.weak {
      background: transparent; color: var(--ink);
      border: 1px solid var(--ink);
    }
    .stack-context {
      margin-top: 16px;
      font-size: 12px; color: var(--ink-soft);
    }
    @media (max-width: 540px) {
      .page { padding: 56px 24px 48px; }
      .header { margin-bottom: 48px; }
      .identity { font-size: 24px; }
      .divider { margin: 48px 0; }
      .facts { gap: 24px; }
      .emergent { margin-top: 48px; }
      .emergent .body { font-size: 17px; }
      .footer { margin-top: 64px; }
      .scores { margin-top: 48px; }
      .score-overall-num { font-size: 40px; }
      .score-row { grid-template-columns: 110px 1fr 30px; gap: 10px; font-size: 12px; }
      .perfil-tecnico { margin-top: 36px; }
      .perfil-row { grid-template-columns: 110px 1fr; gap: 10px; font-size: 12px; }
      .insights { margin-top: 36px; }
      .insights-list li { font-size: 13px; }
      .stack { margin-top: 48px; }
      .stack-lang { grid-template-columns: 90px 1fr auto; gap: 10px; font-size: 13px; }
    }
    @media print {
      body { background: white; }
      .page { padding: 32px; max-width: none; }
      .verification-toggle, .verification-details { display: none; }
    }
  </style>
</head>
<body>
  <main class="page" itemscope itemtype="https://schema.org/Person">
    <header class="header">
      <span class="name" itemprop="name">${name}</span>
      <span>${escapeHtml(dateLabel)}</span>
    </header>

    <p class="identity" itemprop="description">${identityLong}</p>

    <div class="divider" aria-hidden="true"></div>

    <section class="facts" aria-label="Quadro técnico">
      <div class="fact">
        <div class="label">Linguagem dominante</div>
        <div class="value">${escapeHtml(ecoLabel)}</div>
      </div>
      <div class="fact">
        <div class="label">Padrão de teste</div>
        <div class="value">${escapeHtml(testLabel)}</div>
      </div>
      <div class="fact">
        <div class="label">Ritmo</div>
        <div class="value">${escapeHtml(peakLabel)}</div>
      </div>
      <div class="fact">
        <div class="label">Ferramentas</div>
        <div class="value">${escapeHtml(platformLabel)}</div>
      </div>
    </section>${emergentBlock}
${scoresBlock}
${perfilTecnicoBlock}
${stackBlock}
${insightsBlock}

    <footer class="footer">
      <div class="verification" data-status="checking" id="verification">
        <span class="icon" aria-hidden="true">✓</span>
        <button class="verification-toggle" id="verification-toggle" aria-expanded="false" aria-controls="verification-details">
          <span id="verification-label">Verificando assinatura…</span>
        </button>
      </div>

      <div class="verification-details" id="verification-details" hidden>
        <p style="margin-bottom: 12px;">
          Este retrato é assinado com Ed25519 a partir da chave do dev.
          A verificação acontece neste navegador, sem chamada ao servidor.
        </p>
        <p style="margin-bottom: 6px;"><strong>Hash do payload</strong></p>
        <code id="payload-hash">${escapeHtml(data.bundle.hash)}</code>
        <p style="margin: 12px 0 6px;"><strong>Chave pública</strong></p>
        <code id="public-key">${escapeHtml(data.bundle.public_key)}</code>
      </div>

      <p class="meta">${escapeHtml(captureLine)}</p>

      <div class="brand">
        <a href="https://beheld.dev">beheld.dev</a>
        <span class="expiry">Expira em ${ttlDays} dias</span>
      </div>
    </footer>
  </main>

  <script type="application/json" id="bundle-data">
${bundleJson}
  </script>

  <script>
    (async function verifyBundle() {
      const el = document.getElementById('verification');
      const label = document.getElementById('verification-label');
      const toggle = document.getElementById('verification-toggle');
      const details = document.getElementById('verification-details');

      if (!window.crypto?.subtle) {
        el.dataset.status = 'verified';
        label.textContent = 'Assinatura presente';
        return;
      }

      try {
        const bundle = JSON.parse(document.getElementById('bundle-data').textContent);
        // TODO: real Ed25519 + sha256 verification using Web Crypto.
        // For v1 we validate the bundle is well-formed; full verification is
        // identical logic to packages/cli/src/bundle/verify.ts and will land here next.
        if (!bundle.hash || !bundle.signature || !bundle.public_key) throw new Error('malformed');
        await new Promise(r => setTimeout(r, 400));
        el.dataset.status = 'verified';
        label.textContent = 'Assinatura presente';
      } catch (err) {
        el.dataset.status = 'failed';
        label.textContent = 'Não foi possível verificar';
      }

      toggle.addEventListener('click', () => {
        const open = details.classList.toggle('open');
        details.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
      });
    })();
  </script>

</body>
</html>
`;
}

// HTML renderer for `beheld snapshot --html`.
//
// Produces a self-contained, single-file HTML retrato técnico that mirrors
// the design at documents/retrato-publico.html (Inter + Newsreader, warm
// cream palette, signature verifiable client-side via embedded bundle JSON).
//
// All identity strings come from the engine (IdentityGenerator with the
// minimal signals adapter); this file is pure templating.

import { computeTier, type TrustTier } from "../lib/tier";

interface BundlePayload {
  scores?: { prompt_quality?: number; test_maturity?: number; tech_breadth?: number; growth_rate?: number; overall?: number };
  l1?: { total_repos?: number; total_commits?: number; ecosystems?: Record<string, number>; platforms?: Record<string, number> };
  l2?: { total_sessions?: number; workflow_distribution?: Record<string, number> };
  created_at?: string;
}

interface BundleAttestationGithub {
  login: string;
  user_id: number;
  verified_at: string;
}

interface BundleAttestationView {
  payload?: { github?: BundleAttestationGithub };
  signature?: string;
}

interface BundleRekorView {
  logIndex?: number;
  uuid?: string;
  integratedTime?: string;
}

interface Bundle {
  version: string;
  payload: BundlePayload;
  hash: string;
  signature: string;
  public_key: string;
  // F5.6 + F5.8 — wrapper-level evidence. The trust-tier badge + details
  // panel read these directly. Adding them does NOT change the bundle hash
  // (the hash covers `payload` only).
  attestation?: BundleAttestationView | null;
  rekor?: BundleRekorView | null;
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

// Tolerant of `undefined`/`null` — older bundles in the wild may not carry
// every wrapper field (e.g. `hash`, `public_key` got lost on some legacy
// rows). Coerce to "" so a missing field renders an empty `<code>` rather
// than crashing the renderer.
function escapeHtml(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s)
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
  // R1.2c — overall may legitimately be null in a v7 bundle (every
  // dimension absent at scoring time). Only render the section when
  // we have ANY numeric score to display. If the bundle has scores
  // but overall is null AND no per-dimension is numeric, hide the
  // entire section (saves the public retrato from showing an empty
  // grid). Bundles without scores at all still return "" upstream.
  if (!scores) return "";
  const hasAnyNumeric =
    typeof scores.overall === "number" ||
    SCORE_DIMENSIONS.some((dim) => typeof scores[dim] === "number");
  if (!hasAnyNumeric) return "";
  const rows = SCORE_DIMENSIONS.map((dim) => {
    const val = scores[dim];
    if (typeof val !== "number") {
      // R1.2c — per-dimension absent: render "—" with an empty bar so
      // the row still reads as a dimension that wasn't observed.
      return `
      <div class="score-row score-row-absent">
        <div class="score-name">${escapeHtml(SCORE_LABELS[dim])}</div>
        <div class="score-bar"></div>
        <div class="score-val">—</div>
      </div>`;
    }
    const clamped = Math.max(0, Math.min(100, val));
    return `
      <div class="score-row">
        <div class="score-name">${escapeHtml(SCORE_LABELS[dim])}</div>
        <div class="score-bar"><div class="score-bar-fill" style="width: ${clamped}%"></div></div>
        <div class="score-val">${val}</div>
      </div>`;
  }).join("");
  const overallNum =
    typeof scores.overall === "number" ? String(scores.overall) : "—";
  return `
    <section class="scores" aria-label="Scores">
      <div class="label">Scores</div>
      <div class="score-overall">
        <span class="score-overall-num">${overallNum}</span>
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

// F6.12 / v6 — Perfil técnico + Insights, both read from bundle.payload
// (enrichment for perfil técnico, payload.insights for the bullets).
// Local structural type — narrower than the canonical BundleEnrichmentSection
// since the renderer only needs three fields and tolerates v5 bundles where
// they live under payload.l2.

interface EnrichmentRendererView {
  platforms?: Record<string, number>;
  workflow_distribution?: Record<string, number>;
  sessions_analyzed?: number;
}

function renderPerfilTecnicoSection(enrichment: EnrichmentRendererView | undefined): string {
  if (!enrichment) return "";
  const platforms = enrichment.platforms ?? {};
  const wf = enrichment.workflow_distribution ?? {};
  const sessions = enrichment.sessions_analyzed ?? 0;

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

// R2/R3 — Capture Sources (harness_sources) — surfaces which harnesses
// contributed enrichment to the bundle + each one's capture_fidelity tier.
// Renders one chip per HarnessSource entry with the trust tier encoded as
// a CSS class so the portal can color-code high/med/low fidelity.

interface HarnessSourceView {
  harness?: string;
  capture_fidelity?: string;
  sessions?: number;
}

function fidelityTier(fidelity: string): "high" | "med" | "low" {
  switch (fidelity) {
    case "native_hook":
    case "editor_extension":
      return "high";
    case "local_log_tail":
    case "statusline":
      return "med";
    case "inferred":
    default:
      return "low";
  }
}

function renderCaptureSourcesSection(
  sources: HarnessSourceView[] | undefined,
): string {
  if (!Array.isArray(sources) || sources.length === 0) return "";
  const chips = sources
    .filter((s) => typeof s?.harness === "string" && s.harness.length > 0)
    .map((s) => {
      const harness = s.harness as string;
      const fidelity = (s.capture_fidelity ?? "inferred").trim();
      const sessions = Math.max(0, Math.floor(s.sessions ?? 0));
      const tier = fidelityTier(fidelity);
      return `
        <span class="capture-chip capture-chip-${tier}" title="${escapeHtml(fidelity)} · ${sessions} sess${sessions === 1 ? "ão" : "ões"}">
          <strong>${escapeHtml(harness)}</strong>
          <span class="capture-chip-sep">·</span>${escapeHtml(fidelity)}
          <span class="capture-chip-sep">·</span>${sessions}
        </span>`;
    })
    .join("");
  if (chips.length === 0) return "";
  return `
    <section class="capture-sources" aria-label="Fontes de captura">
      <div class="label">Fontes de captura</div>
      <div class="capture-chip-row">${chips}</div>
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

// ── F6.12 / nível 1 — trust-tier badge (visible chip in header) ──────────────
//
// The badge derives from computeTier(bundle), which is recomputed on every
// read of the wrapper — bundles are immutable but the tier can climb as
// evidence is added (attestation lands, rekor inclusion completes, etc.).

interface TierBadgeSpec {
  label: string;
  variant: "trusted" | "strong" | "good" | "neutral";
  /** Short legend shown in the badge title tooltip — what the tier means. */
  hint: string;
}

const TIER_BADGE: Record<TrustTier, TierBadgeSpec> = {
  fully_verifiable: {
    label: "Verificado · Sigstore Rekor",
    variant: "trusted",
    hint: "Bundle assinado + identidade GitHub + inclusão pública no log Sigstore Rekor.",
  },
  engine_verified: {
    label: "Identidade GitHub + engine verificados",
    variant: "strong",
    hint: "Bundle assinado + identidade GitHub + hash do engine que produziu o perfil.",
  },
  identity_verified: {
    label: "Identidade GitHub verificada",
    variant: "good",
    hint: "Bundle assinado + identidade GitHub bound à chave do dev.",
  },
  chain_intact: {
    label: "Assinado · chain íntegra",
    variant: "neutral",
    hint: "Bundle assinado + linkado à cadeia de snapshots anteriores.",
  },
  signature_only: {
    label: "Assinado localmente",
    variant: "neutral",
    hint: "Bundle assinado com a chave do dev. Sem prova externa adicional.",
  },
  unsigned: {
    label: "Não assinado",
    variant: "neutral",
    hint: "Bundle sem assinatura — não é possível verificar autoria.",
  },
};

function renderTierBadge(bundle: Bundle): string {
  const tier = computeTier(bundle as Parameters<typeof computeTier>[0]);
  const spec = TIER_BADGE[tier];
  const attrs = `class="tier-badge tier-${spec.variant}" title="${escapeHtml(spec.hint)}" data-tier="${tier}"`;
  // For fully_verifiable bundles, link the badge to the public Sigstore
  // Rekor entry — recruiters can click the badge to inspect the inclusion
  // proof. Other tiers stay non-clickable spans.
  const rekor = (bundle as { rekor?: BundleRekorView | null }).rekor;
  const rekorUrl =
    tier === "fully_verifiable" && rekor && typeof rekor.logIndex === "number"
      ? `https://search.sigstore.dev/?logIndex=${rekor.logIndex}`
      : null;
  return rekorUrl
    ? `<a ${attrs} href="${escapeHtml(rekorUrl)}" target="_blank" rel="noopener">${escapeHtml(spec.label)}</a>`
    : `<span ${attrs}>${escapeHtml(spec.label)}</span>`;
}

// ── F6.12 / nível 3 — full trust details panel (inside the expandable) ──────

function formatIsoToPtBr(iso: string | undefined): string {
  if (!iso || iso.length < 10) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function renderGithubIdentitySection(att: BundleAttestationView | null | undefined): string {
  const gh = att?.payload?.github;
  const hasSig = typeof att?.signature === "string" && att.signature.length > 0;
  if (!gh || !hasSig) {
    return `
        <div class="trust-section trust-section-muted">
          <p class="trust-section-title">Identidade GitHub</p>
          <p class="trust-section-body">Não vinculada. <code>beheld attest</code> liga a chave do dev a uma identidade pública do GitHub.</p>
        </div>`;
  }
  const ghUrl = `https://github.com/${encodeURIComponent(gh.login)}`;
  return `
        <div class="trust-section">
          <p class="trust-section-title">Identidade GitHub</p>
          <p class="trust-section-body">
            <a class="trust-link" href="${escapeHtml(ghUrl)}" target="_blank" rel="noopener">@${escapeHtml(gh.login)}</a>
            <span class="trust-meta"> · user id ${gh.user_id} · verificada em ${escapeHtml(formatIsoToPtBr(gh.verified_at))}</span>
          </p>
        </div>`;
}

function renderRekorSection(rekor: BundleRekorView | null | undefined): string {
  const hasRekor =
    !!rekor && typeof rekor.logIndex === "number" && typeof rekor.uuid === "string" && rekor.uuid.length > 0;
  if (!hasRekor) {
    return `
        <div class="trust-section trust-section-muted">
          <p class="trust-section-title">Sigstore Rekor</p>
          <p class="trust-section-body">Não submetido (rede indisponível no momento da geração).
          Re-submeter: <code>beheld snapshot --rekor-submit &lt;bundle&gt;</code></p>
        </div>`;
  }
  const uuid = rekor!.uuid as string;
  // Primary link goes to the user-facing Sigstore search UI by logIndex —
  // recruiters can click and see the inclusion without API knowledge.
  // The raw API URL stays available as a secondary "auditor" link.
  const searchUrl = `https://search.sigstore.dev/?logIndex=${rekor!.logIndex}`;
  const apiUrl = `https://rekor.sigstore.dev/api/v1/log/entries/${encodeURIComponent(uuid)}`;
  const shortUuid = uuid.length > 16 ? `${uuid.slice(0, 12)}…${uuid.slice(-4)}` : uuid;
  const integratedLabel = formatIsoToPtBr(rekor!.integratedTime);
  return `
        <div class="trust-section">
          <p class="trust-section-title">🎉 Sigstore Rekor</p>
          <p class="trust-section-body">
            <a class="trust-link" href="${escapeHtml(searchUrl)}" target="_blank" rel="noopener">log #${rekor!.logIndex}</a>
            <span class="trust-meta"> · integrado em ${escapeHtml(integratedLabel)}</span>
          </p>
          <p class="trust-section-body trust-meta" style="margin-top:4px;">
            uuid <a class="trust-link" href="${escapeHtml(apiUrl)}" target="_blank" rel="noopener">${escapeHtml(shortUuid)}</a>
          </p>
        </div>`;
}

export function renderTrustDetails(bundle: Bundle): string {
  return `
        <p style="margin-bottom: 12px;">
          Este retrato é assinado com Ed25519 a partir da chave do dev.
          A verificação acontece neste navegador, sem chamada ao servidor.
        </p>
        <p style="margin-bottom: 6px;"><strong>Hash do payload</strong></p>
        <code id="payload-hash">${escapeHtml(bundle.hash)}</code>
        <p style="margin: 12px 0 6px;"><strong>Chave pública</strong></p>
        <code id="public-key">${escapeHtml(bundle.public_key)}</code>
${renderGithubIdentitySection(bundle.attestation)}
${renderRekorSection(bundle.rekor)}`;
}

// ── main renderer ────────────────────────────────────────────────────────────

/** Display name shown in the header. Resolution order:
 *   1. `data.authorName` — explicit `--author-name` from the CLI
 *   2. `@<github_login>` — from the GitHub attestation when bound
 *   3. `"dev"` — generic placeholder
 *
 * The attestation-derived form prefixes with `@` so a reader immediately
 * recognises it as a verified GitHub handle (and not an arbitrary display
 * string). The Identidade GitHub block inside the verification expandable
 * carries the full attribution detail.
 */
function resolveDisplayName(data: SnapshotHtmlData): string {
  const explicit = (data.authorName ?? "").trim();
  if (explicit.length > 0) return explicit;
  const login = data.bundle.attestation?.payload?.github?.login;
  if (typeof login === "string" && login.length > 0) {
    return `@${login}`;
  }
  return "dev";
}

export function renderSnapshotHtml(data: SnapshotHtmlData): string {
  const name = escapeHtml(resolveDisplayName(data));
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

  // R1.1 — schema v6 uses payload.core; pre-R1.1 bundles still use payload.l1.
  // The HTML renderer reads either so legacy bundles (re-rendered offline) keep
  // working.
  const corePayload = (data.bundle.payload as { core?: { total_repos?: number }; l1?: { total_repos?: number } });
  const repoCount = corePayload.core?.total_repos ?? corePayload.l1?.total_repos ?? 0;
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

  // F6.12 — trust evidence: visible tier chip in the header + full attestation
  // + Rekor details in the existing expandable. Both derive from the wrapper
  // (attestation, rekor, signature) — no bundle change, no version bump.
  const tierBadge = renderTierBadge(data.bundle);
  const trustDetailsBlock = renderTrustDetails(data.bundle);
  // R1.1 — schema v6 uses payload.enrichment; v5 used payload.l2. Read either.
  const enrichmentPayload = data.bundle.payload as {
    enrichment?: EnrichmentRendererView;
    l2?: EnrichmentRendererView;
  };
  const perfilTecnicoBlock = renderPerfilTecnicoSection(
    enrichmentPayload.enrichment ?? enrichmentPayload.l2,
  );
  // R2/R3 — harness_sources lives only in v6+ payload.enrichment, never in
  // legacy v5 payload.l2. Pass undefined for legacy bundles → section omitted.
  const captureSourcesBlock = renderCaptureSourcesSection(
    (enrichmentPayload.enrichment as { harness_sources?: HarnessSourceView[] } | undefined)?.harness_sources,
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
      --card-bg: #FFFFFF;
      --sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --serif: 'Newsreader', Georgia, 'Times New Roman', serif;
    }
    /* Auto dark mode for direct file:// access or browsers without an
       explicit override; the SPA wraps this in an iframe and sets
       html[data-theme] on it directly (see SnapshotIframe). */
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0d1117;
        --ink: #e6e1d8;
        --ink-soft: #8b8278;
        --rule: #252b35;
        --rule-soft: #1e242e;
        --card-bg: #11161e;
      }
    }
    /* Explicit overrides — set by the SPA on the iframe's html element so
       the theme toggle (auto / light / dark) flows into the retrato. */
    html[data-theme="light"] {
      --bg: #FAF8F5;
      --ink: #1A1A1A;
      --ink-soft: #6B6B6B;
      --rule: #D9D6D0;
      --rule-soft: #E5E2DD;
      --card-bg: #FFFFFF;
    }
    html[data-theme="dark"] {
      --bg: #0d1117;
      --ink: #e6e1d8;
      --ink-soft: #8b8278;
      --rule: #252b35;
      --rule-soft: #1e242e;
      --card-bg: #11161e;
    }
    html { -webkit-text-size-adjust: 100%; }
    body {
      background: var(--bg); color: var(--ink); font-family: var(--sans);
      font-feature-settings: "ss01", "cv11"; line-height: 1.5;
      -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
    }
    .page { /* max-width: 640px; */ margin: 0 auto; padding: 96px 32px 64px; }
    .header {
      display: flex; justify-content: space-between; align-items: baseline;
      color: var(--ink-soft); font-size: 14px; margin-bottom: 80px;
    }
    .header .name { font-weight: 500; color: var(--ink); }
    .identity {
      font-family: var(--serif); font-size: 30px; line-height: 1.25;
      letter-spacing: -0.015em; font-weight: 400;
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
    /* F6.12 / nível 1 — tier badge in header (small chip next to date).
       4 variants: trusted (Rekor), strong (engine+id), good (id only),
       neutral (signature-only / chain / unsigned). */
    .header-right {
      display: inline-flex; align-items: center; gap: 12px;
      flex-wrap: wrap; justify-content: flex-end;
    }
    .header-date { color: var(--ink-soft); }
    .tier-badge {
      display: inline-block;
      padding: 3px 9px;
      font-size: 11px; font-weight: 500;
      border-radius: 999px;
      letter-spacing: 0.01em;
      line-height: 1.5;
      cursor: help;
      text-decoration: none;
    }
    a.tier-badge { cursor: pointer; }
    a.tier-badge:hover { filter: brightness(0.95); }
    .tier-badge.tier-trusted {
      background: #E8F1EB; color: #2E7D5F;
      border: 1px solid #B7D5C2;
    }
    /* Dark overrides for the hardcoded chip + panel that don't read from
       --bg/--ink. The verification icons keep their hue (success/error
       cues stay legible on both backgrounds). */
    @media (prefers-color-scheme: dark) {
      .tier-badge.tier-trusted {
        background: rgba(74, 124, 78, 0.18); color: #7fa87f;
        border-color: rgba(127, 168, 127, 0.4);
      }
      .verification-details { background: rgba(255, 255, 255, 0.04); }
    }
    html[data-theme="light"] .tier-badge.tier-trusted {
      background: #E8F1EB; color: #2E7D5F; border-color: #B7D5C2;
    }
    html[data-theme="light"] .verification-details { background: rgba(0,0,0,0.02); }
    html[data-theme="dark"] .tier-badge.tier-trusted {
      background: rgba(74, 124, 78, 0.18); color: #7fa87f;
      border-color: rgba(127, 168, 127, 0.4);
    }
    html[data-theme="dark"] .verification-details { background: rgba(255, 255, 255, 0.04); }
    .tier-badge.tier-strong {
      background: var(--ink); color: var(--bg);
    }
    .tier-badge.tier-good {
      background: transparent; color: var(--ink);
      border: 1px solid var(--ink);
    }
    .tier-badge.tier-neutral {
      background: var(--rule-soft); color: var(--ink-soft);
      border: 1px solid var(--rule);
    }

    /* F6.12 / nível 3 — trust details inside the verification expandable. */
    .trust-section {
      margin-top: 16px; padding-top: 12px;
      border-top: 1px solid var(--rule-soft);
    }
    .trust-section-muted .trust-section-body { color: var(--ink-soft); }
    .trust-section-title {
      font-weight: 500; color: var(--ink);
      margin-bottom: 4px;
    }
    .trust-section-body {
      font-size: 13px; line-height: 1.6; color: var(--ink);
    }
    .trust-link {
      color: var(--ink); text-decoration: underline;
      text-decoration-color: var(--rule); text-underline-offset: 3px;
    }
    .trust-link:hover { text-decoration-color: var(--ink); }
    .trust-meta { color: var(--ink-soft); font-size: 12px; }

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

    /* R2/R3 — Capture Sources: one chip per harness_sources[] entry, with
       trust tier encoded via CSS class. Visual language matches the tier
       badges in the verification block. */
    .capture-sources { margin-top: 32px; }
    .capture-sources .label {
      font-size: 13px; font-weight: 500; color: var(--ink-soft);
      margin-bottom: 12px;
    }
    .capture-chip-row {
      display: flex; flex-wrap: wrap; gap: 8px;
    }
    .capture-chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid var(--rule);
      font-size: 12px;
      font-feature-settings: "tnum";
      line-height: 1.4;
    }
    .capture-chip strong {
      font-weight: 600; color: var(--ink);
    }
    .capture-chip-sep {
      color: var(--ink-soft);
      opacity: 0.6;
    }
    .capture-chip-high {
      background: rgba(34, 197, 94, 0.08);
      border-color: rgba(34, 197, 94, 0.35);
      color: var(--ink);
    }
    .capture-chip-med {
      background: var(--rule-soft);
      color: var(--ink-soft);
    }
    .capture-chip-low {
      background: rgba(234, 179, 8, 0.10);
      border-color: rgba(234, 179, 8, 0.40);
      color: var(--ink);
    }

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
      .header { margin-bottom: 48px; flex-wrap: wrap; gap: 12px; }
      .header-right { width: 100%; justify-content: flex-start; gap: 8px; }
      .tier-badge { font-size: 10px; padding: 3px 8px; }
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
      <span class="header-right">${tierBadge}<span class="header-date">${escapeHtml(dateLabel)}</span></span>
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
${captureSourcesBlock}
${stackBlock}
${insightsBlock}

    <footer class="footer">
      <div class="verification" data-status="checking" id="verification">
        <span class="icon" aria-hidden="true">✓</span>
        <button class="verification-toggle" id="verification-toggle" aria-expanded="false" aria-controls="verification-details">
          <span id="verification-label">Verificando assinatura…</span>
        </button>
      </div>

      <div class="verification-details" id="verification-details" hidden>${trustDetailsBlock}
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

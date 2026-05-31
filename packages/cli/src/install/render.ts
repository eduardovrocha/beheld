import { t, type Lang } from "../i18n/install";
import { RESET, DIM } from "../ui/styles";
import type {
  InstallReport,
  RenderEnv,
  Section,
  Step,
  StepState,
  StepUiStatus,
} from "./types";

// ── cores B3 ─────────────────────────────────────────────────────────────────

/** Bronze do brand (#c9a96e) em truecolor ANSI. Modern terminals (2026 baseline) suportam. */
export const BRONZE = "\x1b[38;2;201;169;110m";
/** Red ANSI 31 — alinhado com styles.ts. */
export const RED = "\x1b[31m";

function colorize(s: string, code: string, enabled: boolean): string {
  return enabled ? `${code}${s}${RESET}` : s;
}

function dimize(s: string, enabled: boolean): string {
  return enabled ? `${DIM}${s}${RESET}` : s;
}

// ── ambiente de render ───────────────────────────────────────────────────────

export function detectRenderEnv(opts: { lang: Lang }): RenderEnv {
  const tty = !!process.stdout.isTTY;
  const noColor = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "";
  return {
    tty,
    color: tty && !noColor,
    lang: opts.lang,
    termWidth: process.stdout.columns ?? 80,
  };
}

// ── primitivas ───────────────────────────────────────────────────────────────

/** Renderiza barra de progresso `[████░░░░] N/M · P%` sem cor. Aplique cor por fora se quiser. */
export function renderProgressBar(done: number, total: number, width: number): string {
  const clampedTotal = Math.max(1, total);
  const clampedDone = Math.max(0, Math.min(done, clampedTotal));
  const filled = Math.round((clampedDone / clampedTotal) * width);
  const empty = Math.max(0, width - filled);
  const pct = Math.round((clampedDone / clampedTotal) * 100);
  return `[${"█".repeat(filled)}${" ".repeat(empty)}] ${clampedDone}/${clampedTotal} · ${pct}%`;
}

/** Linha de ação: "  ✓ label (detail)" ou "  ✗ label". */
export function renderActionStep(opts: {
  ok: boolean | null;
  label: string;
  detail?: string;
  color: boolean;
}): string {
  const { ok, label, detail, color } = opts;
  const sym =
    ok === null
      ? dimize("…", color)
      : ok
      ? colorize("✓", BRONZE, color)
      : colorize("✗", RED, color);
  const tail = detail ? ` ${dimize(detail, color)}` : "";
  return `    ${sym} ${label}${tail}`;
}

/** Linha de verify: "    label             [working]". */
export function renderVerifyLine(opts: {
  status: StepUiStatus;
  label: string;
  statusText: string;
  labelColumnWidth: number;
  color: boolean;
}): string {
  const { status, label, statusText, labelColumnWidth, color } = opts;
  const padded = label.padEnd(labelColumnWidth, " ");
  const wrapped =
    status === "error"
      ? colorize(`[${statusText}]`, RED, color)
      : status === "working" || status === "ok"
      ? colorize(`[${statusText}]`, BRONZE, color)
      : dimize(`[${statusText}]`, color);
  return `    ${padded} ${wrapped}`;
}

/** Header de seção: "  · pre-flight" (com bronze opcional no glifo). */
export function renderSectionHeader(name: string, color: boolean): string {
  return `  ${colorize("·", BRONZE, color)} ${name}`;
}

// ── opener / closer ──────────────────────────────────────────────────────────

export function renderOpener(env: RenderEnv): string {
  const glyph = env.tty ? `  ${colorize("⦿", BRONZE, env.color)}  ` : "  ";
  return `${glyph}${t("install.opener", env.lang)}`;
}

export function renderCloser(report: InstallReport, env: RenderEnv): string {
  const glyph = env.tty ? `  ${colorize("⦿", BRONZE, env.color)}  ` : "  ";
  if (report.succeeded) {
    return [
      `${glyph}${t("install.closer.ok.l1", env.lang)}`,
      `     ${t("install.closer.ok.l2", env.lang)}`,
      `     ${dimize(t("install.closer.ok.l3", env.lang), env.color)}`,
      `     ${dimize(t("install.closer.signoff", env.lang), env.color)}`,
    ].join("\n");
  }
  const firstError = report.errors[0];
  const errorLabel = firstError
    ? t(firstError.step.labelKey, env.lang)
    : t("install.section.install", env.lang);
  return [
    `${glyph}${t("install.closer.partial.l1", env.lang, { label: errorLabel })}`,
    `     ${t("install.closer.partial.l2", env.lang)}`,
    `     ${dimize(t("install.closer.signoff", env.lang), env.color)}`,
  ].join("\n");
}

// ── helpers de layout ────────────────────────────────────────────────────────

const SECTIONS_IN_ORDER: Section[] = ["preflight", "install", "verify"];

function uiStatusToText(s: StepUiStatus, env: RenderEnv): string {
  if (s === "working" || s === "ok") return t("install.status.working", env.lang);
  if (s === "error") return t("install.status.error", env.lang);
  return t("install.status.pending", env.lang);
}

/** Larguras da coluna de label dos verifies — soma do maior label + 2 pra respiro. */
function computeVerifyLabelWidth(states: StepState[], env: RenderEnv): number {
  const verifyLabels = states
    .filter((s) => s.step.section === "verify")
    .map((s) => t(s.step.labelKey, env.lang));
  if (verifyLabels.length === 0) return 16;
  const longest = Math.max(...verifyLabels.map((l) => l.length));
  return Math.min(longest + 2, Math.max(12, env.termWidth - 12));
}

/**
 * Render do layout TTY completo (bar + 3 seções + steps de cada uma).
 * Retorna como array de linhas — caller faz `join("\n")` e cuida do cursor.
 */
export function renderTtyLayout(
  states: StepState[],
  env: RenderEnv,
): string[] {
  const lines: string[] = [];
  const done = states.filter((s) => s.status === "ok" || s.status === "error").length;
  const bar = renderProgressBar(done, states.length, 20);
  lines.push("  " + colorize(bar.split(" ")[0]!, BRONZE, env.color) + bar.slice(bar.indexOf(" ")));

  const labelWidth = computeVerifyLabelWidth(states, env);

  for (const section of SECTIONS_IN_ORDER) {
    const sectionSteps = states.filter((s) => s.step.section === section);
    if (sectionSteps.length === 0) continue;
    lines.push(renderSectionHeader(t(`install.section.${section}`, env.lang), env.color));
    for (const st of sectionSteps) {
      // overrideLabel (vindo do StepResult) tem prioridade sobre o labelKey.
      const label = st.result?.overrideLabel ?? t(st.step.labelKey, env.lang);
      if (st.step.isAction) {
        const okState =
          st.status === "ok" ? true : st.status === "error" ? false : null;
        const detail = st.result?.detail;
        lines.push(
          renderActionStep({ ok: okState, label, detail, color: env.color }),
        );
        if (st.status === "error" && st.result) {
          if (st.result.errorReason) {
            lines.push(
              `        ${dimize(
                `${t("install.error.reason", env.lang)}: ${st.result.errorReason}`,
                env.color,
              )}`,
            );
          }
          if (st.result.errorSeeAlso) {
            lines.push(
              `        ${dimize(
                `${t("install.error.see", env.lang)}:    ${st.result.errorSeeAlso}`,
                env.color,
              )}`,
            );
          }
        }
      } else {
        lines.push(
          renderVerifyLine({
            status: st.status,
            label,
            statusText: uiStatusToText(st.status, env),
            labelColumnWidth: labelWidth,
            color: env.color,
          }),
        );
        if (st.status === "error" && st.result) {
          if (st.result.errorReason) {
            lines.push(
              `        ${dimize(
                `${t("install.error.reason", env.lang)}: ${st.result.errorReason}`,
                env.color,
              )}`,
            );
          }
          if (st.result.errorSeeAlso) {
            lines.push(
              `        ${dimize(
                `${t("install.error.see", env.lang)}:    ${st.result.errorSeeAlso}`,
                env.color,
              )}`,
            );
          }
        }
      }
    }
  }
  return lines;
}

/**
 * Linha única não-TTY: "[N/M] [section] label [status]"
 * Inclui sub-linhas de error/see quando relevantes.
 */
export function renderNonTtyStepLine(
  index: number,
  total: number,
  state: StepState,
  env: RenderEnv,
): string {
  const total_w = String(total).length;
  const prefix = `[${String(index).padStart(total_w, " ")}/${total}]`;
  const section = t(`install.section.${state.step.section}`, env.lang);
  const label = state.result?.overrideLabel ?? t(state.step.labelKey, env.lang);
  const status =
    state.status === "ok"
      ? "ok"
      : state.status === "error"
      ? `[${t("install.status.error", env.lang)}]`
      : `[${t("install.status.working", env.lang)}]`;
  const detail = state.result?.detail ? ` ${state.result.detail}` : "";
  const main = `${prefix} [${section.padEnd(10, " ")}] ${label}${detail} ${status}`;
  const extras: string[] = [];
  if (state.status === "error" && state.result) {
    if (state.result.errorReason) {
      extras.push(`                    ${t("install.error.reason", env.lang)}: ${state.result.errorReason}`);
    }
    if (state.result.errorSeeAlso) {
      extras.push(`                    ${t("install.error.see", env.lang)}:    ${state.result.errorSeeAlso}`);
    }
  }
  return [main, ...extras].join("\n");
}

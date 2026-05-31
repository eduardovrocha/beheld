import { t, type Lang } from "../i18n/install";
import { RESET, DIM } from "../ui/styles";
import type { InstallReport, RenderEnv, StepState } from "./types";

// ── cores B3 ─────────────────────────────────────────────────────────────────

/** Bronze do brand (#c9a96e) em truecolor ANSI. */
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

/** Linha de step: "  ✓ label (detail)" ou "  ✗ label". */
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

/** Header de seção: "  · pre-flight". */
export function renderSectionHeader(name: string, color: boolean): string {
  return `  ${colorize("·", BRONZE, color)} ${name}`;
}

/**
 * Render append-only de UM step que acabou de completar.
 * Retorna 1-3 linhas: a linha do step + linhas opcionais de erro (reason, see).
 */
export function renderStepCompletion(state: StepState, env: RenderEnv): string[] {
  const label = state.result?.overrideLabel ?? t(state.step.labelKey, env.lang);
  const lines: string[] = [];
  lines.push(
    renderActionStep({
      ok: state.status === "ok",
      label,
      detail: state.result?.detail,
      color: env.color,
    }),
  );
  if (state.status === "error" && state.result) {
    if (state.result.errorReason) {
      lines.push(
        `        ${dimize(
          `${t("install.error.reason", env.lang)}: ${state.result.errorReason}`,
          env.color,
        )}`,
      );
    }
    if (state.result.errorSeeAlso) {
      lines.push(
        `        ${dimize(
          `${t("install.error.see", env.lang)}:    ${state.result.errorSeeAlso}`,
          env.color,
        )}`,
      );
    }
  }
  return lines;
}

// ── opener / closer ──────────────────────────────────────────────────────────

export function renderOpener(env: RenderEnv): string {
  const glyph = `  ${colorize("⦿", BRONZE, env.color)}  `;
  return `${glyph}${t("install.opener", env.lang)}`;
}

export function renderCloser(report: InstallReport, env: RenderEnv): string {
  const glyph = `  ${colorize("⦿", BRONZE, env.color)}  `;
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
    ? firstError.result?.overrideLabel ?? t(firstError.step.labelKey, env.lang)
    : t("install.section.install", env.lang);
  return [
    `${glyph}${t("install.closer.partial.l1", env.lang, { label: errorLabel })}`,
    `     ${t("install.closer.partial.l2", env.lang)}`,
    `     ${dimize(t("install.closer.signoff", env.lang), env.color)}`,
  ].join("\n");
}

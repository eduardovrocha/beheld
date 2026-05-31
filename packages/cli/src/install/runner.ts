import { t } from "../i18n/install";
import {
  renderCloser,
  renderOpener,
  renderSectionHeader,
  renderStepCompletion,
} from "./render";
import type {
  InstallReport,
  RenderEnv,
  Section,
  Step,
  StepState,
} from "./types";

interface Writer {
  write: (s: string) => void;
}

const DEFAULT_WRITER: Writer = {
  write: (s) => process.stdout.write(s),
};

function initialStates(steps: Step[]): StepState[] {
  return steps.map((s) => ({ step: s, status: "pending" }));
}

function isSectionBlocking(section: Section): boolean {
  // Short-circuit rule: pre-flight e install abortam steps subsequentes da
  // mesma seção + das seguintes na primeira falha. Verify é resiliente:
  // cada item independente, todos rodam até o fim.
  return section === "preflight" || section === "install";
}

/**
 * Execução serial de steps, em modo APPEND-ONLY.
 *
 * Cada step que completa imprime UMA (ou 2-3, se houver erro) linhas no stdout.
 * Sem redraw, sem alt screen buffer, sem cursor magic. Funciona em qualquer
 * terminal: Warp, iTerm2, Terminal.app, tmux, ssh, ci.log, pipe.
 *
 * O ato de ver as linhas aparecerem é o feedback de progresso. Em ~3 segundos
 * de install, isso é mais legível que uma barra animada.
 */
export async function runInstall(
  steps: Step[],
  env: RenderEnv,
  writer: Writer = DEFAULT_WRITER,
): Promise<InstallReport> {
  const states = initialStates(steps);

  // Opener — mesmo formato em TTY e não-TTY.
  writer.write(`${renderOpener(env)}\n\n`);

  const printedSections = new Set<Section>();
  let abortRemainingBlocking = false;

  for (const state of states) {
    if (abortRemainingBlocking && isSectionBlocking(state.step.section)) {
      // Pula short-circuited steps — mantém status pending; não imprime nada.
      continue;
    }

    state.status = "running";
    const t0 = Date.now();
    try {
      const result = await state.step.run();
      state.durationMs = Date.now() - t0;
      state.result = result;
      state.status = result.ok ? "ok" : "error";
      if (!result.ok && isSectionBlocking(state.step.section)) {
        abortRemainingBlocking = true;
      }
    } catch (err) {
      state.durationMs = Date.now() - t0;
      const message = err instanceof Error ? err.message : String(err);
      state.result = { ok: false, errorReason: message };
      state.status = "error";
      if (isSectionBlocking(state.step.section)) {
        abortRemainingBlocking = true;
      }
    }

    // Section header — imprime na primeira vez que vemos essa seção.
    if (!printedSections.has(state.step.section)) {
      printedSections.add(state.step.section);
      const sectionName = t(`install.section.${state.step.section}`, env.lang);
      writer.write(`${renderSectionHeader(sectionName, env.color)}\n`);
    }

    // Step lines (1 + opcionais de erro).
    for (const line of renderStepCompletion(state, env)) {
      writer.write(`${line}\n`);
    }
  }

  const errors = states.filter((s) => s.status === "error");
  const report: InstallReport = {
    steps: states,
    errors,
    succeeded: errors.length === 0,
  };

  // Linha em branco + closer.
  writer.write(`\n${renderCloser(report, env)}\n`);

  return report;
}

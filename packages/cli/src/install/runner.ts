import { t } from "../i18n/install";
import {
  renderCloser,
  renderNonTtyStepLine,
  renderOpener,
  renderTtyLayout,
} from "./render";
import type {
  InstallReport,
  RenderEnv,
  Step,
  StepState,
} from "./types";

interface Writer {
  write: (s: string) => void;
}

const DEFAULT_WRITER: Writer = {
  write: (s) => process.stdout.write(s),
};

/** ANSI: move cursor up N lines + clear from cursor to end-of-screen. */
function clearLines(writer: Writer, n: number): void {
  if (n <= 0) return;
  writer.write(`\x1b[${n}A\x1b[J`);
}

function initialStates(steps: Step[]): StepState[] {
  return steps.map((s) => ({ step: s, status: "pending" }));
}

function isSectionBlocking(section: Step["section"]): boolean {
  // Short-circuit rule: pre-flight e install abortam steps subsequentes da
  // mesma seção + das seguintes na primeira falha. Verify é resiliente:
  // cada item independente, todos rodam até o fim.
  return section === "preflight" || section === "install";
}

/**
 * Execução serial de steps, com redraw TTY entre cada um.
 * Retorna report completo (succeeded sse nenhum step terminou com error).
 */
export async function runInstall(
  steps: Step[],
  env: RenderEnv,
  writer: Writer = DEFAULT_WRITER,
): Promise<InstallReport> {
  const states = initialStates(steps);

  // Opener — TTY e não-TTY ambos imprimem.
  writer.write(`${renderOpener(env)}\n`);

  if (env.tty) {
    await runTty(states, env, writer);
  } else {
    writer.write(`${t("install.nontty.header", env.lang)}\n`);
    await runNonTty(states, env, writer);
  }

  const errors = states.filter((s) => s.status === "error");
  const report: InstallReport = {
    steps: states,
    errors,
    succeeded: errors.length === 0,
  };

  // Closer
  if (env.tty) {
    writer.write(`${renderCloser(report, env)}\n`);
  } else {
    writer.write(
      `${
        report.succeeded
          ? t("install.nontty.done.ok", env.lang)
          : t("install.nontty.done.partial", env.lang)
      }\n`,
    );
  }

  return report;
}

async function runTty(
  states: StepState[],
  env: RenderEnv,
  writer: Writer,
): Promise<void> {
  // Render inicial — barra a 0/N + todos os steps em pending.
  let layout = renderTtyLayout(states, env);
  writer.write(layout.join("\n") + "\n");
  let abortRemainingBlocking = false;

  for (let i = 0; i < states.length; i++) {
    const state = states[i]!;

    if (abortRemainingBlocking && isSectionBlocking(state.step.section)) {
      // Pula short-circuited steps — mantém status pending.
      continue;
    }

    state.status = "running";
    // Re-render durante execução só faz sentido se step demorar muito;
    // mantemos simples: pending → ok/error sem estado intermediário visível,
    // mas a fase "running" é registrada caso o caller queira observar.

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

    // Cursor magic: voltar pro topo do layout anterior, limpar, redesenhar.
    clearLines(writer, layout.length);
    layout = renderTtyLayout(states, env);
    writer.write(layout.join("\n") + "\n");
  }
}

async function runNonTty(
  states: StepState[],
  env: RenderEnv,
  writer: Writer,
): Promise<void> {
  let abortRemainingBlocking = false;

  for (let i = 0; i < states.length; i++) {
    const state = states[i]!;

    if (abortRemainingBlocking && isSectionBlocking(state.step.section)) {
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

    writer.write(`${renderNonTtyStepLine(i + 1, states.length, state, env)}\n`);
  }
}

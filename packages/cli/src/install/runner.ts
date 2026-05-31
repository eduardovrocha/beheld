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

/** ANSI: clear full screen + home cursor (linha 1, coluna 1).
 *
 * Por que tela inteira em vez de cursor-up + clear-to-end? Em terminais que
 * não fazem auto-scroll para acompanhar o cursor (alguns emuladores em
 * janelas pequenas, panes do tmux/iTerm), o redesenho local fica fora do
 * viewport visível e a barra parece travada. `\x1b[2J\x1b[0;0H` garante
 * que cada redraw começa na linha 1 do viewport — posição estável,
 * sem depender do estado do scroll.
 */
function clearScreen(writer: Writer): void {
  writer.write("\x1b[2J\x1b[0;0H");
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

  if (env.tty) {
    // TTY: opener é parte do redraw — vai dentro do runTty.
    await runTty(states, env, writer);
  } else {
    // Não-TTY: opener + header logo de cara, depois uma linha por step.
    writer.write(`${renderOpener(env)}\n`);
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
    // Em TTY o closer aparece abaixo do layout final (que já foi reprinted
    // no último step). Não limpa tela aqui — usuário precisa ver o estado
    // final + closer simultaneamente.
    writer.write(`\n${renderCloser(report, env)}\n`);
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
  // Helper: cada redraw é "tela limpa + opener + layout".
  // Garante que tudo cabe no viewport visível, sem depender do scroll.
  const draw = (): void => {
    clearScreen(writer);
    writer.write(`${renderOpener(env)}\n`);
    const layout = renderTtyLayout(states, env);
    writer.write(layout.join("\n") + "\n");
  };

  // Render inicial — barra a 0/N + todos os steps em pending.
  draw();

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

    // Tela limpa + opener + layout atualizado. Posição visual sempre estável.
    draw();
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

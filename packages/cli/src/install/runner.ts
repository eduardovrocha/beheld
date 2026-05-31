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

/** ANSI: clear full screen + home cursor (linha 1, coluna 1). */
function clearScreen(writer: Writer): void {
  writer.write("\x1b[2J\x1b[0;0H");
}

/**
 * Entra no alternate screen buffer (mesmo padrão de vim/less/htop).
 * Tudo escrito enquanto estamos no alt buffer NÃO entra no scrollback do
 * usuário. Quando saímos, o terminal restaura o conteúdo que estava antes.
 *
 * Sem isso, cada `\x1b[2J` deixa o frame anterior empurrado pro scrollback,
 * e ao fim do install o scrollback tem N cópias da mesma tela empilhadas.
 *
 * Também esconde o cursor (\x1b[?25l) — animação fica mais limpa, e o
 * showCursor() restaura quando saímos.
 */
function enterAltScreen(writer: Writer): void {
  writer.write("\x1b[?1049h\x1b[?25l");
}

function leaveAltScreen(writer: Writer): void {
  writer.write("\x1b[?25h\x1b[?1049l");
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
    // TTY: animação roda no alternate screen buffer dentro do runTty.
    // Ao sair, o terminal volta pro estado anterior ao install.
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
    // De volta ao buffer normal. Imprimimos o snapshot final UMA vez aqui
    // + closer. Isso é tudo que sobra no scrollback do usuário.
    writer.write(`${renderFinalSummary(states, env)}\n`);
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
  const draw = (): void => {
    clearScreen(writer);
    writer.write(`${renderOpener(env)}\n`);
    const layout = renderTtyLayout(states, env);
    writer.write(layout.join("\n") + "\n");
  };

  // Entra no alternate screen buffer ANTES do primeiro draw — animação roda
  // num buffer separado que não polui o scrollback do usuário.
  enterAltScreen(writer);

  // SIGINT / falha inesperada: garantir que voltamos pro buffer normal.
  // Sem isso, Ctrl-C deixa o terminal no alt buffer (efeitos visuais ruins).
  const cleanup = () => {
    leaveAltScreen(writer);
  };
  const sigintHandler = () => {
    cleanup();
    process.exit(130);
  };
  process.on("SIGINT", sigintHandler);

  try {
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

      draw();
    }
  } finally {
    process.off("SIGINT", sigintHandler);
    cleanup();
  }
}

/**
 * Render compacto pós-execução, impresso no buffer NORMAL (não alt).
 * É o que sobra no scrollback do usuário depois que o install termina:
 * uma única ocorrência do estado final + closer. Sem 13 frames empilhados.
 */
function renderFinalSummary(states: StepState[], env: RenderEnv): string {
  const lines: string[] = [];
  lines.push(renderOpener(env));
  for (const line of renderTtyLayout(states, env)) {
    lines.push(line);
  }
  return lines.join("\n");
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

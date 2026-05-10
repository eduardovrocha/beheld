import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WizardDimensions, WizardEnvironments } from "../types";

// ── ANSI ──────────────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";

function bold(s: string): string {
  return `${BOLD}${s}${RESET}`;
}
function green(s: string): string {
  return `${GREEN}${s}${RESET}`;
}
function dim(s: string): string {
  return `${DIM}${s}${RESET}`;
}

// ── readline helper ───────────────────────────────────────────────────────────

function prompt(
  rl: ReturnType<typeof createInterface>,
  question: string,
): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

// ── environment detection ─────────────────────────────────────────────────────

export function detectEnvironments(base = homedir()): WizardEnvironments {
  return {
    claudeCode: existsSync(join(base, ".claude", "settings.json")),
    continueDev: existsSync(join(base, ".continue", "config.json")),
  };
}

// ── Tela 1 — Transparência ────────────────────────────────────────────────────

async function screen1(rl: ReturnType<typeof createInterface>): Promise<void> {
  process.stdout.write("\x1b[2J\x1b[0;0H"); // clear screen
  console.log(bold(`\n${CYAN}DevProfile${RESET} — Onboarding\n`));
  console.log(bold("O que é coletado?") + "\n");

  const collected = [
    "Nomes das ferramentas usadas (Read, Write, Bash…)",
    "Extensões de arquivo (.ts, .py, .rb…)",
    "Comandos Bash sanitizados (sem argumentos sensíveis)",
    "Tamanho dos prompts (contagem de caracteres)",
    "Timestamps e duração das sessões",
  ];
  const never = [
    "Conteúdo de arquivos ou prompts",
    "Variáveis de ambiente ou secrets",
    "Caminhos absolutos (apenas hash SHA-256)",
    "Tokens de API ou credenciais",
    "Dados de negócio ou informações pessoais",
  ];

  const maxLen = Math.max(...collected.map((s) => s.length));
  console.log(
    `  ${bold("COLETADO".padEnd(maxLen + 4))}  ${bold("NUNCA COLETADO")}`,
  );
  console.log("  " + "─".repeat(maxLen + 4) + "  " + "─".repeat(40));
  const rows = Math.max(collected.length, never.length);
  for (let i = 0; i < rows; i++) {
    const left = collected[i] ? green("✓ " + collected[i]) : "";
    const right = never[i] ? `${YELLOW}✗ ${never[i]}${RESET}` : "";
    console.log(`  ${left.padEnd(maxLen + 10)}  ${right}`);
  }

  console.log("\n" + dim("Todos os dados ficam em ~/.devprofile/ — nunca saem do seu computador."));
  await prompt(rl, "\nPressione Enter para continuar…");
}

// ── Tela 2 — Opt-in granular (checkboxes) ────────────────────────────────────

async function screen2(
  rl: ReturnType<typeof createInterface>,
): Promise<WizardDimensions> {
  const items: { key: keyof WizardDimensions; label: string; desc: string; on: boolean }[] = [
    { key: "prompt_quality", label: "prompt_quality", desc: "Qualidade dos seus prompts", on: true },
    { key: "test_maturity", label: "test_maturity", desc: "Maturidade em testes e TDD", on: true },
    { key: "tech_breadth", label: "tech_breadth", desc: "Diversidade tecnológica", on: true },
    { key: "work_hours", label: "work_hours", desc: "Horários de trabalho (opt-in)", on: false },
    { key: "project_type", label: "project_type", desc: "Tipo de projeto (opt-in)", on: false },
  ];

  while (true) {
    process.stdout.write("\x1b[2J\x1b[0;0H");
    console.log(bold("\nTela 2 — Dimensões a analisar\n"));
    items.forEach((item, i) => {
      const check = item.on ? green("[✓]") : `${DIM}[ ]${RESET}`;
      console.log(`  [${i + 1}] ${check}  ${item.label.padEnd(18)} ${dim(item.desc)}`);
    });
    console.log("\n" + dim("Digite números para ativar/desativar (ex: 4 5), Enter para confirmar:"));
    const answer = await prompt(rl, "> ");
    if (answer.trim() === "") break;
    for (const token of answer.trim().split(/\s+/)) {
      const n = parseInt(token, 10);
      if (n >= 1 && n <= items.length) items[n - 1].on = !items[n - 1].on;
    }
  }

  const result = {} as WizardDimensions;
  for (const item of items) result[item.key] = item.on;
  return result;
}

// ── Tela 3 — Ambientes ────────────────────────────────────────────────────────

async function screen3(
  rl: ReturnType<typeof createInterface>,
  base = homedir(),
): Promise<WizardEnvironments> {
  process.stdout.write("\x1b[2J\x1b[0;0H");
  console.log(bold("\nTela 3 — Ambientes detectados\n"));

  const envs = detectEnvironments(base);

  function detected(found: boolean): string {
    return found ? green("detectado") : `${DIM}não encontrado${RESET}`;
  }

  console.log(`  Claude Code     ${detected(envs.claudeCode)}`);
  console.log(`  Continue.dev    ${detected(envs.continueDev)}`);
  console.log("");

  let claudeCode = envs.claudeCode;
  let continueDev = envs.continueDev;

  if (envs.claudeCode) {
    const ans = await prompt(rl, "  Configurar Claude Code? [S/n] ");
    claudeCode = ans.trim().toLowerCase() !== "n";
  }
  if (envs.continueDev) {
    const ans = await prompt(rl, "  Configurar Continue.dev? [S/n] ");
    continueDev = ans.trim().toLowerCase() !== "n";
  }

  return { claudeCode, continueDev };
}

// ── Tela 4 — Progresso ───────────────────────────────────────────────────────

export interface SetupActions {
  installClaudeHooks?: () => Promise<void>;
  installContinueMcp?: () => Promise<void>;
  extractEngine?: () => Promise<string>;
  startDaemons?: () => Promise<void>;
  installAutostart?: () => Promise<void>;
}

async function screen4(
  rl: ReturnType<typeof createInterface>,
  environments: WizardEnvironments,
  actions: SetupActions,
): Promise<void> {
  process.stdout.write("\x1b[2J\x1b[0;0H");
  console.log(bold("\nTela 4 — Configurando DevProfile\n"));

  async function step(label: string, fn: () => Promise<unknown>): Promise<void> {
    process.stdout.write(`  ${dim("…")}  ${label}`);
    try {
      await fn();
      process.stdout.write(`\r  ${green("✓")}  ${label}\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`\r  \x1b[31m✗\x1b[0m  ${label}  ${dim(msg)}\n`);
    }
  }

  if (environments.claudeCode && actions.installClaudeHooks) {
    await step("Instalando hooks no Claude Code", actions.installClaudeHooks);
  }
  if (environments.continueDev && actions.installContinueMcp) {
    await step("Registrando MCP server no Continue.dev", actions.installContinueMcp);
  }
  if (actions.extractEngine) {
    await step("Extraindo engine (~/.devprofile/bin/engine)", actions.extractEngine);
  }
  if (actions.startDaemons) {
    await step("Iniciando daemons", actions.startDaemons);
  }
  if (actions.installAutostart) {
    await step("Instalando autostart", actions.installAutostart);
  }

  console.log(
    `\n${bold("Pronto.")} Digite ${bold("/devprofile")} no Claude Code para ver seu perfil.\n`,
  );
  rl.close();
}

// ── Main wizard export ────────────────────────────────────────────────────────

export interface WizardResult {
  dimensions: WizardDimensions;
  environments: WizardEnvironments;
}

export async function runWizard(
  actions: SetupActions = {},
  homeBase = homedir(),
): Promise<WizardResult> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  await screen1(rl);
  const dimensions = await screen2(rl);
  const environments = await screen3(rl, homeBase);
  await screen4(rl, environments, actions);

  return { dimensions, environments };
}

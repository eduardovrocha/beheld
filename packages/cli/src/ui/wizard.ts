import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WizardDimensions, WizardEnvironments } from "../types";
import { bold, green, dim, RESET, DIM, CYAN, YELLOW, RED } from "./styles";

// ── Privacy strings (Phase 6 — required verbatim by F6.7 spec) ───────────────

/** Exact wording asserted by tests — keep these strings stable. */
export const BOOTSTRAP_PRIVACY_LINES = [
  "Cada repositório é processado uma única vez — reimportar não altera o perfil.",
  "Mensagens de commit, nomes de branch e conteúdo de código nunca são gravados.",
] as const;

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
  console.log(bold(`\n${CYAN}Beheld${RESET} — Onboarding\n`));
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

  console.log("\n" + dim("Todos os dados ficam em ~/.beheld/ — nunca saem do seu computador."));
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

// ── Tela 3.5 — Git Bootstrap (opcional) ──────────────────────────────────────

export type BootstrapChoice = "import_now" | "later" | "skip";

export interface BootstrapResult {
  choice: BootstrapChoice;
  author_email?: string;
}

export interface BootstrapScreenDeps {
  prompt: (label: string) => Promise<string>;
  log: (msg: string) => void;
  /** Invoked when the user picks [1]. The implementation in initCommand wires
   *  this to the real interactive `runImport` loop. */
  runImportLoop: (authorEmail: string) => Promise<void>;
}

/** Render the bootstrap screen and dispatch to the user's choice.
 *  Pure with respect to IO — all side effects flow through `deps`. */
export async function bootstrapScreen(
  deps: BootstrapScreenDeps,
): Promise<BootstrapResult> {
  deps.log("─────────────────────────────────────────────────────");
  deps.log("Beheld · Histórico git (opcional)");
  deps.log("─────────────────────────────────────────────────────");
  deps.log("");
  deps.log("Seu perfil começa a se formar a partir de hoje.");
  deps.log("Quer carregar também o histórico dos seus projetos anteriores?");
  deps.log("");
  deps.log("O Beheld pode analisar repositórios onde você tem commits");
  deps.log("e extrair sinais técnicos — linguagens, ferramentas, ritmo de trabalho.");
  deps.log("");
  deps.log("O que é coletado:   extensões de arquivo, ecosystems, timing");
  deps.log("O que é ignorado:   mensagens de commit, nomes de branch, conteúdo de código");
  deps.log("");
  for (const line of BOOTSTRAP_PRIVACY_LINES) deps.log(line);
  deps.log("");
  deps.log("  [1] Importar agora");
  deps.log("  [2] Importar depois  (beheld import)");
  deps.log("  [3] Pular");
  deps.log("");

  // Default to [3] (skip) on empty input so the wizard can never block.
  const raw = (await deps.prompt("> ")).trim();
  const choice: BootstrapChoice =
    raw === "1" ? "import_now" : raw === "2" ? "later" : "skip";

  if (choice === "import_now") {
    const email = (await deps.prompt("Qual o seu email de commit no git? ")).trim();
    if (!email) {
      deps.log("Email não informado. Pulando bootstrap.");
      return { choice: "skip" };
    }
    await deps.runImportLoop(email);
    return { choice, author_email: email };
  }

  if (choice === "later") {
    deps.log("Ok. Execute beheld import quando quiser.");
    return { choice };
  }

  return { choice };
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
  migrateProjectScoped?: () => Promise<number>;
  installClaudeHooks?: () => Promise<void>;
  installContinueMcp?: () => Promise<void>;
  extractEngine?: () => Promise<string>;
  startDaemons?: () => Promise<string | void>;
  installAutostart?: () => Promise<void>;
}

async function screen4(
  rl: ReturnType<typeof createInterface>,
  environments: WizardEnvironments,
  actions: SetupActions,
  lang: import("../i18n/install").Lang,
): Promise<void> {
  process.stdout.write("\x1b[2J\x1b[0;0H");

  const { buildInstallSteps } = await import("../install/steps");
  const { runInstall } = await import("../install/runner");
  const { detectRenderEnv } = await import("../install/render");

  const steps = buildInstallSteps(environments, actions);
  const env = detectRenderEnv({ lang });
  await runInstall(steps, env);

  rl.close();
}

// ── Main wizard export ────────────────────────────────────────────────────────

export interface WizardResult {
  dimensions: WizardDimensions;
  environments: WizardEnvironments;
  /** Set only when the user picked [1] on the bootstrap screen and entered
   *  an email. initCommand merges this into the final config.json. */
  author_email?: string;
  bootstrap_choice?: BootstrapChoice;
}

export interface WizardActions extends SetupActions {
  /** Drives Tela 3.5. Provided by initCommand which wires it to the real
   *  interactive import loop. */
  runBootstrapImport?: (authorEmail: string) => Promise<void>;
}

export async function runWizard(
  actions: WizardActions = {},
  homeBase = homedir(),
  lang: import("../i18n/install").Lang = "en",
): Promise<WizardResult> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  await screen1(rl);
  const dimensions = await screen2(rl);

  // Tela 3.5 — Git bootstrap (only meaningful if the host can run the import).
  let bootstrap: BootstrapResult = { choice: "skip" };
  if (actions.runBootstrapImport) {
    process.stdout.write("\x1b[2J\x1b[0;0H");
    bootstrap = await bootstrapScreen({
      prompt: (q) => prompt(rl, q),
      log: (m) => console.log(m),
      runImportLoop: actions.runBootstrapImport,
    });
  }

  const environments = await screen3(rl, homeBase);
  await screen4(rl, environments, actions, lang);

  return {
    dimensions,
    environments,
    author_email: bootstrap.author_email,
    bootstrap_choice: bootstrap.choice,
  };
}

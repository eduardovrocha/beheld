/**
 * Steps reais do install B3. Cada step é uma probe leve que retorna StepResult.
 *
 * Pré-flight = observações passivas (não muda estado, valida ambiente).
 * Install     = ações state-changing (vindas das WizardActions, threaded de fora).
 * Verify      = observações pós-install (depende do daemon estar de pé).
 */
import { existsSync, statSync, readdirSync } from "node:fs";
import { homedir, platform, arch } from "node:os";
import { join } from "node:path";
import type { Step, StepResult } from "./types";
import type { WizardEnvironments } from "../ui/wizard";
import type { SetupActions } from "../ui/wizard";
import { engineHealthy, pidListeningOn } from "../util/ports";
import {
  LAUNCH_AGENT_LABEL,
  SYSTEMD_SERVICE_NAME,
  launchAgentPlistPath,
  systemdUnitPath,
} from "../daemon-manager";
import { spawnSync } from "node:child_process";

function beheldDir(): string {
  return process.env.BEHELD_DATA_DIR
    ? join(process.env.BEHELD_DATA_DIR, ".beheld")
    : join(homedir(), ".beheld");
}

// ── pré-flight ───────────────────────────────────────────────────────────────

async function detectPlatform(): Promise<StepResult> {
  return { ok: true, detail: `${platform()} ${arch()}` };
}

async function ensureDataDirOk(): Promise<StepResult> {
  const dir = beheldDir();
  if (!existsSync(dir)) {
    // Não cria aqui (init.ts:mkdirSync cuida disso). Reportar como ok mesmo
    // se ausente — a action de install vai criar.
    return { ok: true, detail: "to be created" };
  }
  try {
    const st = statSync(dir);
    const mode = st.mode & 0o777;
    if (mode === 0o700) return { ok: true };
    return { ok: true, detail: `mode ${mode.toString(8)}` };
  } catch (e) {
    return {
      ok: false,
      errorReason: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── verify ───────────────────────────────────────────────────────────────────

async function verifyHttpHealth(port: number): Promise<StepResult> {
  const healthy = await engineHealthy(port, 1500);
  if (healthy) return { ok: true };
  const pid = pidListeningOn(port);
  return {
    ok: false,
    errorReason: pid
      ? `/health timeout em :${port} (PID ${pid})`
      : `nenhum listener em :${port}`,
    errorSeeAlso: "~/.beheld/install.log",
  };
}

function verifyAutostartSync(): StepResult {
  const p = platform();
  if (p === "darwin") {
    if (!existsSync(launchAgentPlistPath())) {
      return { ok: false, errorReason: `LaunchAgent ${LAUNCH_AGENT_LABEL} ausente` };
    }
    const r = spawnSync("launchctl", ["list", LAUNCH_AGENT_LABEL], { stdio: "pipe" });
    if (r.status !== 0) {
      return { ok: false, errorReason: `${LAUNCH_AGENT_LABEL} instalado mas não carregado` };
    }
    return { ok: true };
  }
  if (p === "linux") {
    if (!existsSync(systemdUnitPath())) {
      return { ok: false, errorReason: `${SYSTEMD_SERVICE_NAME} ausente` };
    }
    const enabled = spawnSync("systemctl", ["--user", "is-enabled", SYSTEMD_SERVICE_NAME], { stdio: "pipe" });
    const state = (enabled.stdout?.toString() ?? "").trim();
    if (state === "enabled" || state === "static") return { ok: true };
    return { ok: false, errorReason: `systemctl --user is-enabled = ${state || "?"}` };
  }
  // Plataformas sem autostart conhecida → ok, sem suporte.
  return { ok: true, detail: "not applicable on this platform" };
}

async function verifyJsonlPipeline(): Promise<StepResult> {
  const sessionsDir = join(beheldDir(), "sessions");
  if (!existsSync(sessionsDir)) {
    return { ok: false, errorReason: `${sessionsDir} não existe` };
  }
  try {
    const st = statSync(sessionsDir);
    const mode = st.mode & 0o777;
    if (mode !== 0o700) {
      return { ok: true, detail: `mode ${mode.toString(8)}` };
    }
    // Best-effort listing pra confirmar leitura.
    readdirSync(sessionsDir);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      errorReason: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── builder ──────────────────────────────────────────────────────────────────

/**
 * Constrói a lista linear de steps a partir das escolhas do usuário.
 * `actions` vem do `WizardActions` que `initCommand` já popula.
 */
export function buildInstallSteps(
  envChoices: WizardEnvironments,
  actions: SetupActions,
): Step[] {
  const steps: Step[] = [];

  // PRE-FLIGHT
  steps.push({
    section: "preflight",
    labelKey: "install.preflight.platform",
    isAction: true,
    run: detectPlatform,
  });
  steps.push({
    section: "preflight",
    labelKey: "install.preflight.dataDir",
    isAction: true,
    run: ensureDataDirOk,
  });
  if (actions.migrateProjectScoped) {
    steps.push({
      section: "preflight",
      labelKey: "install.preflight.migrate",
      isAction: true,
      run: async () => {
        const n = await actions.migrateProjectScoped!();
        return {
          ok: true,
          detail: n > 0 ? `(${n} migrado${n === 1 ? "" : "s"})` : undefined,
        };
      },
    });
  }

  // INSTALL
  if (actions.extractEngine) {
    steps.push({
      section: "install",
      labelKey: "install.install.engine",
      isAction: true,
      run: async () => {
        const t0 = Date.now();
        try {
          await actions.extractEngine!();
          const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
          return { ok: true, detail: `(${elapsed}s)` };
        } catch (e) {
          return { ok: false, errorReason: e instanceof Error ? e.message : String(e) };
        }
      },
    });
  }
  if (envChoices.claudeCode && actions.installClaudeHooks) {
    steps.push({
      section: "install",
      labelKey: "install.install.claudeHooks",
      isAction: true,
      run: async () => {
        try {
          await actions.installClaudeHooks!();
          return { ok: true };
        } catch (e) {
          return { ok: false, errorReason: e instanceof Error ? e.message : String(e) };
        }
      },
    });
  }
  if (envChoices.continueDev && actions.installContinueMcp) {
    steps.push({
      section: "install",
      labelKey: "install.install.continueMcp",
      isAction: true,
      run: async () => {
        try {
          await actions.installContinueMcp!();
          return { ok: true };
        } catch (e) {
          return { ok: false, errorReason: e instanceof Error ? e.message : String(e) };
        }
      },
    });
  }
  if (actions.installAutostart) {
    steps.push({
      section: "install",
      labelKey: "install.install.autostart",
      isAction: true,
      run: async () => {
        try {
          await actions.installAutostart!();
          return { ok: true };
        } catch (e) {
          return { ok: false, errorReason: e instanceof Error ? e.message : String(e) };
        }
      },
    });
  }
  if (actions.startDaemons) {
    steps.push({
      section: "install",
      labelKey: "install.install.start",
      isAction: true,
      run: async () => {
        try {
          const result = await actions.startDaemons!();
          // startDaemons retorna string (label dinâmico) ou void.
          const detail = typeof result === "string" ? result : undefined;
          return { ok: true, detail };
        } catch (e) {
          return { ok: false, errorReason: e instanceof Error ? e.message : String(e) };
        }
      },
    });
  }

  // VERIFY
  steps.push({
    section: "verify",
    labelKey: "install.verify.mcp",
    isAction: false,
    run: () => verifyHttpHealth(7337),
  });
  steps.push({
    section: "verify",
    labelKey: "install.verify.engine",
    isAction: false,
    run: () => verifyHttpHealth(7338),
  });
  steps.push({
    section: "verify",
    labelKey: "install.verify.autostart",
    isAction: false,
    run: async () => verifyAutostartSync(),
  });
  steps.push({
    section: "verify",
    labelKey: "install.verify.jsonl",
    isAction: false,
    run: verifyJsonlPipeline,
  });

  return steps;
}

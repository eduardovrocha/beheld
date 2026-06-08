/**
 * `beheld harness list` / `beheld harness install [names...]`
 *
 * Front-end for the unified harness installer (lib/harness-installer.ts).
 * Two responsibilities:
 *
 *   - `list` — surface every registered harness with its capture_fidelity,
 *     detection state on this host, and tail-enabled state if applicable.
 *     Read-only.
 *
 *   - `install` — invoke the orchestrator with optional filtering, print
 *     one line per adapter (changed / no-op / manual / error). Idempotent.
 *
 * Privacy invariant carried in: this command never spawns the harness
 * binary, never reads its session content, only inspects filesystem paths.
 */
import {
  buildHarnessRegistry,
  enabledTails,
  installAllHarnesses,
  type CaptureFidelity,
  type HarnessAdapter,
} from "../lib/harness-installer";
import { ok, warn, arrow, meta, bold, brand, DIM, RESET } from "../ui/styles";

/** Explicação genérica por fidelity. Complementada pela `description`
 *  específica de cada adapter na linha de baixo. */
const FIDELITY_BLURB: Record<CaptureFidelity, string> = {
  native_hook:      "harness chama o Beheld via hook (push, fidelidade alta)",
  editor_extension: "extensão do editor empurra eventos via MCP (push, fidelidade alta)",
  local_log_tail:   "daemon polleia o log local do harness (pull, fidelidade média)",
  statusline:       "daemon lê o statusline do harness por polling (pull, fidelidade média)",
  inferred:         "sinais inferidos sem cooperação do harness (fidelidade baixa)",
};

function fidelityTag(adapter: HarnessAdapter): string {
  const tier =
    adapter.fidelity === "native_hook" || adapter.fidelity === "editor_extension" ? "high" :
    adapter.fidelity === "inferred" ? "low" : "med";
  return `${adapter.fidelity} (${tier})`;
}

function rowFor(adapter: HarnessAdapter, enabledTailSet: Set<string>): string {
  const detected = adapter.isInstalled();
  const detectStr = detected ? `${"✓ detected"}` : `${"·"} not detected`;
  const isTailAdapter = adapter.fidelity === "local_log_tail" || adapter.fidelity === "statusline";
  const stateStr = isTailAdapter
    ? (enabledTailSet.has(adapter.name) ? "tail: ON" : "tail: off")
    : "—";
  return `  ${adapter.name.padEnd(18)} ${fidelityTag(adapter).padEnd(28)} ${detectStr.padEnd(18)} ${stateStr}`;
}

/** Dim explanation line printed directly under each row.
 *  Format: `      <fidelity blurb> · <adapter-specific description>` */
function explanationFor(adapter: HarnessAdapter): string {
  const generic = FIDELITY_BLURB[adapter.fidelity];
  const specific = adapter.description.trim();
  const body = specific.length > 0 ? `${generic} · ${specific}` : generic;
  return `      ${DIM}${body}${RESET}`;
}

export async function harnessListCommand(): Promise<void> {
  const registry = buildHarnessRegistry();
  const tails = new Set(enabledTails());

  console.log(brand("beheld") + " " + DIM + "harness" + RESET);
  console.log("");
  console.log(bold("  name              fidelity (trust tier)        detection        tail state"));
  console.log(DIM + "  ─".repeat(38) + RESET);
  for (const adapter of registry) {
    console.log(rowFor(adapter, tails));
    console.log(explanationFor(adapter));
  }
  console.log("");

  const detectedCount = registry.filter((a) => a.isInstalled()).length;
  const tailCount = tails.size;
  console.log(meta(`  ${detectedCount}/${registry.length} detected · ${tailCount} tails enabled`));
}

export interface HarnessInstallOptions {
  /** Subset of adapter names to install. Empty/undefined = all detected. */
  names?: string[];
  /** Install even if not detected. */
  force?: boolean;
}

export async function harnessInstallCommand(opts: HarnessInstallOptions = {}): Promise<void> {
  console.log(brand("beheld") + " " + DIM + "harness install" + RESET);
  console.log("");

  const results = installAllHarnesses({
    only: opts.names && opts.names.length > 0 ? opts.names : undefined,
    force: opts.force,
  });

  for (const r of results) {
    const tag = `${r.adapter.name.padEnd(18)}`;
    if (!r.detected) {
      console.log(meta(`  · ${tag} (not detected — skipping; use --force to install anyway)`));
      continue;
    }
    if (!r.installed) {
      console.log(meta(`  · ${tag} (no install action)`));
      continue;
    }
    if (r.installed.requiresManualSetup) {
      console.log(warn(`  ! ${tag} manual setup required`));
      if (r.installed.note) {
        console.log(meta(`    ${r.installed.note.split("\n").join("\n    ")}`));
      }
      continue;
    }
    if (r.installed.changed) {
      console.log(ok(`  ✓ ${tag} ${r.installed.note ?? "installed"}`));
    } else {
      console.log(meta(`  · ${tag} ${r.installed.note ?? "already installed"}`));
    }
  }

  console.log("");
  console.log(meta("Tip: rerun `beheld harness list` to see the updated state."));
}

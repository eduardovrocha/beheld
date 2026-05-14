import { coach, scoresCurrent, profileSummary, insights, engineStatus, processNew, readiness } from "../client/engine-client";
import { mcpSessionCurrent } from "../client/mcp-client";
import { renderCoachText } from "../ui/coach-view";
import { renderProfile, renderCollecting } from "../ui/profile-view";
import type { ProfileData, ViewFlags } from "../types";

interface ViewOptions {
  json?: boolean;
  scoresOnly?: boolean;
  refresh?: boolean;
  coach?: boolean;
  sessionHint?: string;
}

// In machine-readable modes (--json, --scores-only) diagnostic messages go to
// stderr so stdout stays clean for piping into jq, python3, etc.
function isRaw(flags: ViewFlags): boolean {
  return flags.json === true || flags.scoresOnly === true;
}

function warn(msg: string, flags: ViewFlags): void {
  if (isRaw(flags)) {
    process.stderr.write(msg + "\n");
  } else {
    console.log(msg);
  }
}

function warnWrite(msg: string, flags: ViewFlags): void {
  if (isRaw(flags)) {
    process.stderr.write(msg);
  } else {
    process.stdout.write(msg);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const VALID_HINTS = new Set([
  "feature_work",
  "debug",
  "refactor",
  "exploration",
  "unknown",
]);

async function renderCoachView(sessionHint: string, flags: ViewFlags): Promise<void> {
  const hint = VALID_HINTS.has(sessionHint) ? sessionHint : "unknown";
  const payload = await coach(hint);
  if (!payload) {
    warn("\n  ✗ Engine offline — coaching context indisponível.", flags);
    warn("  Execute: devprofile start\n", flags);
    process.exit(1);
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return;
  }

  console.log(renderCoachText(payload));
}

async function waitForProcessing(timeoutMs = 30_000, intervalMs = 1_000): Promise<"done" | "timeout"> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(intervalMs);
    const s = await engineStatus();
    if (!s || s.unprocessed_events === 0) return "done";
  }
  return "timeout";
}

export async function viewCommand(opts: ViewOptions = {}): Promise<void> {
  const flags: ViewFlags = {
    json: opts.json ?? false,
    scoresOnly: opts.scoresOnly ?? false,
  };

  if (opts.coach === true) {
    await renderCoachView(opts.sessionHint ?? "unknown", flags);
    return;
  }

  const status = await engineStatus();
  const hasOrphans = status !== null && status.unprocessed_events > 0;

  if (opts.refresh) {
    if (!hasOrphans) {
      warn("\n  Nenhum evento pendente. Score já está atualizado.\n", flags);
    } else {
      warnWrite(
        `\n  Processando ${status.unprocessed_events} bytes de eventos pendentes...`,
        flags,
      );
      await processNew();
      const result = await waitForProcessing();
      if (result === "done") {
        warnWrite(" ✓\n\n", flags);
      } else {
        warnWrite("\n", flags);
        warn("  ⚠️  Processamento ainda em andamento (timeout 30s).", flags);
        warn("  O score exibido pode estar parcialmente atualizado.\n", flags);
      }
    }
  } else if (hasOrphans) {
    warn(`\n  ⚠️  Há eventos não processados (sessão interrompida).`, flags);
    warn(`  Score pode estar desatualizado.`, flags);
    warn(`  Execute: devprofile view --refresh para atualizar.\n`, flags);
  }

  const [scores, summary, insightData, session] = await Promise.all([
    scoresCurrent(),
    profileSummary(),
    insights(),
    mcpSessionCurrent(),
  ]);

  if (!scores) {
    warn("\n  ✗ Engine offline e nenhum score cacheado disponível.", flags);
    warn("  Execute: devprofile start\n", flags);
    process.exit(1);
  }

  // Only check readiness when scores are live — cache proves a profile existed before
  if (scores.source === "live" && !flags.json && !flags.scoresOnly) {
    const r = await readiness();
    if (r && !r.ready) {
      renderCollecting(r.sessions_count, r.sessions_required);
      process.exit(0);
    }
  }

  if (scores.source === "cache" && !flags.json && !flags.scoresOnly) {
    console.log(`\n  ⚠️  Engine offline — exibindo último score salvo.`);
    console.log(`  Referente a: ${scores.updated_at}`);
    console.log("  Execute: devprofile start para atualizar.\n");
  }

  const data: ProfileData = {
    scores,
    summary,
    insights: insightData?.insights ?? [],
    session,
  };

  console.log(renderProfile(data, flags));
}

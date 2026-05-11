import { scoresCurrent, profileSummary, insights, engineStatus, processNew, readiness } from "../client/engine-client";
import { mcpSessionCurrent } from "../client/mcp-client";
import { renderProfile, renderCollecting } from "../ui/profile-view";
import type { ProfileData, ViewFlags } from "../types";

interface ViewOptions {
  json?: boolean;
  scoresOnly?: boolean;
  refresh?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  const status = await engineStatus();
  const hasOrphans = status !== null && status.unprocessed_events > 0;

  if (opts.refresh) {
    if (!hasOrphans) {
      console.log("\n  Nenhum evento pendente. Score já está atualizado.\n");
    } else {
      process.stdout.write(
        `\n  Processando ${status.unprocessed_events} bytes de eventos pendentes...`,
      );
      await processNew();
      const result = await waitForProcessing();
      if (result === "done") {
        process.stdout.write(" ✓\n\n");
      } else {
        process.stdout.write("\n");
        console.log("  ⚠️  Processamento ainda em andamento (timeout 30s).");
        console.log("  O score exibido pode estar parcialmente atualizado.\n");
      }
    }
  } else if (hasOrphans) {
    console.log(`\n  ⚠️  Há eventos não processados (sessão interrompida).`);
    console.log(`  Score pode estar desatualizado.`);
    console.log(`  Execute: devprofile view --refresh para atualizar.\n`);
  }

  const [scores, summary, insightData, session] = await Promise.all([
    scoresCurrent(),
    profileSummary(),
    insights(),
    mcpSessionCurrent(),
  ]);

  if (!scores) {
    console.log("\n  ✗ Engine offline e nenhum score cacheado disponível.");
    console.log("  Execute: devprofile start\n");
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

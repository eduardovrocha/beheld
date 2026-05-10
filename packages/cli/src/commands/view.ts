import { scoresCurrent, profileSummary, insights } from "../client/engine-client";
import { mcpSessionCurrent } from "../client/mcp-client";
import { renderProfile } from "../ui/profile-view";
import type { ProfileData, ViewFlags } from "../types";

interface ViewOptions {
  json?: boolean;
  scoresOnly?: boolean;
}

export async function viewCommand(opts: ViewOptions = {}): Promise<void> {
  const flags: ViewFlags = {
    json: opts.json ?? false,
    scoresOnly: opts.scoresOnly ?? false,
  };

  const [scores, summary, insightData, session] = await Promise.all([
    scoresCurrent(),
    profileSummary(),
    insights(),
    mcpSessionCurrent(),
  ]);

  const data: ProfileData = {
    scores,
    summary,
    insights: insightData?.insights ?? [],
    session,
  };

  console.log(renderProfile(data, flags));
}

import { Database } from "bun:sqlite";
import { join } from "node:path";
import { homedir } from "node:os";

function getDbPath(): string {
  return process.env.BEHELD_CACHE_DB ?? join(homedir(), ".beheld", "profile.db");
}

export interface CachedScores {
  updated_at: string | null;
  prompt_quality: number;
  test_maturity: number;
  tech_breadth: number;
  growth_rate: number;
  overall: number;
  sessions_analyzed: number;
  source: "live" | "cache";
}

export function getLastCachedScores(): CachedScores | null {
  try {
    const db = new Database(getDbPath(), { readonly: true });
    const row = db
      .query(
        `SELECT date, prompt_quality, test_maturity, tech_breadth,
                growth_rate, overall, sessions_analyzed
         FROM scores
         ORDER BY date DESC
         LIMIT 1`,
      )
      .get() as Record<string, number | string> | null;
    db.close();

    if (!row) return null;

    return {
      updated_at:        row.date as string,
      prompt_quality:    row.prompt_quality as number,
      test_maturity:     row.test_maturity as number,
      tech_breadth:      row.tech_breadth as number,
      growth_rate:       row.growth_rate as number,
      overall:           row.overall as number,
      sessions_analyzed: row.sessions_analyzed as number,
      source:            "cache",
    };
  } catch {
    return null;
  }
}

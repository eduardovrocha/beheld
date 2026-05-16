import * as fs from "fs";
import * as path from "path";

export interface RebuildResult {
  events: number;
  sessions: Set<string>;
}

export function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function localDateOf(timestamp: string): string {
  return localDateString(new Date(timestamp));
}

function shiftDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return localDateString(date);
}

/**
 * Walks JSONL files in `sessionsDir`, counting events and unique session_ids
 * whose timestamp falls on the local-timezone date `today` (YYYY-MM-DD).
 * Filenames carry a UTC date prefix, so we widen the file scan to ±1 day to
 * catch events that crossed the UTC boundary.
 */
export function rebuildCountersFromJsonl(
  sessionsDir: string,
  today: string = localDateString(),
): RebuildResult {
  const sessions = new Set<string>();
  let events = 0;

  if (!fs.existsSync(sessionsDir)) return { events, sessions };

  const yesterday = shiftDateString(today, -1);
  const tomorrow = shiftDateString(today, +1);
  const datePrefixes = new Set([yesterday, today, tomorrow]);

  let files: string[];
  try {
    files = fs.readdirSync(sessionsDir);
  } catch (err) {
    console.warn(`[counters] failed to read ${sessionsDir}:`, err);
    return { events, sessions };
  }

  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const prefix = file.slice(0, 10);
    if (!datePrefixes.has(prefix)) continue;

    const fp = path.join(sessionsDir, file);
    let content: string;
    try {
      content = fs.readFileSync(fp, "utf8");
    } catch (err) {
      console.warn(`[counters] failed to read ${file}:`, err);
      continue;
    }

    let corruptedLines = 0;
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event: { timestamp?: unknown; session_id?: unknown };
      try {
        event = JSON.parse(trimmed);
      } catch {
        corruptedLines++;
        continue;
      }
      if (typeof event.timestamp !== "string" || typeof event.session_id !== "string") continue;
      if (localDateOf(event.timestamp) !== today) continue;
      events++;
      sessions.add(event.session_id);
    }
    if (corruptedLines > 0) {
      console.warn(`[counters] skipped ${corruptedLines} corrupted line(s) in ${file}`);
    }
  }

  return { events, sessions };
}

/**
 * Encapsulates today's event/session counters. Lazily rebuilds from JSONL on
 * day rollover (so no midnight timer needed) and on the very first access.
 */
export class Counters {
  private sessionsDir: string;
  private day = "";
  private events = 0;
  private sessionIds = new Set<string>();

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
  }

  /** Rebuilds counters from JSONL if the local date has rolled over. */
  private ensureFresh(): void {
    const today = localDateString();
    if (this.day === today) return;
    const result = rebuildCountersFromJsonl(this.sessionsDir, today);
    this.day = today;
    this.events = result.events;
    this.sessionIds = result.sessions;
  }

  /** Force a rebuild — used at startup to populate counters before serving. */
  rebuild(): void {
    this.day = "";
    this.ensureFresh();
  }

  track(event: { timestamp?: string; session_id?: string }): void {
    this.ensureFresh();
    if (!event.timestamp || !event.session_id) return;
    if (localDateOf(event.timestamp) !== this.day) return;
    this.events++;
    this.sessionIds.add(event.session_id);
  }

  eventsToday(): number {
    this.ensureFresh();
    return this.events;
  }

  sessionsToday(): number {
    this.ensureFresh();
    return this.sessionIds.size;
  }
}

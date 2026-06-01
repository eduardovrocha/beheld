import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { getBeheldDir } from "./daemon";

const ENGINE_URL = process.env.BEHELD_ENGINE_URL ?? "http://127.0.0.1:7338";
const VERSION = "0.3.2";

interface NotificationState {
  [type: string]: string;
}

interface NotificationConfig {
  enabled: boolean;
  daily_score: boolean;
  updates: boolean;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function statePath(): string {
  return join(getBeheldDir(), "notifications.json");
}

function configFilePath(): string {
  return join(getBeheldDir(), "config.json");
}

function readState(): NotificationState {
  const p = statePath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as NotificationState;
  } catch {
    return {};
  }
}

function readConfig(): NotificationConfig {
  const defaults: NotificationConfig = { enabled: true, daily_score: true, updates: true };
  const p = configFilePath();
  if (!existsSync(p)) return defaults;
  try {
    const cfg = JSON.parse(readFileSync(p, "utf8")) as {
      notifications?: Partial<NotificationConfig>;
    };
    const n = cfg.notifications ?? {};
    return {
      enabled: n.enabled ?? defaults.enabled,
      daily_score: n.daily_score ?? defaults.daily_score,
      updates: n.updates ?? defaults.updates,
    };
  } catch {
    return defaults;
  }
}

export class NotificationService {
  async send(title: string, message: string): Promise<void> {
    try {
      // Sanitize to prevent shell injection via osascript string interpolation
      const safeTitle = title.replace(/["\\]/g, "'");
      const safeMsg = message.replace(/["\\]/g, "'");
      if (process.platform === "darwin") {
        spawn(
          "osascript",
          ["-e", `display notification "${safeMsg}" with title "${safeTitle}"`],
          { stdio: "ignore" },
        );
      } else if (process.platform === "linux") {
        spawn("notify-send", [title, message], { stdio: "ignore" });
      }
    } catch (err) {
      console.error("[notifications] send failed:", err);
    }
  }

  async shouldNotifyToday(type: string): Promise<boolean> {
    const state = readState();
    return state[type] !== today();
  }

  async markNotified(type: string): Promise<void> {
    mkdirSync(getBeheldDir(), { recursive: true });
    const state = readState();
    state[type] = today();
    writeFileSync(statePath(), JSON.stringify(state, null, 2) + "\n");
  }

  async checkDailyScore(): Promise<void> {
    const config = readConfig();
    if (!config.enabled || !config.daily_score) return;
    if (!(await this.shouldNotifyToday("daily_score"))) return;

    try {
      const r = await fetch(`${ENGINE_URL}/scores/current`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!r.ok) return;
      const scores = (await r.json()) as { overall: number | null };

      // R1.2c — when every dimension is absent, overall is null. Skip the
      // notification entirely: a daily-score notification reading "score —"
      // would be noise, not signal.
      if (scores.overall === null) return;

      let delta: number | null = null;
      try {
        const histRes = await fetch(`${ENGINE_URL}/scores/history?days=2`, {
          signal: AbortSignal.timeout(2000),
        });
        if (histRes.ok) {
          const history = (await histRes.json()) as Array<{ overall: number | null }>;
          const previous = history[history.length - 2]?.overall;
          // Only compute a delta when BOTH endpoints are numeric — comparing
          // a numeric score against an absent baseline is meaningless.
          if (history.length >= 2 && typeof previous === "number") {
            delta = scores.overall - previous;
          }
        }
      } catch {
        // History unavailable — send without delta
      }

      const deltaStr =
        delta !== null ? ` (${delta >= 0 ? "+" : ""}${delta} hoje)` : "";
      await this.send("Beheld", `score ${scores.overall}${deltaStr}`);
    } catch (err) {
      console.error("[notifications] daily_score check failed:", err);
    } finally {
      await this.markNotified("daily_score");
    }
  }

  async checkUpdateAvailable(): Promise<void> {
    const config = readConfig();
    if (!config.enabled || !config.updates) return;
    if (!(await this.shouldNotifyToday("update_check"))) return;

    try {
      const res = await fetch("https://beheld.dev/api/version", {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = (await res.json()) as { version?: string };
        const latest = data.version;
        if (latest && latest !== VERSION) {
          await this.send("Beheld", `v${latest} disponível — beheld update`);
        }
      }
    } catch {
      // Network unavailable — still mark as checked
    } finally {
      await this.markNotified("update_check");
    }
  }
}

export const notificationService = new NotificationService();

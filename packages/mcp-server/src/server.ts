import * as os from "os";
import * as path from "path";
import { handlePreToolUse, handlePostToolUse, handleStop } from "./hooks/claude-code";
import { handleMcpRequest } from "./hooks/continue";
import {
  handleGeminiPreToolUse,
  handleGeminiPostToolUse,
  handleGeminiStop,
} from "./hooks/gemini";
import { handleCursorEvent } from "./hooks/cursor";
import {
  handleCodexBeforeCommand,
  handleCodexAfterCommand,
  handleCodexSessionEnd,
} from "./hooks/codex";
import { handleCopilotCliEvent } from "./hooks/copilot-cli";
import { handleCopilotVscodeEvent } from "./hooks/copilot-vscode";
import { handleWindsurfEvent } from "./hooks/windsurf";
import { sanitize } from "./sanitizer";
import { JsonlWriter } from "./writers/jsonl";
import { writePid, clearPid, rotateLogs, getBeheldDir } from "./daemon";
import { beheldCoachTool } from "./tools/coach-tool";
import { beheldTool } from "./tools/beheld-tool";
import { statusTool } from "./tools/status-tool";
import { notificationService } from "./notifications";
import { triggerEngineProcessing } from "./engine-trigger";
import { Counters } from "./counters";
import { VERSION } from "./version";
import type { BeheldEvent } from "./types";
import type { McpTool } from "./tools/types";

const TOOLS: McpTool[] = [beheldTool, beheldCoachTool, statusTool];
const startedAt = Date.now();

const writer = new JsonlWriter(getBeheldDir());
const counters = new Counters(path.join(getBeheldDir(), "sessions"));


// ─── In-memory session state ────────────────────────────────────────────────

interface SessionMeta {
  session_id: string;
  started_at: string;
  event_count: number;
  last_tool?: string;
  tools_seen: Set<string>;
  has_test_context: boolean;
}

const sessions = new Map<string, SessionMeta>();

function trackEvent(event: BeheldEvent): void {
  if (!sessions.has(event.session_id)) {
    sessions.set(event.session_id, {
      session_id: event.session_id,
      started_at: event.timestamp,
      event_count: 0,
      tools_seen: new Set(),
      has_test_context: false,
    });
  }
  const s = sessions.get(event.session_id)!;
  s.event_count++;
  if (event.tool_name) { s.last_tool = event.tool_name; s.tools_seen.add(event.tool_name); }
  if (event.has_test_context) s.has_test_context = true;
  counters.track(event);
}

function latestSession(): SessionMeta | null {
  const vals = [...sessions.values()];
  return vals.length > 0 ? vals[vals.length - 1] : null;
}

// ─── MCP protocol responses for Continue.dev ─────────────────────────────────

async function mcpResponse(body: unknown): Promise<unknown> {
  const req = body as { jsonrpc?: string; id?: unknown; method?: string; params?: unknown };
  const id = req.id ?? null;

  if (req.method === "initialize") {
    return {
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "beheld", version: VERSION },
      },
    };
  }

  if (req.method === "tools/list") {
    return {
      jsonrpc: "2.0", id,
      result: {
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      },
    };
  }

  if (req.method === "tools/call") {
    const params = req.params as Record<string, unknown> | undefined ?? {};
    const toolName = params.name as string;
    const args = (params.arguments as Record<string, unknown>) ?? {};
    const tool = TOOLS.find((t) => t.name === toolName);
    if (!tool) {
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Tool not found: ${toolName}` } };
    }
    try {
      const result = await tool.handler(args);
      return {
        jsonrpc: "2.0", id,
        result: { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }] },
      };
    } catch (err) {
      return { jsonrpc: "2.0", id, error: { code: -32603, message: "Internal tool error" } };
    }
  }

  if (typeof req.method === "string" && req.method.startsWith("notifications/")) {
    return { jsonrpc: "2.0", id, result: null };
  }

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${req.method}` } };
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function badRequest(msg: string): Response {
  return json({ error: msg }, 400);
}

// ─── Server ───────────────────────────────────────────────────────────────────

export function startServer(): ReturnType<typeof Bun.serve> {
  const port = parseInt(process.env.BEHELD_PORT ?? "7337", 10);
  counters.rebuild();
  return Bun.serve({
    port,
    hostname: "127.0.0.1",

    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const method = req.method;

      if (method === "GET" && url.pathname === "/health") {
        return json({ ok: true, version: VERSION, uptime_seconds: Math.floor((Date.now() - startedAt) / 1000) });
      }

      if (method === "GET" && url.pathname === "/status") {
        const current = latestSession();
        return json({
          running: true,
          session_active: current !== null,
          events_today: counters.eventsToday(),
          sessions_today: counters.sessionsToday(),
          pid: process.pid,
        });
      }

      if (method === "GET" && url.pathname === "/session/current") {
        const current = latestSession();
        if (!current) return json({ active: false });
        const durationMs = Date.now() - new Date(current.started_at).getTime();
        return json({
          active: true,
          session_id: current.session_id,
          duration_minutes: Math.round(durationMs / 60_000),
          event_count: current.event_count,
          tools_used: [...current.tools_seen],
          has_test_context: current.has_test_context,
        });
      }

      if (method === "POST" && url.pathname === "/hook/pre-tool") {
        let body: unknown;
        try { body = await req.json(); } catch { return badRequest("Invalid JSON"); }
        try {
          const event = handlePreToolUse(body);
          await writer.write(event);
          trackEvent(event);
          return json({ ok: true });
        } catch (err) {
          console.error("[pre-tool]", err);
          return json({ error: "Processing failed" }, 500);
        }
      }

      if (method === "POST" && url.pathname === "/hook/post-tool") {
        let body: unknown;
        try { body = await req.json(); } catch { return badRequest("Invalid JSON"); }
        try {
          const event = handlePostToolUse(body);
          await writer.write(event);
          trackEvent(event);
          return json({ ok: true });
        } catch (err) {
          console.error("[post-tool]", err);
          return json({ error: "Processing failed" }, 500);
        }
      }

      if (method === "POST" && url.pathname === "/hook/stop") {
        let body: unknown;
        try { body = await req.json(); } catch { return badRequest("Invalid JSON"); }
        try {
          const event = handleStop(body);
          await writer.write(event);
          sessions.delete(event.session_id);
          // Fire-and-forget: trigger engine processing + daily notification
          triggerEngineProcessing(event.session_id).catch(() => {});
          notificationService.checkDailyScore().catch(() => {});
          return json({ ok: true });
        } catch (err) {
          console.error("[stop]", err);
          return json({ error: "Processing failed" }, 500);
        }
      }

      // ── R2.1 — Gemini CLI native_hook routes ──────────────────────────
      // Same envelope as Claude Code's `/hook/*`, namespaced under
      // `/hook/gemini/*` so the harness adapter can wire `pre`, `post`,
      // and `stop` independently without colliding with the Claude Code
      // routes. Source stamp lands inside the handler.
      if (method === "POST" && url.pathname === "/hook/gemini/pre-tool") {
        let body: unknown;
        try { body = await req.json(); } catch { return badRequest("Invalid JSON"); }
        try {
          const event = handleGeminiPreToolUse(body);
          await writer.write(event);
          trackEvent(event);
          return json({ ok: true });
        } catch (err) {
          console.error("[gemini pre-tool]", err);
          return json({ error: "Processing failed" }, 500);
        }
      }

      if (method === "POST" && url.pathname === "/hook/gemini/post-tool") {
        let body: unknown;
        try { body = await req.json(); } catch { return badRequest("Invalid JSON"); }
        try {
          const event = handleGeminiPostToolUse(body);
          await writer.write(event);
          trackEvent(event);
          return json({ ok: true });
        } catch (err) {
          console.error("[gemini post-tool]", err);
          return json({ error: "Processing failed" }, 500);
        }
      }

      if (method === "POST" && url.pathname === "/hook/gemini/stop") {
        let body: unknown;
        try { body = await req.json(); } catch { return badRequest("Invalid JSON"); }
        try {
          const event = handleGeminiStop(body);
          await writer.write(event);
          sessions.delete(event.session_id);
          triggerEngineProcessing(event.session_id).catch(() => {});
          notificationService.checkDailyScore().catch(() => {});
          return json({ ok: true });
        } catch (err) {
          console.error("[gemini stop]", err);
          return json({ error: "Processing failed" }, 500);
        }
      }

      // ── R2.3 — Codex CLI native_hook routes ───────────────────────────
      // Hook trio mirroring Claude Code / Gemini. Codex emits
      // before_command / after_command / session_end; we expose them
      // under `/hook/codex/*` so adapters wire each independently.
      if (method === "POST" && url.pathname === "/hook/codex/before-command") {
        let body: unknown;
        try { body = await req.json(); } catch { return badRequest("Invalid JSON"); }
        try {
          const event = handleCodexBeforeCommand(body);
          await writer.write(event);
          trackEvent(event);
          return json({ ok: true });
        } catch (err) {
          console.error("[codex before-command]", err);
          return json({ error: "Processing failed" }, 500);
        }
      }

      if (method === "POST" && url.pathname === "/hook/codex/after-command") {
        let body: unknown;
        try { body = await req.json(); } catch { return badRequest("Invalid JSON"); }
        try {
          const event = handleCodexAfterCommand(body);
          await writer.write(event);
          trackEvent(event);
          return json({ ok: true });
        } catch (err) {
          console.error("[codex after-command]", err);
          return json({ error: "Processing failed" }, 500);
        }
      }

      if (method === "POST" && url.pathname === "/hook/codex/session-end") {
        let body: unknown;
        try { body = await req.json(); } catch { return badRequest("Invalid JSON"); }
        try {
          const event = handleCodexSessionEnd(body);
          await writer.write(event);
          sessions.delete(event.session_id);
          triggerEngineProcessing(event.session_id).catch(() => {});
          notificationService.checkDailyScore().catch(() => {});
          return json({ ok: true });
        } catch (err) {
          console.error("[codex session-end]", err);
          return json({ error: "Processing failed" }, 500);
        }
      }

      // ── R3.1 — Windsurf Cascade Hooks (12 events, single endpoint) ────
      // Cascade invokes the hook command synchronously and sends one
      // well-formed JSON object on stdin per fire. The user-side
      // hooks.json wires curl to push that stdin to us, naming the
      // event via `?event=...` so a single route handles all 12.
      // `event_type=stop` mapping is handled by setup_worktree finals;
      // post_cascade_response_with_transcript is dropped at the handler.
      if (method === "POST" && url.pathname === "/hook/windsurf/event") {
        let body: unknown;
        try { body = await req.json(); } catch { return badRequest("Invalid JSON"); }
        const eventName = url.searchParams.get("event") ?? "";
        try {
          const event = handleWindsurfEvent(eventName, body);
          if (!event) return json({ ok: false, reason: "unknown_or_dropped_event" });
          await writer.write(event);
          trackEvent(event);
          return json({ ok: true });
        } catch (err) {
          console.error("[windsurf event]", err);
          return json({ error: "Processing failed" }, 500);
        }
      }

      // ── R2.5 — Copilot VS Code local_log_tail (tokens estimados) ──────
      // Single ingest route; the CLI-side tail forwards parsed log lines.
      // Tokens estimated via chars/4 heuristic — flagged in metadata.
      if (method === "POST" && url.pathname === "/hook/copilot-vscode/event") {
        let body: unknown;
        try { body = await req.json(); } catch { return badRequest("Invalid JSON"); }
        try {
          const event = handleCopilotVscodeEvent(body);
          if (!event) return json({ ok: false, reason: "unknown_event_type" });
          await writer.write(event);
          trackEvent(event);
          if (event.event_type === "stop") {
            sessions.delete(event.session_id);
            triggerEngineProcessing(event.session_id).catch(() => {});
            notificationService.checkDailyScore().catch(() => {});
          }
          return json({ ok: true });
        } catch (err) {
          console.error("[copilot-vscode event]", err);
          return json({ error: "Processing failed" }, 500);
        }
      }

      // ── R2.4 — Copilot CLI statusline + log_tail blend ────────────────
      // Single ingestion route for both channels. `channel` inside the
      // payload discriminates statusline_poll vs log_line vs session_end.
      // The handler annotates metadata.channel so downstream classifiers
      // can weight them differently if they ever care.
      if (method === "POST" && url.pathname === "/hook/copilot-cli/event") {
        let body: unknown;
        try { body = await req.json(); } catch { return badRequest("Invalid JSON"); }
        try {
          const event = handleCopilotCliEvent(body);
          if (!event) return json({ ok: false, reason: "unknown_channel" });
          await writer.write(event);
          trackEvent(event);
          if (event.event_type === "stop") {
            sessions.delete(event.session_id);
            triggerEngineProcessing(event.session_id).catch(() => {});
            notificationService.checkDailyScore().catch(() => {});
          }
          return json({ ok: true });
        } catch (err) {
          console.error("[copilot-cli event]", err);
          return json({ error: "Processing failed" }, 500);
        }
      }

      // ── R2.2 — Cursor local_log_tail ingest route ─────────────────────
      // Single endpoint per sanitised log line (Cursor logs don't always
      // pair pre/post boundaries cleanly). The CLI-side tail loop POSTs
      // one CursorEventPayload at a time; this handler returns 200 with
      // ok:false when the line maps to a dropped event_type so the tail
      // can advance its cursor without re-emitting.
      if (method === "POST" && url.pathname === "/hook/cursor/event") {
        let body: unknown;
        try { body = await req.json(); } catch { return badRequest("Invalid JSON"); }
        try {
          const event = handleCursorEvent(body);
          if (!event) return json({ ok: false, reason: "unknown_event_type" });
          await writer.write(event);
          trackEvent(event);
          if (event.event_type === "stop") {
            sessions.delete(event.session_id);
            triggerEngineProcessing(event.session_id).catch(() => {});
            notificationService.checkDailyScore().catch(() => {});
          }
          return json({ ok: true });
        } catch (err) {
          console.error("[cursor event]", err);
          return json({ error: "Processing failed" }, 500);
        }
      }

      if (url.pathname === "/mcp") {
        let body: unknown;
        try { body = await req.json(); } catch { return badRequest("Invalid JSON"); }

        // Capture a BeheldEvent if the body is a Continue.dev event
        const event = handleMcpRequest(body);
        if (event) {
          const safe = sanitize(event) as BeheldEvent;
          await writer.write(safe);
          trackEvent(safe);
        }

        // Always return a proper MCP protocol response
        try {
          const response = await mcpResponse(body);
          return json(response);
        } catch (err) {
          console.error("[mcp]", err);
          return json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } }, 500);
        }
      }

      return new Response("Not Found", { status: 404 });
    },
  });
}

// ─── Daemon entry point ───────────────────────────────────────────────────────

/**
 * Defense-in-depth heartbeat — every minute the daemon re-runs the integration
 * self-heal. This catches the `/beheld` slash command file vanishing mid-session
 * (e.g. wiped by Claude Code's periodic command housekeeping or an external
 * cleanup), without relying on the SessionStart hook firing.
 *
 * The check is sub-millisecond when the file is present (just a stat). It only
 * does I/O when the file is missing or outdated. Failures stay silent — a heal
 * crash must never destabilise the daemon.
 */
/**
 * Tail heartbeat — every minute, drains pending log lines from every
 * enabled tail adapter (Cursor, Copilot CLI, Copilot VS Code).
 *
 * Tails are enabled per-adapter in ~/.beheld/config.json under the `tails`
 * array (managed by `beheld harness install`). Each tail is independent:
 * one slow tail doesn't block the others, and a tail crash never kills
 * the daemon — all errors are swallowed silently per heartbeat tick.
 *
 * Wall-clock: pollOnce is a no-op when there's nothing new (just an fs
 * stat + readFileSync slice). Real work only happens when the harness
 * actually produced log lines since the last tick.
 */
async function startTailHeartbeat(): Promise<void> {
  const { enabledTails } = await import("../../cli/src/lib/harness-installer");
  const tailRunners: Record<string, () => Promise<number>> = {
    "cursor":          (await import("../../cli/src/lib/cursor-tail")).pollOnce,
    "copilot-cli":     (await import("../../cli/src/lib/copilot-cli-tail")).pollOnce,
    "copilot-vscode":  (await import("../../cli/src/lib/copilot-vscode-tail")).pollOnce,
  };
  const tick = (): void => {
    const active = enabledTails();
    for (const name of active) {
      const runner = tailRunners[name];
      if (!runner) continue;
      runner().catch(() => { /* best-effort — never crash the daemon */ });
    }
  };
  setInterval(tick, 60_000);
}

async function startHealHeartbeat(): Promise<void> {
  const { selfHealClaudeIntegration } = await import("../../cli/src/config/hooks");
  const tick = (): void => {
    selfHealClaudeIntegration()
      .then((healed) => {
        if (healed.slashCommandRestored || healed.mcpServerRestored) {
          console.error(
            `[heal] restored: ${[
              healed.slashCommandRestored ? "slashCommand" : null,
              healed.mcpServerRestored ? "mcpServer" : null,
            ]
              .filter(Boolean)
              .join("+")}`,
          );
        }
      })
      .catch(() => { /* best-effort */ });
  };
  // Don't fire on the first tick — `beheld start` already healed once. First
  // run is one interval out.
  setInterval(tick, 60_000);
}

if (import.meta.main) {
  rotateLogs();
  writePid(process.pid);

  process.on("SIGTERM", () => { clearPid(); process.exit(0); });
  process.on("SIGINT",  () => { clearPid(); process.exit(0); });

  const server = startServer();
  console.log(`Beheld MCP server listening on http://127.0.0.1:${server.port}`);

  // Periodic self-heal so the slash command can't stay gone for more than ~1min.
  startHealHeartbeat().catch(() => { /* never block startup */ });

  // Periodic tail drain for log_tail / statusline harnesses enabled via
  // `beheld harness install`. Idempotent: no enabled tails = no-op tick.
  startTailHeartbeat().catch(() => { /* never block startup */ });
}

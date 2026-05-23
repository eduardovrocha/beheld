import * as os from "os";
import * as path from "path";
import { handlePreToolUse, handlePostToolUse, handleStop } from "./hooks/claude-code";
import { handleMcpRequest } from "./hooks/continue";
import { sanitize } from "./sanitizer";
import { JsonlWriter } from "./writers/jsonl";
import { writePid, clearPid, rotateLogs, getBeheldDir } from "./daemon";
import { beheldCoachTool } from "./tools/coach-tool";
import { beheldTool } from "./tools/beheld-tool";
import { statusTool } from "./tools/status-tool";
import { notificationService } from "./notifications";
import { triggerEngineProcessing } from "./engine-trigger";
import { Counters } from "./counters";
import type { BeheldEvent } from "./types";
import type { McpTool } from "./tools/types";

const VERSION = "0.1.1";
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

if (import.meta.main) {
  rotateLogs();
  writePid(process.pid);

  process.on("SIGTERM", () => { clearPid(); process.exit(0); });
  process.on("SIGINT",  () => { clearPid(); process.exit(0); });

  const server = startServer();
  console.log(`Beheld MCP server listening on http://127.0.0.1:${server.port}`);
}

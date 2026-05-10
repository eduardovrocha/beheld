import { handlePreTool, handlePostTool, handleStop } from "./hooks/claude-code";
import { handleMcpRequest } from "./hooks/continue";
import { writeEvent } from "./writers/jsonl";
import { writePid, clearPid, rotateLogs } from "./daemon";
import { devprofileTool } from "./tools/devprofile-tool";
import { statusTool } from "./tools/status-tool";
import type { DevProfileEvent } from "./types";
import type { McpTool } from "./tools/types";

const PORT = parseInt(process.env.DEVPROFILE_PORT ?? "7337", 10);
const VERSION = "0.1.0";
const TOOLS: McpTool[] = [devprofileTool, statusTool];

interface SessionMeta {
  session_id: string;
  started_at: string;
  event_count: number;
  last_tool?: string;
  tools_seen: Set<string>;
  has_test_context: boolean;
}

const sessions = new Map<string, SessionMeta>();
let totalEventsToday = 0;
let totalSessionsToday = 0;
const startedAt = new Date().toISOString();

function updateSession(event: DevProfileEvent): void {
  if (!sessions.has(event.session_id)) {
    sessions.set(event.session_id, {
      session_id: event.session_id,
      started_at: event.timestamp,
      event_count: 0,
      tools_seen: new Set(),
      has_test_context: false,
    });
    totalSessionsToday++;
  }
  const s = sessions.get(event.session_id)!;
  s.event_count++;
  if (event.tool_name) {
    s.last_tool = event.tool_name;
    s.tools_seen.add(event.tool_name);
  }
  if (event.has_test_context) s.has_test_context = true;
  totalEventsToday++;
}

function detectWorkflow(s: SessionMeta): string {
  const tools = [...s.tools_seen];
  if (s.has_test_context && tools.includes("Bash")) return "debug-driven";
  if (s.has_test_context) return "test-after";
  if (tools.includes("Bash") && tools.some((t) => t.includes("Edit") || t.includes("Write")))
    return "iterative";
  return "exploratory";
}

function getLatestSession(): SessionMeta | null {
  const vals = [...sessions.values()];
  return vals.length > 0 ? vals[vals.length - 1] : null;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function startServer(): ReturnType<typeof Bun.serve> {
  const server = Bun.serve({
    port: PORT,
    hostname: "127.0.0.1",

    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const method = req.method;

      // ─── Health ───────────────────────────────────────────────────────────
      if (method === "GET" && url.pathname === "/health") {
        return jsonResponse({ status: "ok", version: VERSION, port: PORT });
      }

      // ─── Daemon status ────────────────────────────────────────────────────
      if (method === "GET" && url.pathname === "/status") {
        const current = getLatestSession();
        return jsonResponse({
          status: "running",
          version: VERSION,
          pid: process.pid,
          started_at: startedAt,
          port: PORT,
          sessions_today: totalSessionsToday,
          events_today: totalEventsToday,
          current_session: current
            ? {
                session_id: current.session_id,
                event_count: current.event_count,
                workflow: detectWorkflow(current),
              }
            : null,
        });
      }

      // ─── Session metrics ──────────────────────────────────────────────────
      if (method === "GET" && url.pathname === "/session/current") {
        const current = getLatestSession();
        if (!current) return jsonResponse({ active: false });
        const durationMs = Date.now() - new Date(current.started_at).getTime();
        return jsonResponse({
          active: true,
          session_id: current.session_id,
          duration_minutes: Math.round(durationMs / 60_000),
          event_count: current.event_count,
          tools_used: [...current.tools_seen],
          workflow: detectWorkflow(current),
          has_test_context: current.has_test_context,
        });
      }

      // ─── Claude Code hooks ────────────────────────────────────────────────
      if (method === "POST" && url.pathname === "/hook/pre-tool") {
        try {
          const payload = await req.json();
          const event = handlePreTool(payload);
          writeEvent(event);
          updateSession(event);
          return jsonResponse({ ok: true });
        } catch (err) {
          return jsonResponse({ ok: false, error: String(err) }, 400);
        }
      }

      if (method === "POST" && url.pathname === "/hook/post-tool") {
        try {
          const payload = await req.json();
          const event = handlePostTool(payload);
          writeEvent(event);
          updateSession(event);
          return jsonResponse({ ok: true });
        } catch (err) {
          return jsonResponse({ ok: false, error: String(err) }, 400);
        }
      }

      if (method === "POST" && url.pathname === "/hook/stop") {
        try {
          const payload = await req.json();
          const event = handleStop(payload);
          writeEvent(event);
          sessions.delete(event.session_id);
          return jsonResponse({ ok: true });
        } catch (err) {
          return jsonResponse({ ok: false, error: String(err) }, 400);
        }
      }

      // ─── MCP endpoint for Continue.dev ────────────────────────────────────
      if (url.pathname === "/mcp") {
        try {
          const body = await req.json();
          const response = await handleMcpRequest(body, TOOLS, (event) => {
            writeEvent(event);
          });
          return jsonResponse(response);
        } catch {
          return jsonResponse(
            {
              jsonrpc: "2.0",
              id: null,
              error: { code: -32700, message: "Parse error" },
            },
            400,
          );
        }
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  return server;
}

// Run as daemon when invoked directly
if (import.meta.main) {
  rotateLogs();
  writePid(process.pid);

  process.on("SIGTERM", () => {
    clearPid();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    clearPid();
    process.exit(0);
  });

  const server = startServer();
  console.log(`DevProfile MCP server listening on http://127.0.0.1:${server.port}`);
}

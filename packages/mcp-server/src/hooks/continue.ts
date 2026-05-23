import { randomUUID } from "crypto";
import { sanitize, sanitizeCommand } from "../sanitizer";
import type { BeheldEvent } from "../types";

interface McpBody {
  method?: string;
  params?: Record<string, unknown>;
  event_type?: string;
}

function parseBody(body: unknown): McpBody | null {
  if (!body || typeof body !== "object") return null;
  return body as McpBody;
}

function extractExt(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parts = value.split(".");
  if (parts.length < 2) return undefined;
  const ext = parts[parts.length - 1];
  return ext.length > 0 && ext.length < 12 ? ext : undefined;
}

/**
 * Maps a Continue.dev MCP request to a BeheldEvent.
 * Returns null for protocol messages (initialize, tools/list, tools/call)
 * or events that carry no useful signal.
 */
export function handleMcpRequest(body: unknown): BeheldEvent | null {
  const parsed = parseBody(body);
  if (!parsed) return null;

  const eventType = parsed.event_type ?? parsed.method ?? "";
  const params = parsed.params ?? {};

  switch (eventType) {
    case "chat_request": {
      const text = typeof params.text === "string" ? params.text : "";
      const fileCtx = params.file_context as Record<string, unknown> | undefined;
      return {
        event_id: randomUUID(),
        session_id: (params.session_id as string) ?? "continue-dev",
        source: "continue-vscode",
        event_type: "chat_request",
        timestamp: new Date().toISOString(),
        prompt_length: text.length,
        has_test_context: typeof fileCtx?.path === "string"
          ? /\.(test|spec)\.|\/spec\/|\/tests?\//.test(fileCtx.path as string)
          : undefined,
        file_extension: fileCtx ? extractExt(fileCtx.path) : undefined,
        metadata: {
          has_code_context: fileCtx != null,
          model: params.model,
        },
      };
    }

    case "chat_response": {
      const text = typeof params.text === "string" ? params.text : "";
      return {
        event_id: randomUUID(),
        session_id: (params.session_id as string) ?? "continue-dev",
        source: "continue-vscode",
        event_type: "chat_response",
        timestamp: new Date().toISOString(),
        duration_ms: typeof params.duration_ms === "number" ? params.duration_ms : undefined,
        metadata: {
          response_length: text.length,
          model: params.model,
        },
      };
    }

    case "edit_apply": {
      return {
        event_id: randomUUID(),
        session_id: (params.session_id as string) ?? "continue-dev",
        source: "continue-vscode",
        event_type: "edit_apply",
        timestamp: new Date().toISOString(),
        file_extension: extractExt(params.file_path),
        metadata: {
          lines_changed: params.lines_changed,
        },
      };
    }

    case "command_run": {
      const raw = typeof params.command === "string" ? params.command : "";
      return {
        event_id: randomUUID(),
        session_id: (params.session_id as string) ?? "continue-dev",
        source: "continue-vscode",
        event_type: "command_run",
        timestamp: new Date().toISOString(),
        duration_ms: typeof params.duration_ms === "number" ? params.duration_ms : undefined,
        command_sanitized: sanitizeCommand(raw.slice(0, 500)),
        metadata: {
          exit_code: params.exit_code,
        },
      };
    }

    default:
      return null;
  }
}

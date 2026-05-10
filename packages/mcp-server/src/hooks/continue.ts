import { randomUUID } from "crypto";
import type { DevProfileEvent } from "../types";
import type { McpTool } from "../tools/types";

export interface McpRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export async function handleMcpRequest(
  req: McpRequest,
  tools: McpTool[],
  onEvent?: (event: DevProfileEvent) => void,
): Promise<McpResponse> {
  const { id, method, params } = req;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "devprofile", version: "0.1.0" },
      },
    };
  }

  if (method === "notifications/initialized") {
    return { jsonrpc: "2.0", id, result: null };
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      },
    };
  }

  if (method === "tools/call") {
    const toolName = (params as Record<string, unknown>)?.name as string;
    const toolArgs =
      ((params as Record<string, unknown>)?.arguments as Record<string, unknown>) ?? {};

    const tool = tools.find((t) => t.name === toolName);
    if (!tool) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Tool not found: ${toolName}` },
      };
    }

    if (onEvent) {
      onEvent({
        event_id: randomUUID(),
        session_id: "continue-dev",
        source: "continue-vscode",
        event_type: "tool_call",
        timestamp: new Date().toISOString(),
        tool_name: toolName,
        metadata: {},
      });
    }

    try {
      const result = await tool.handler(toolArgs);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: typeof result === "string" ? result : JSON.stringify(result),
            },
          ],
        },
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: String(err) },
      };
    }
  }

  if (method.startsWith("notifications/")) {
    return { jsonrpc: "2.0", id, result: null };
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

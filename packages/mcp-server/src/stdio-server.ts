import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { beheldCoachTool } from "./tools/coach-tool";
import { beheldTool } from "./tools/beheld-tool";
import { statusTool } from "./tools/status-tool";
import { VERSION } from "./version";
import type { McpTool } from "./tools/types";

const TOOLS: McpTool[] = [beheldTool, beheldCoachTool, statusTool];

export async function startStdioServer(): Promise<void> {
  const server = new Server(
    { name: "beheld", version: VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOLS.find((t) => t.name === request.params.name);
    if (!tool) {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }
    const args = (request.params.arguments as Record<string, unknown>) ?? {};
    const result = await tool.handler(args);
    return {
      content: [
        {
          type: "text",
          text: typeof result === "string" ? result : JSON.stringify(result),
        },
      ],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  await new Promise<void>((resolve) => {
    process.stdin.on("close", resolve);
    process.on("SIGINT", resolve);
    process.on("SIGTERM", resolve);
  });
}

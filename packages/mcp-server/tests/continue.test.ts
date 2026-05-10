import { test, expect, describe } from "bun:test";
import { handleMcpRequest } from "../src/hooks/continue";
import type { McpTool } from "../src/tools/types";
import type { McpRequest } from "../src/hooks/continue";

const echoTool: McpTool = {
  name: "echo",
  description: "Echo the input",
  inputSchema: {
    type: "object",
    properties: { message: { type: "string" } },
  },
  async handler(args) {
    return (args.message as string) ?? "no message";
  },
};

const failTool: McpTool = {
  name: "fail",
  description: "Always throws",
  inputSchema: { type: "object", properties: {} },
  async handler() {
    throw new Error("intentional failure");
  },
};

function req(method: string, params?: Record<string, unknown>): McpRequest {
  return { jsonrpc: "2.0", id: 1, method, params };
}

describe("handleMcpRequest", () => {
  test("initialize returns server info and capabilities", async () => {
    const res = await handleMcpRequest(req("initialize"), []);
    expect(res.error).toBeUndefined();
    const result = res.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe("2024-11-05");
    expect((result.serverInfo as Record<string, unknown>).name).toBe("devprofile");
  });

  test("tools/list returns registered tools", async () => {
    const res = await handleMcpRequest(req("tools/list"), [echoTool]);
    const result = res.result as { tools: Array<{ name: string }> };
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe("echo");
  });

  test("tools/list returns empty array with no tools", async () => {
    const res = await handleMcpRequest(req("tools/list"), []);
    const result = res.result as { tools: unknown[] };
    expect(result.tools).toHaveLength(0);
  });

  test("tools/call invokes tool and returns text content", async () => {
    const res = await handleMcpRequest(
      req("tools/call", { name: "echo", arguments: { message: "hello world" } }),
      [echoTool],
    );
    expect(res.error).toBeUndefined();
    const result = res.result as { content: Array<{ type: string; text: string }> };
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toBe("hello world");
  });

  test("tools/call returns error for unknown tool", async () => {
    const res = await handleMcpRequest(
      req("tools/call", { name: "nonexistent", arguments: {} }),
      [echoTool],
    );
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32601);
    expect(res.error!.message).toContain("nonexistent");
  });

  test("tools/call returns error when tool throws", async () => {
    const res = await handleMcpRequest(
      req("tools/call", { name: "fail", arguments: {} }),
      [failTool],
    );
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32603);
  });

  test("unknown method returns -32601 error", async () => {
    const res = await handleMcpRequest(req("unknown/method"), []);
    expect(res.error).toBeDefined();
    expect(res.error!.code).toBe(-32601);
  });

  test("notifications/initialized returns null result", async () => {
    const res = await handleMcpRequest(req("notifications/initialized"), []);
    expect(res.error).toBeUndefined();
    expect(res.result).toBeNull();
  });

  test("arbitrary notifications return null result", async () => {
    const res = await handleMcpRequest(req("notifications/something"), []);
    expect(res.result).toBeNull();
  });

  test("tools/call triggers onEvent callback", async () => {
    const events: string[] = [];
    await handleMcpRequest(
      req("tools/call", { name: "echo", arguments: { message: "x" } }),
      [echoTool],
      (e) => events.push(e.tool_name ?? ""),
    );
    expect(events).toContain("echo");
  });

  test("response preserves request id", async () => {
    const r: McpRequest = { jsonrpc: "2.0", id: 42, method: "initialize" };
    const res = await handleMcpRequest(r, []);
    expect(res.id).toBe(42);
  });

  test("response preserves string request id", async () => {
    const r: McpRequest = { jsonrpc: "2.0", id: "req-abc", method: "tools/list" };
    const res = await handleMcpRequest(r, []);
    expect(res.id).toBe("req-abc");
  });
});

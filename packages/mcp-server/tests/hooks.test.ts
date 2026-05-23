import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { handlePreToolUse, handlePostToolUse, handleStop } from "../src/hooks/claude-code";
import { createHash } from "crypto";

describe("handlePreToolUse", () => {
  test("creates pre_tool_use event from Bash tool", () => {
    const event = handlePreToolUse({
      session_id: "sess-1",
      tool_name: "Bash",
      tool_input: { command: "npm run build" },
      timestamp: "2026-05-10T12:00:00Z",
    });
    expect(event.event_type).toBe("pre_tool_use");
    expect(event.session_id).toBe("sess-1");
    expect(event.tool_name).toBe("Bash");
    expect(event.source).toBe("claude-code");
    expect(event.event_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("detects has_test_context when command contains rspec", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "rspec spec/models/user_spec.rb" },
    });
    expect(event.has_test_context).toBe(true);
  });

  test("detects has_test_context when command contains jest", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "jest --watch" },
    });
    expect(event.has_test_context).toBe(true);
  });

  test("detects has_test_context when command contains pytest", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "pytest tests/ -v" },
    });
    expect(event.has_test_context).toBe(true);
  });

  test("detects has_test_context when command contains playwright", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "npx playwright test" },
    });
    expect(event.has_test_context).toBe(true);
  });

  test("detects has_test_context when command contains vitest", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "vitest run" },
    });
    expect(event.has_test_context).toBe(true);
  });

  test("has_test_context is false for non-test commands", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "git status" },
    });
    expect(event.has_test_context).toBe(false);
  });

  test("has_test_context is undefined for non-Bash tools", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Read",
      tool_input: { file_path: "/project/src/app.ts" },
    });
    expect(event.has_test_context).toBeUndefined();
  });

  test("extracts file_extension from Read tool path", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Read",
      tool_input: { file_path: "/project/src/app.ts" },
    });
    expect(event.file_extension).toBe("ts");
  });

  test("extracts file_extension from Write tool path", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Write",
      tool_input: { file_path: "/project/src/models/user.rb" },
    });
    expect(event.file_extension).toBe("rb");
  });

  test("command_sanitized is set for Bash tools", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    });
    expect(event.command_sanitized).toContain("npm test");
  });

  test("command_sanitized is undefined for non-Bash tools", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Read",
      tool_input: { file_path: "/project/src/app.ts" },
    });
    expect(event.command_sanitized).toBeUndefined();
  });

  test("cwd_hash is SHA256 hex of cwd", () => {
    const cwd = "/Users/john/secret-project";
    const expected = createHash("sha256").update(cwd).digest("hex");
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "ls" },
      cwd,
    });
    expect(event.cwd_hash).toBe(expected);
  });

  test("cwd_hash does not contain the raw path", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: { command: "ls" },
      cwd: "/Users/john/secret-project",
    });
    expect(event.cwd_hash).not.toContain("john");
    expect(event.cwd_hash).not.toContain("secret");
  });

  test("sanitizes API keys embedded in tool_input before storing", () => {
    const event = handlePreToolUse({
      session_id: "s1",
      tool_name: "Bash",
      tool_input: {
        command: "echo ok",
        env: "ANTHROPIC_API_KEY=sk-testABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      },
    });
    expect(JSON.stringify(event.metadata)).not.toContain("sk-test");
  });

  test("metadata não contém paths absolutos", () => {
    const event = handlePreToolUse({
      tool_name: "Bash",
      tool_input: { command: "cd /Users/eduardo/projects/app && bun test" },
      session_id: "test-123",
      timestamp: "2026-05-11T00:00:00Z",
    });
    const metaStr = JSON.stringify(event.metadata);
    expect(metaStr).not.toMatch(/\/Users\//);
    expect(metaStr).not.toMatch(/\/home\//);
    expect(metaStr).toMatch(/\[path:[a-f0-9]{8}\]/);
  });

  test("metadata preserva valores não-path", () => {
    const event = handlePreToolUse({
      tool_name: "Bash",
      tool_input: { command: "echo hello", exit_code: 0 },
      session_id: "test-123",
      timestamp: "2026-05-11T00:00:00Z",
    });
    expect(event.metadata).toMatchObject({ command: "echo hello", exit_code: 0 });
  });

  test("command_sanitized e metadata são consistentes — ambos substituem paths por hash", () => {
    const event = handlePreToolUse({
      tool_name: "Bash",
      tool_input: { command: "/Users/eduardo/.local/bin/beheld start" },
      session_id: "test-123",
      timestamp: "2026-05-11T00:00:00Z",
    });
    expect(event.command_sanitized).toMatch(/\[path:/);
    expect(JSON.stringify(event.metadata)).toMatch(/\[path:/);
    expect(JSON.stringify(event.metadata)).not.toMatch(/\/Users\//);
  });
});

describe("handlePostToolUse", () => {
  test("creates post_tool_use event", () => {
    const event = handlePostToolUse({
      session_id: "s1",
      tool_name: "Bash",
      duration_ms: 1234,
    });
    expect(event.event_type).toBe("post_tool_use");
    expect(event.tool_name).toBe("Bash");
    expect(event.duration_ms).toBe(1234);
    expect(event.source).toBe("claude-code");
  });

  test("duration_ms is optional", () => {
    const event = handlePostToolUse({ session_id: "s1", tool_name: "Read" });
    expect(event.duration_ms).toBeUndefined();
  });
});

describe("triggerEngineProcessing", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env.BEHELD_ENGINE_URL;

  beforeEach(async () => {
    process.env.BEHELD_ENGINE_URL = "http://127.0.0.1:19998"; // dead port
    const { _resetCoalesceState } = await import("../src/engine-trigger");
    _resetCoalesceState();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEnv === undefined) {
      delete process.env.BEHELD_ENGINE_URL;
    } else {
      process.env.BEHELD_ENGINE_URL = originalEnv;
    }
  });

  test("resolves (does not reject) when engine is offline", async () => {
    const { triggerEngineProcessing } = await import("../src/engine-trigger");
    await expect(triggerEngineProcessing("sess-offline")).resolves.toBeUndefined();
  });

  test("resolves when fetch returns ok:true", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    ) as typeof fetch;

    const { triggerEngineProcessing } = await import("../src/engine-trigger");
    await expect(triggerEngineProcessing("sess-ok")).resolves.toBeUndefined();
  });

  test("resolves when fetch returns non-ok status", async () => {
    globalThis.fetch = mock(async () =>
      new Response("error", { status: 500 }),
    ) as typeof fetch;

    const { triggerEngineProcessing } = await import("../src/engine-trigger");
    await expect(triggerEngineProcessing("sess-500")).resolves.toBeUndefined();
  });

  test("resolves (does not throw) when fetch throws AbortError", async () => {
    globalThis.fetch = mock(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as typeof fetch;

    const { triggerEngineProcessing } = await import("../src/engine-trigger");
    await expect(triggerEngineProcessing("sess-abort")).resolves.toBeUndefined();
  });

  test("completes in < 200ms when engine responds immediately", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    ) as typeof fetch;

    const { triggerEngineProcessing } = await import("../src/engine-trigger");
    const start = Date.now();
    await triggerEngineProcessing("sess-fast");
    expect(Date.now() - start).toBeLessThan(200);
  });

  test("coalesces 5 sequential calls for the same session into 1 fetch", async () => {
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }) as typeof fetch;

    const { triggerEngineProcessing } = await import("../src/engine-trigger");
    for (let i = 0; i < 5; i++) {
      await triggerEngineProcessing("sess-coalesce");
    }
    expect(callCount).toBe(1);
  });

  test("coalesces 5 parallel calls for the same session into 1 fetch", async () => {
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      // Tiny delay so the in-flight check has time to fire for siblings
      await new Promise((r) => setTimeout(r, 20));
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }) as typeof fetch;

    const { triggerEngineProcessing } = await import("../src/engine-trigger");
    await Promise.all([
      triggerEngineProcessing("sess-parallel"),
      triggerEngineProcessing("sess-parallel"),
      triggerEngineProcessing("sess-parallel"),
      triggerEngineProcessing("sess-parallel"),
      triggerEngineProcessing("sess-parallel"),
    ]);
    expect(callCount).toBe(1);
  });

  test("does NOT coalesce different session_ids", async () => {
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }) as typeof fetch;

    const { triggerEngineProcessing } = await import("../src/engine-trigger");
    await triggerEngineProcessing("sess-A");
    await triggerEngineProcessing("sess-B");
    await triggerEngineProcessing("sess-C");
    expect(callCount).toBe(3);
  });

  test("coalesces even when engine is offline (no log spam)", async () => {
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;

    const { triggerEngineProcessing } = await import("../src/engine-trigger");
    for (let i = 0; i < 8; i++) {
      await triggerEngineProcessing("sess-burst-offline");
    }
    expect(callCount).toBe(1);
  });
});

describe("handleStop", () => {
  test("creates stop event with total_turns in metadata", () => {
    const event = handleStop({
      session_id: "s1",
      total_turns: 15,
      timestamp: "2026-05-10T12:30:00Z",
    });
    expect(event.event_type).toBe("stop");
    expect(event.session_id).toBe("s1");
    expect(event.metadata.total_turns).toBe(15);
    expect(event.timestamp).toBe("2026-05-10T12:30:00Z");
  });

  test("uses current timestamp when none provided", () => {
    const before = Date.now();
    const event = handleStop({ session_id: "s1" });
    const ts = new Date(event.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
  });
});

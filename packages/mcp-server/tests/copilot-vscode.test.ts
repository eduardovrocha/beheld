/**
 * R2.5 — Copilot VS Code adapter tests.
 *
 * Pins the estimation invariants:
 *   - metadata.estimated=true on every event
 *   - tokens_estimated_* derived as chars/4 (round, min 1)
 *   - prompt_length stays as the raw char count (accurate, not estimated)
 *   - file paths reduce to extensions; workspace hashed
 */
import { test, expect, describe } from "bun:test";
import { createHash } from "crypto";
import { estimateTokens, handleCopilotVscodeEvent } from "../src/hooks/copilot-vscode";

describe("estimateTokens — R2.5", () => {
  test("returns undefined for missing/zero/negative chars", () => {
    expect(estimateTokens(undefined)).toBeUndefined();
    expect(estimateTokens(0)).toBeUndefined();
    expect(estimateTokens(-5)).toBeUndefined();
  });

  test("rounds chars/4 with a min of 1", () => {
    expect(estimateTokens(1)).toBe(1);
    expect(estimateTokens(3)).toBe(1);
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(5)).toBe(1);
    expect(estimateTokens(8)).toBe(2);
    expect(estimateTokens(100)).toBe(25);
    expect(estimateTokens(1024)).toBe(256);
  });
});

describe("handleCopilotVscodeEvent — R2.5 inline_suggestion", () => {
  test("estimates prompt + response tokens, keeps raw prompt_length", () => {
    const e = handleCopilotVscodeEvent({
      event_type: "inline_suggestion",
      session_id: "cv-1",
      prompt_length: 200,
      response_length: 80,
      file_path: "src/main.ts",
      model: "copilot-codex",
    });
    expect(e?.event_type).toBe("inline_suggestion");
    expect(e?.source).toBe("copilot-vscode");
    expect(e?.prompt_length).toBe(200);
    expect(e?.file_extension).toBe("ts");
    expect(e?.metadata.estimated).toBe(true);
    expect(e?.metadata.estimation_method).toBe("chars_div_4");
    expect(e?.metadata.tokens_estimated_prompt).toBe(50);
    expect(e?.metadata.tokens_estimated_response).toBe(20);
    expect(e?.metadata.model).toBe("copilot-codex");
  });
});

describe("handleCopilotVscodeEvent — R2.5 code_completion", () => {
  test("captures duration_ms + extension + estimates", () => {
    const e = handleCopilotVscodeEvent({
      event_type: "code_completion",
      file_path: "lib/utils.py",
      prompt_length: 40,
      response_length: 12,
      duration_ms: 90,
    });
    expect(e?.event_type).toBe("code_completion");
    expect(e?.file_extension).toBe("py");
    expect(e?.duration_ms).toBe(90);
    expect(e?.metadata.tokens_estimated_prompt).toBe(10);
    expect(e?.metadata.tokens_estimated_response).toBe(3);
  });
});

describe("handleCopilotVscodeEvent — R2.5 chat_request", () => {
  test("ingests prompt only (no response counted on request side)", () => {
    const e = handleCopilotVscodeEvent({
      event_type: "chat_request",
      session_id: "cv-2",
      prompt_length: 320,
      file_path: "app/routes/Home.tsx",
    });
    expect(e?.event_type).toBe("chat_request");
    expect(e?.prompt_length).toBe(320);
    expect(e?.file_extension).toBe("tsx");
    expect(e?.metadata.tokens_estimated_prompt).toBe(80);
    expect(e?.metadata.tokens_estimated_response).toBeUndefined();
  });
});

describe("handleCopilotVscodeEvent — R2.5 session_end", () => {
  test("emits stop + total_turns + workspace hashed", () => {
    const ws = "/Users/eduardo/private-vscode-project";
    const expected = createHash("sha256").update(ws).digest("hex");
    const e = handleCopilotVscodeEvent({
      event_type: "session_end",
      session_id: "cv-3",
      total_turns: 22,
      workspace: ws,
    });
    expect(e?.event_type).toBe("stop");
    expect(e?.metadata.total_turns).toBe(22);
    expect(e?.metadata.estimated).toBe(true);
    expect(e?.cwd_hash).toBe(expected);
    expect(JSON.stringify(e)).not.toContain(ws);
  });
});

describe("handleCopilotVscodeEvent — R2.5 privacy invariants", () => {
  test("never embeds prompt or response text — only length counts", () => {
    const e = handleCopilotVscodeEvent({
      event_type: "chat_request",
      session_id: "s",
      prompt_length: 50,
    });
    const serialised = JSON.stringify(e);
    // No fields named like text/content/body even by accident.
    expect(serialised).not.toMatch(/"text":/);
    expect(serialised).not.toMatch(/"content":/);
    expect(serialised).not.toMatch(/"body":/);
  });

  test("unknown event_type → null (drop, don't ingest)", () => {
    expect(handleCopilotVscodeEvent({ event_type: "future_event" })).toBeNull();
  });

  test("non-object body → null", () => {
    expect(handleCopilotVscodeEvent(undefined)).toBeNull();
    expect(handleCopilotVscodeEvent(42)).toBeNull();
  });
});

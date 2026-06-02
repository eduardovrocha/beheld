/**
 * R3.1 — Windsurf adapter tests.
 *
 * Covers all 12 Cascade events documented in docs/r3-windsurf-spike.md
 * plus a dedicated privacy-pinning suite that asserts the three
 * text-bearing fields (user_prompt, response, edits[]) never reach the
 * serialised BeheldEvent.
 */
import { test, expect, describe } from "bun:test";
import { createHash } from "crypto";
import {
  handleWindsurfEvent,
  WINDSURF_EVENTS,
} from "../src/hooks/windsurf";

function envelope(extra: Record<string, unknown> = {}) {
  return {
    agent_action_name: "test_action",
    trajectory_id:     "traj-abc",
    execution_id:      "exec-1",
    timestamp:         "2026-06-02T10:00:00Z",
    model_name:        "claude-sonnet-4-6",
    ...extra,
  };
}

// ── happy paths per event ────────────────────────────────────────────────

describe("handleWindsurfEvent — R3.1 read_code", () => {
  test("pre_read_code → pre_tool_use with tool_name=Read + extension", () => {
    const e = handleWindsurfEvent("pre_read_code", envelope({
      tool_info: { file_path: "src/auth/login.ts" },
    }));
    expect(e?.event_type).toBe("pre_tool_use");
    expect(e?.source).toBe("windsurf");
    expect(e?.session_id).toBe("traj-abc");
    expect(e?.tool_name).toBe("Read");
    expect(e?.file_extension).toBe("ts");
    expect(e?.metadata.model).toBe("claude-sonnet-4-6");
  });

  test("post_read_code → post_tool_use without extension (no file_path on post)", () => {
    const e = handleWindsurfEvent("post_read_code", envelope({ tool_info: {} }));
    expect(e?.event_type).toBe("post_tool_use");
    expect(e?.tool_name).toBe("Read");
  });
});

describe("handleWindsurfEvent — R3.1 write_code", () => {
  test("pre_write_code → pre_tool_use Write + extension only", () => {
    const e = handleWindsurfEvent("pre_write_code", envelope({
      tool_info: { file_path: "app/main.py" },
    }));
    expect(e?.event_type).toBe("pre_tool_use");
    expect(e?.tool_name).toBe("Write");
    expect(e?.file_extension).toBe("py");
  });

  test("post_write_code → drops edits[] text, keeps edits_count", () => {
    const e = handleWindsurfEvent("post_write_code", envelope({
      tool_info: {
        file_path: "lib/x.ts",
        edits: [
          { old_string: "PRIVATE_KEY_LEAK", new_string: "PUBLIC_KEY_LEAK" },
          { old_string: "another secret",  new_string: "another replacement" },
        ],
      },
    }));
    expect(e?.event_type).toBe("post_tool_use");
    expect(e?.metadata.edits_count).toBe(2);

    const serialised = JSON.stringify(e);
    expect(serialised).not.toContain("PRIVATE_KEY_LEAK");
    expect(serialised).not.toContain("PUBLIC_KEY_LEAK");
    expect(serialised).not.toContain("another secret");
    expect(serialised).not.toContain("another replacement");
    expect(serialised).not.toMatch(/"old_string"|"new_string"/);
  });
});

describe("handleWindsurfEvent — R3.1 run_command", () => {
  test("pre_run_command → Bash with sanitised+bounded command + test ctx", () => {
    const cmd = "pytest -k 'leak' Bearer ghp_LeakedTokenLong " + "x".repeat(800);
    const e = handleWindsurfEvent("pre_run_command", envelope({
      tool_info: { command_line: cmd, cwd: "/Users/eduardo/sec" },
    }));
    expect(e?.event_type).toBe("pre_tool_use");
    expect(e?.tool_name).toBe("Bash");
    expect(e?.has_test_context).toBe(true);
    expect(e!.command_sanitized!.length).toBeLessThanOrEqual(500);
    expect(e!.command_sanitized!).not.toContain("ghp_LeakedTokenLong");
    expect(e?.cwd_hash).toBe(createHash("sha256").update("/Users/eduardo/sec").digest("hex"));
  });

  test("post_run_command → Bash + cwd_hash only", () => {
    const e = handleWindsurfEvent("post_run_command", envelope({
      tool_info: { cwd: "/Users/eduardo/sec" },
    }));
    expect(e?.event_type).toBe("post_tool_use");
    expect(e?.tool_name).toBe("Bash");
    expect(e?.cwd_hash).toBeDefined();
  });
});

describe("handleWindsurfEvent — R3.1 mcp_tool_use", () => {
  test("pre_mcp_tool_use → tool_name=mcp_tool_name, sanitiser strips real ghp_ token", () => {
    // GITHUB_TOKEN regex requires ghp_ + exactly 36 chars — use a
    // realistic-length token so the sanitizer's outer JSON pass triggers.
    const realToken = "ghp_" + "A".repeat(36);
    const e = handleWindsurfEvent("pre_mcp_tool_use", envelope({
      tool_info: {
        mcp_server_name: "github",
        mcp_tool_name: "list_pulls",
        mcp_tool_arguments: { repo: "x/y", token: realToken },
      },
    }));
    expect(e?.event_type).toBe("pre_tool_use");
    expect(e?.tool_name).toBe("list_pulls");
    expect(e?.metadata.mcp_server).toBe("github");
    expect(JSON.stringify(e?.metadata)).not.toContain(realToken);
    expect(JSON.stringify(e?.metadata)).toContain("<redacted>");
  });

  test("post_mcp_tool_use → drops mcp_result, carries has_result flag", () => {
    const e = handleWindsurfEvent("post_mcp_tool_use", envelope({
      tool_info: {
        mcp_server_name: "fs",
        mcp_tool_name: "read_file",
        mcp_result: { contents: "SECRET PRIVATE CONTENT" },
      },
    }));
    expect(e?.event_type).toBe("post_tool_use");
    expect(e?.metadata.has_result).toBe(true);
    expect(JSON.stringify(e)).not.toContain("SECRET PRIVATE CONTENT");
    expect(JSON.stringify(e)).not.toMatch(/"contents"/);
  });

  test("post_mcp_tool_use → has_result=false when payload is null/missing", () => {
    const e = handleWindsurfEvent("post_mcp_tool_use", envelope({
      tool_info: { mcp_server_name: "fs", mcp_tool_name: "noop" },
    }));
    expect(e?.metadata.has_result).toBe(false);
  });
});

describe("handleWindsurfEvent — R3.1 pre_user_prompt (PRIVACY)", () => {
  test("ingests prompt_length, NEVER the user_prompt text", () => {
    const promptText =
      "TOPSECRET prompt with my CEO's private business plan and bearer sk-leak-123";
    const e = handleWindsurfEvent("pre_user_prompt", envelope({
      tool_info: { user_prompt: promptText },
    }));
    expect(e?.event_type).toBe("chat_request");
    expect(e?.prompt_length).toBe(promptText.length);

    const serialised = JSON.stringify(e);
    expect(serialised).not.toContain("TOPSECRET");
    expect(serialised).not.toContain("business plan");
    expect(serialised).not.toContain("sk-leak-123");
    expect(serialised).not.toMatch(/"user_prompt"/);
  });

  test("missing user_prompt yields prompt_length=0 (still an emitted event)", () => {
    const e = handleWindsurfEvent("pre_user_prompt", envelope({ tool_info: {} }));
    expect(e?.event_type).toBe("chat_request");
    expect(e?.prompt_length).toBe(0);
  });
});

describe("handleWindsurfEvent — R3.1 post_cascade_response (PRIVACY)", () => {
  test("ingests response_length only, NEVER the markdown response", () => {
    const respMd =
      "# Plan\nHere is a SUPERSECRET reply with `private code` and *sensitive* hints.";
    const e = handleWindsurfEvent("post_cascade_response", envelope({
      tool_info: { response: respMd },
    }));
    expect(e?.event_type).toBe("chat_response");
    expect(e?.metadata.response_length).toBe(respMd.length);

    const serialised = JSON.stringify(e);
    expect(serialised).not.toContain("SUPERSECRET");
    expect(serialised).not.toContain("private code");
    expect(serialised).not.toContain("sensitive");
    expect(serialised).not.toMatch(/"response":/);
  });
});

describe("handleWindsurfEvent — R3.1 transcript + worktree", () => {
  test("post_cascade_response_with_transcript → null (dropped at handler)", () => {
    const e = handleWindsurfEvent("post_cascade_response_with_transcript", envelope({
      tool_info: { transcript_path: "/var/folders/x/y/transcript.jsonl" },
    }));
    expect(e).toBeNull();
  });

  test("post_setup_worktree → worktree_setup + cwd_hash from root_workspace_path", () => {
    const root = "/Users/eduardo/work-tree-secret";
    const expected = createHash("sha256").update(root).digest("hex");
    const e = handleWindsurfEvent("post_setup_worktree", envelope({
      tool_info: { worktree_path: "/var/tmp/wt", root_workspace_path: root },
    }));
    expect(e?.event_type).toBe("worktree_setup");
    expect(e?.cwd_hash).toBe(expected);
    expect(JSON.stringify(e)).not.toContain(root);
    expect(JSON.stringify(e)).not.toContain("/var/tmp/wt");
  });
});

describe("handleWindsurfEvent — R3.1 unknown / structural fallbacks", () => {
  test("unknown event name → null", () => {
    expect(handleWindsurfEvent("pre_quantum_state", envelope())).toBeNull();
  });

  test("empty event name → null", () => {
    expect(handleWindsurfEvent("", envelope())).toBeNull();
  });

  test("non-object body → null (handler is strict: only well-formed envelopes ingest)", () => {
    // Cascade's contract is "well-formed JSON object per invocation".
    // A primitive on the wire violates the contract; the handler returns
    // null and the server route reports ok:false rather than ingesting a
    // structurally meaningless event.
    expect(handleWindsurfEvent("pre_user_prompt", "not an object")).toBeNull();
    expect(handleWindsurfEvent("pre_user_prompt", 42)).toBeNull();
    expect(handleWindsurfEvent("pre_user_prompt", null)).toBeNull();
  });
});

describe("handleWindsurfEvent — R3.1 closed event set", () => {
  test("WINDSURF_EVENTS exposes the documented 12 names verbatim", () => {
    expect(WINDSURF_EVENTS).toEqual([
      "pre_read_code",
      "post_read_code",
      "pre_write_code",
      "post_write_code",
      "pre_run_command",
      "post_run_command",
      "pre_mcp_tool_use",
      "post_mcp_tool_use",
      "pre_user_prompt",
      "post_cascade_response",
      "post_cascade_response_with_transcript",
      "post_setup_worktree",
    ]);
    expect(WINDSURF_EVENTS.length).toBe(12);
  });

  test("every WINDSURF_EVENTS entry either emits or explicitly drops — never crashes", () => {
    for (const ev of WINDSURF_EVENTS) {
      // envelope-only call: minimal tool_info. Should never throw.
      // Returns null for the transcript event, BeheldEvent for the rest.
      const out = handleWindsurfEvent(ev, envelope({ tool_info: {} }));
      if (ev === "post_cascade_response_with_transcript") {
        expect(out).toBeNull();
      } else {
        expect(out).not.toBeNull();
        expect(out?.source).toBe("windsurf");
      }
    }
  });
});

# R3.0 — Windsurf spike (decision document)

**Decision:** ✅ **GO** for R3.1.
**Capture fidelity:** `native_hook`.
**Date:** 2026-06-02.
**Sources:**
- [Cascade Hooks — official docs](https://docs.windsurf.com/windsurf/cascade/hooks)
- [Windsurf Editor — Codeium](https://windsurf.com/editor)

---

## 1 · Why a spike

R2 closed five adapters (Gemini CLI, Cursor, Codex CLI, Copilot CLI, Copilot
VS Code). Windsurf was deliberately split into R3.0 (research) + R3.1
(implementation) because — going in — it was unclear whether Windsurf
exposed any structured capture surface at all. The R3 design needed a fact
base before committing to a capture path, and the registry's closed
`capture_fidelity` enum left no room for guessing the tier.

This document is the decision: **does Windsurf join the wave, and if so at
what fidelity?**

## 2 · What Windsurf actually exposes

Windsurf is Codeium's VS Code fork with an agent named *Cascade*. Reading
the public docs end-to-end (`docs.windsurf.com/windsurf/cascade/hooks`)
surfaced a richer capture surface than any other R2 adapter:

### 2.1 · Cascade Hooks (12 events, synchronous, stdin-delivered)

| Event | Phase | Wire `tool_info` fields |
|---|---|---|
| `pre_read_code` / `post_read_code`         | tool boundary | `file_path` |
| `pre_write_code` / `post_write_code`       | tool boundary | `file_path`, `edits[].old_string/new_string` (post only) |
| `pre_run_command` / `post_run_command`     | tool boundary | `command_line`, `cwd` |
| `pre_mcp_tool_use` / `post_mcp_tool_use`   | tool boundary | `mcp_server_name`, `mcp_tool_name`, `mcp_tool_arguments`, `mcp_result` (post only) |
| `pre_user_prompt`                          | chat turn     | `user_prompt` *(full text)* |
| `post_cascade_response`                    | chat turn     | `response` *(markdown)* |
| `post_cascade_response_with_transcript`    | session       | `transcript_path` *(JSONL on disk)* |
| `post_setup_worktree`                      | workspace     | `worktree_path`, `root_workspace_path` |

Every event also carries the common envelope:

```
{
  "agent_action_name": "...",
  "trajectory_id":     "...",  ← used as Beheld session_id
  "execution_id":      "...",
  "timestamp":         "ISO 8601",
  "model_name":        "...",
  "tool_info":         { event-specific }
}
```

### 2.2 · Delivery mechanics

- **JSON via stdin** — one well-formed object per hook invocation.
- **Synchronous** — Cascade waits for the script to exit; exit code 2 on
  a pre-hook blocks the action. Beheld never blocks, so we always exit 0.
- **Three config scopes** merged in order: system → user → workspace.
  The user-level config lives at `~/.codeium/windsurf/hooks.json` and is
  the natural target for `beheld init`'s installer.

### 2.3 · Why this is `native_hook`

Compared with the R2.2 (Cursor) `local_log_tail` path:

| Property | Cascade Hooks | Cursor log tail |
|---|---|---|
| Schema is officially documented | ✅ | ❌ (reverse-engineered) |
| Synchronous to the action | ✅ | ❌ (log lines lag the UI) |
| Per-tool boundaries cleanly paired (pre/post) | ✅ | ❌ |
| Stable identifier per session | ✅ (`trajectory_id`) | ⚠️ (varies) |
| Survives Cascade UI restart | ✅ (hooks fire from agent runtime) | ⚠️ (log rotation can mask gaps) |

All five rows match Claude Code / Gemini CLI / Codex CLI — i.e. the
existing `native_hook` peers — so registering Windsurf at the same
fidelity tier is consistent, not aspirational.

## 3 · Mapping to Beheld's BeheldEvent

Twelve Cascade events collapse to the canonical Beheld vocabulary
without information loss for the dimensions Beheld scores. The
mapping locks in here and is the contract R3.1 implements:

| Cascade event | Beheld `event_type` | `tool_name` | Privacy slice |
|---|---|---|---|
| `pre_read_code`           | `pre_tool_use`     | `"Read"`    | file_path → extension only |
| `post_read_code`          | `post_tool_use`    | `"Read"`    | none |
| `pre_write_code`          | `pre_tool_use`     | `"Write"`   | file_path → extension only |
| `post_write_code`         | `post_tool_use`    | `"Write"`   | edits[] DROPPED; carry `metadata.edits_count` only |
| `pre_run_command`         | `pre_tool_use`     | `"Bash"`    | `command_line` sanitised + bounded (500) |
| `post_run_command`        | `post_tool_use`    | `"Bash"`    | none |
| `pre_mcp_tool_use`        | `pre_tool_use`     | mcp_tool_name | arguments → metadata via sanitizeMetadata |
| `post_mcp_tool_use`       | `post_tool_use`    | mcp_tool_name | mcp_result DROPPED; carry `metadata.has_result` only |
| `pre_user_prompt`         | `chat_request`    | —           | **`user_prompt` text DROPPED**; carry `prompt_length` only |
| `post_cascade_response`   | `chat_response`   | —           | **`response` text DROPPED**; carry `response_length` only |
| `post_cascade_response_with_transcript` | DROP at handler (returns null) | — | transcript_path is a fs path; we already captured each turn via the other hooks |
| `post_setup_worktree`     | `worktree_setup`  | —           | `worktree_path` + `root_workspace_path` → `cwd_hash` |

Session id: `trajectory_id`. Cwd hash: from `cwd` (run_command) or
`root_workspace_path` (worktree). The standard `sanitize` chain runs on
every event before any disk write — secrets, env values, tokens all
redacted.

## 4 · Privacy gates (non-negotiable)

Three Cascade hooks carry user-authored text:

- `pre_user_prompt.user_prompt` → the literal prompt
- `post_cascade_response.response` → the literal Cascade reply
- `post_write_code.edits[]` → before/after code strings

**None of these reach disk.** The R3.1 handler computes lengths
in-memory and discards the text immediately; the BeheldEvent that the
JSONL writer sees never had the text field. This is the same posture
Beheld holds for Continue.dev's `chat_request` (Phase 5) and for
Copilot VS Code (R2.5); R3 inherits it.

The `transcript_path` event is dropped entirely — even though the
JSONL on disk is a richer signal source than the live hooks, ingesting
it would mean reading prompt text from a file Beheld doesn't own, and
the per-event hooks already give us the dimensions we score.

## 5 · Installation surface

`hooks.json` lives at `~/.codeium/windsurf/hooks.json`. The natural
shape for the user-level config is one entry per event, each invoking
the same single endpoint via `curl`:

```json
{
  "hooks": {
    "pre_run_command":  [{ "command": "curl -sS -X POST -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:7337/hook/windsurf/event?event=pre_run_command || true" }],
    "post_run_command": [{ "command": "curl -sS -X POST -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:7337/hook/windsurf/event?event=post_run_command || true" }],
    "...": "..."
  }
}
```

`|| true` ensures Beheld never blocks a Cascade action when the daemon
is offline; the server route accepts the event name via query param so
the same one-liner works for all 12 events.

R3.1 ships a tiny installer helper that writes this config (merging
with existing hooks if present) so `beheld init` keeps its one-shot
property on a Windsurf host.

## 6 · Decision

**GO for R3.1.** Implementation slots cleanly into the existing R2
adapter pattern:

- +1 entry in `harness_registry.py` (`"windsurf" → ("windsurf",
  "native_hook")`)
- +1 handler module `packages/mcp-server/src/hooks/windsurf.ts`
- +1 server route `POST /hook/windsurf/event?event=<name>`
- +1 test file mirroring `gemini.test.ts` / `codex.test.ts` shape,
  plus a privacy test pinning that `user_prompt` and `response` text
  never reach the BeheldEvent

No new dependencies, no new daemons, no new disk paths beyond the
existing `~/.beheld/`. The R3.0 → R3.1 boundary is clean.

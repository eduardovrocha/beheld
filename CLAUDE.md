# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

Pre-implementation phase. The authoritative reference for everything to be built is [documents/beheld-mvp-spec.md](documents/beheld-mvp-spec.md) (v2).

## What Beheld Is

A privacy-first developer profiling system that silently captures usage metadata from Claude Code and Continue.dev to generate 4 developer scores — without ever storing conversation content, file contents, or secrets. Distributed as a single standalone binary; no Node.js, Python, or npm required on the host.

## Monorepo Structure

```
beheld/
├── packages/
│   ├── mcp-server/   # Phases 1 & 4 — TypeScript (Bun), port 7337
│   ├── engine/       # Phase 2 — Python (PyInstaller), port 7338
│   └── cli/          # Phase 3 — TypeScript (Bun), entry point
├── scripts/
│   ├── build.sh      # local dev build
│   └── install.sh    # public install script (curl | sh)
├── .github/workflows/
│   ├── ci.yml        # tests on every PR
│   └── release.yml   # build + publish on tag
└── package.json      # Bun workspaces root
```

Phase 4 (VS Code integration) is implemented as MCP tools inside `mcp-server` — there is no separate `vscode/` package.

## Build Commands

### TypeScript packages (mcp-server, cli)
```bash
bun install                      # installs all workspaces from repo root
bun test                         # run tests
bun run dev                      # dev mode

# Standalone binary (local, current platform)
bun build packages/cli/src/index.ts --compile --outfile dist/beheld

# CI cross-compilation (all targets)
bun build packages/cli/src/index.ts --compile --target=bun-darwin-arm64 --outfile dist/beheld-darwin-arm64
bun build packages/cli/src/index.ts --compile --target=bun-darwin-x64   --outfile dist/beheld-darwin-x64
bun build packages/cli/src/index.ts --compile --target=bun-linux-x64    --outfile dist/beheld-linux-x64
```

### Python engine
```bash
pip install -e packages/engine[dev]
pytest packages/engine/tests

# Standalone binary (PyInstaller — no Python on host)
cd packages/engine
pyinstaller --onefile --name beheld-engine src/main.py
```

The PyInstaller output (`dist/beheld-engine`) is copied to `packages/cli/assets/` and bundled inside the TypeScript binary. On first run, the CLI extracts it to `~/.beheld/bin/engine`.

## Architecture & Data Flow

```
Claude Code hooks (PreToolUse / PostToolUse / Stop)
Continue.dev MCP events
        ↓
[Sanitizer — strips secrets, env var values, prompt text, raw paths]
        ↓
~/.beheld/sessions/YYYY-MM-DD_<uuid>.jsonl   (50 MB max, daily rotation)
        ↓
Scoring Engine (Python FastAPI :7338)
  → reads JSONL incrementally — cursor at ~/.beheld/.cursor
  → extractors: commands, file extensions, tool sequences, timing
  → classifiers: project type (no business domain), platform, workflow pattern
  → scorers: prompt_quality, test_maturity, tech_breadth, growth_rate (0–100 each)
  → persists to ~/.beheld/profile.db (SQLite)
        ↓
CLI (beheld view / /beheld slash command) and Continue.dev sidebar
consume :7337 and :7338
```

## Key Design Invariants

**Sanitizer runs on every event before any write.** Patterns in `packages/mcp-server/src/sanitizer.ts` must redact: env var values, Anthropic API keys (`sk-...`), GitHub tokens (`ghp_...`), Bearer tokens, passwords. Only metadata is ever stored.

**All network calls stay on localhost.** No outbound calls without explicit user opt-in. The one exception is AI insights in the engine, which sends only anonymized scores/signals to `claude-sonnet-4-6` (Ollama fallback: `qwen2.5-coder:14b`).

**Phase 0 must complete first.** Without a working build pipeline, nothing else can be distributed or tested end-to-end.

**`~/.beheld/` permissions must be `700`.**

## Runtime Ports & Files

| Resource | Location |
|----------|----------|
| MCP server | `localhost:7337` |
| Scoring engine | `localhost:7338` |
| JSONL events | `~/.beheld/sessions/` |
| SQLite database | `~/.beheld/profile.db` |
| Reader cursor | `~/.beheld/.cursor` |
| Daemon PID | `~/.beheld/daemon.pid` |
| Daemon log | `~/.beheld/daemon.log` (10 MB rotation) |
| Extracted engine binary | `~/.beheld/bin/engine` |
| Config | `~/.beheld/config.json` |

## Core Event Interface

```typescript
interface BeheldEvent {
  event_id: string;          // uuid v4
  session_id: string;
  source: "claude-code" | "continue-vscode";
  event_type: string;        // "pre_tool_use" | "post_tool_use" | "chat_request" | ...
  timestamp: string;         // ISO 8601
  duration_ms?: number;
  tool_name?: string;
  file_extension?: string;
  command_sanitized?: string;
  prompt_length?: number;    // character count only — never content
  has_test_context?: boolean;
  cwd_hash?: string;         // hashed, never the raw path
  metadata: Record<string, unknown>;
}
```

## SQLite Schema (4 tables)

`sessions` — one row per session with workflow pattern and project category  
`technical_signals` — platform/ecosystem/tool signals per session  
`scores` — one row per day (prompt_quality, test_maturity, tech_breadth, growth_rate, overall)  
`profile` — key/value aggregate, updated each processing run

## Hook & MCP Registration

`beheld init` writes to `~/.claude/settings.json` (Claude Code hooks: PreToolUse, PostToolUse, Stop) and `~/.continue/config.json` (MCP server at `http://localhost:7337/mcp`).

The `/beheld` slash command is a MCP tool (`beheld` tool in `packages/mcp-server/src/tools/beheld-tool.ts`) — registered automatically by `beheld init`, no separate configuration needed.

## Phase 4: VS Code Integration (no VSIX)

Phase 4 lives entirely inside `packages/mcp-server`. There is no VS Code extension package. Integration points:
- **Continue.dev sidebar**: `beheld_status` MCP tool returns current score
- **Slash commands**: `/beheld`, `/beheld scores`, `/beheld insight` via Continue.dev
- **OS notifications**: sent by the daemon via `osascript` (macOS) or `notify-send` (Linux), max 1/day

## Testing Strategy

| Package | Framework | Notes |
|---------|-----------|-------|
| mcp-server | `bun test` | Use real Claude Code hook JSON fixtures |
| engine | pytest | Use JSONL fixtures generated from mcp-server tests |
| cli | `bun test` | Mock daemon HTTP responses |
| Phase 4 | Manual | VS Code + Continue.dev v0.9+ on macOS and Linux |
| Phase 0 smoke | — | `beheld --version` on the compiled binary |

## Distribution Targets

| Platform | Binary name | Est. size |
|----------|-------------|-----------|
| macOS Apple Silicon | `beheld-darwin-arm64` | ~45 MB |
| macOS Intel | `beheld-darwin-x64` | ~45 MB |
| Linux x64 | `beheld-linux-x64` | ~48 MB |
| Windows x64 | `beheld-windows-x64.exe` | post-MVP |

Each release includes a `.sha256` checksum and GPG signature. The install script verifies the checksum before executing the binary.

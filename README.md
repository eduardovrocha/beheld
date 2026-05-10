# DevProfile

Privacy-first developer profiling built on real Claude Code and Continue.dev usage. Captures technical metadata silently — never conversation content, file contents, or secrets — and generates four developer scores.

No Node.js, Python, or npm required on the host machine. Ships as a single standalone binary.

---

## What it collects

| Collected | Never collected |
|-----------|----------------|
| Bash command names (sanitized) | Conversation text or prompts |
| File extensions (.ts, .py, …) | File contents |
| MCP tool names (Read, Edit, Bash…) | Secrets, tokens, API keys |
| Timestamps and session durations | Absolute paths (SHA-256 hash only) |
| Prompt character counts | Business data or PII |

All data stays in `~/.devprofile/` — it never leaves your machine.

---

## Installation

### Via install script (recommended)

```sh
curl -fsSL https://devprofile.app/install | sh
```

The script downloads the binary for your platform, verifies the SHA-256 checksum, installs it to `~/.local/bin/devprofile`, and runs `devprofile init` automatically.

### From source (development)

```sh
git clone https://github.com/ioit-solutions/devprofile
cd devprofile
bun install
sh scripts/build.sh          # builds dist/devprofile
dist/devprofile init
```

---

## Quick start

After installation, `devprofile init` runs the onboarding wizard:

1. **Screen 1** — What is collected (read-only)
2. **Screen 2** — Choose which score dimensions to enable
3. **Screen 3** — Detected environments (Claude Code / Continue.dev)
4. **Screen 4** — Installs hooks, starts daemon, sets up autostart

Once initialised, type `/devprofile` in any Claude Code chat to see your profile.

---

## Scores

| Dimension | What it measures |
|-----------|-----------------|
| **Prompt Quality** | Context richness, tool variety, iteration depth |
| **Test Maturity** | TDD adoption, test coverage signals, test commands |
| **Tech Breadth** | Ecosystems, platforms, and languages touched |
| **Growth Rate** | 30-day delta across all dimensions |

Scores range from 0–100. The engine computes them incrementally from JSONL session files and persists them in `~/.devprofile/profile.db`.

---

## Commands

```sh
devprofile init               # Run onboarding wizard (installs hooks + starts daemon)
devprofile start              # Start MCP server + scoring engine
devprofile stop               # Stop both daemons gracefully
devprofile restart            # Stop then start
devprofile status             # Show daemon health, session, and today's stats
devprofile view               # Display your profile in the terminal
devprofile view --json        # Output full profile as JSON
devprofile view --scores-only # Output 4 scores as space-separated numbers
devprofile update             # Download and install the latest version
devprofile delete --local     # Delete ~/.devprofile/ (keeps hooks)
devprofile delete --all       # Delete data + remove all hooks (full uninstall)
```

### devprofile view

```
DevProfile — seu perfil de desenvolvedor

Scores
  Prompt quality  84  ████████░░
  Test maturity   62  ██████░░░░
  Tech breadth    91  █████████░
  Growth rate     75  ███████░░░

  Overall         78/100  (847 sessões)

Perfil técnico
  Plataformas:   docker · github · postgresql
  Ecossistemas:  rails · react · python
  Workflow:      test-after (39%) · tdd (23%)
  Total sessões: 847
```

### /devprofile in Claude Code

After `devprofile init`, the `/devprofile` slash command is available directly in Claude Code chat:

| Command | Output |
|---------|--------|
| `/devprofile` | Score + top 3 insights |
| `/devprofile scores` | Score table with progress bars |
| `/devprofile insight` | Next recommended action |
| `/devprofile full` | Complete profile (scores + platforms + ecosystems) |

---

## Runtime files

| Resource | Location |
|----------|----------|
| MCP server | `localhost:7337` |
| Scoring engine | `localhost:7338` |
| Session events | `~/.devprofile/sessions/YYYY-MM-DD_<id>.jsonl` |
| SQLite database | `~/.devprofile/profile.db` |
| Daemon PID | `~/.devprofile/daemon.pid` |
| Daemon log | `~/.devprofile/daemon.log` |
| Config | `~/.devprofile/config.json` |

---

## Uninstalling

```sh
devprofile delete --all
```

Removes `~/.devprofile/`, removes hooks from `~/.claude/settings.json`, and removes the MCP entry from `~/.continue/config.json`. After confirmation (type `apagar tudo`), the uninstall is complete.

To also remove the binary:

```sh
rm ~/.local/bin/devprofile
```

---

## OS notifications

The daemon sends one OS notification per day (macOS `osascript` / Linux `notify-send`) after a session ends:

```
DevProfile: score 78 (+4 hoje)
```

Notifications are controlled via `~/.devprofile/config.json`:

```json
{
  "notifications": {
    "enabled": true,
    "daily_score": true,
    "updates": true
  }
}
```

---

## Architecture

```
Claude Code hooks (PreToolUse / PostToolUse / Stop)
Continue.dev MCP events
        ↓
[Sanitizer — strips secrets, env values, raw paths before any write]
        ↓
~/.devprofile/sessions/YYYY-MM-DD_<session-id>.jsonl  (50 MB max, daily rotation)
        ↓
Scoring Engine (Python FastAPI · localhost:7338)
  → incremental JSONL reader (cursor at ~/.devprofile/.cursor)
  → extractors: commands, file extensions, tools, timing
  → classifiers: project type, platform, workflow pattern
  → scorers: prompt_quality, test_maturity, tech_breadth, growth_rate
  → persists to ~/.devprofile/profile.db (SQLite)
        ↓
CLI (devprofile view) and Continue.dev sidebar (via MCP server · localhost:7337)
```

The MCP server captures events from Claude Code hooks and Continue.dev, sanitises them, and writes JSONL. The scoring engine processes JSONL incrementally every 60 seconds. The CLI reads from both over HTTP.

---

## Development

**Requirements:** [Bun](https://bun.sh) ≥ 1.1, Python ≥ 3.11

```sh
# Install all workspace dependencies
bun install

# Run TypeScript tests (mcp-server + cli)
bun test

# Run Python tests (scoring engine)
pip install -e "packages/engine[dev]"
pytest packages/engine/tests

# Build local binary
sh scripts/build.sh          # → dist/devprofile

# Run MCP server in dev mode
bun run dev --filter @devprofile/mcp-server

# Run scoring engine in dev mode
uvicorn main:app --host 127.0.0.1 --port 7338 --app-dir packages/engine/src --reload
```

### Monorepo layout

```
devprofile/
├── packages/
│   ├── mcp-server/    # TypeScript (Bun) · localhost:7337
│   │   └── src/
│   │       ├── server.ts          # HTTP server + MCP protocol
│   │       ├── hooks/             # Claude Code + Continue.dev event handlers
│   │       ├── sanitizer.ts       # Redacts secrets before any write
│   │       ├── tools/             # devprofile + devprofile_status MCP tools
│   │       └── notifications.ts   # OS notification service
│   ├── engine/        # Python (FastAPI) · localhost:7338
│   │   └── src/
│   │       ├── api.py             # FastAPI app + APScheduler
│   │       ├── reader/            # Incremental JSONL reader
│   │       ├── extractors/        # commands, files, timing, tools
│   │       ├── classifiers/       # project type, platform, workflow
│   │       ├── scorers/           # 4 scorer classes
│   │       ├── processor.py       # classify → score pipeline
│   │       └── storage/sqlite.py  # SQLite persistence
│   └── cli/           # TypeScript (Bun) · standalone binary
│       └── src/
│           ├── index.ts           # commander entry point
│           ├── commands/          # init, start, stop, status, view, update, delete
│           ├── ui/                # ANSI profile renderer + 4-screen wizard
│           ├── client/            # HTTP clients for :7337 and :7338
│           ├── config/hooks.ts    # Claude Code + Continue.dev hook installer
│           └── daemon-manager.ts  # daemon lifecycle + autostart
├── scripts/
│   ├── build.sh       # local dev build
│   └── install.sh     # public install script
└── .github/workflows/
    ├── ci.yml         # tests on every PR
    └── release.yml    # build + publish on tag push
```

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DEVPROFILE_DATA_DIR` | `$HOME` | Override `~/.devprofile/` parent directory |
| `DEVPROFILE_PORT` | `7337` | MCP server port |
| `DEVPROFILE_ENGINE_URL` | `http://127.0.0.1:7338` | Engine base URL (for testing) |
| `DEVPROFILE_MCP_URL` | `http://127.0.0.1:7337` | MCP base URL (for testing) |

---

## Distribution

| Platform | Binary | Approx. size |
|----------|--------|-------------|
| macOS Apple Silicon | `devprofile-darwin-arm64` | ~45 MB |
| macOS Intel | `devprofile-darwin-x64` | ~45 MB |
| Linux x64 | `devprofile-linux-x64` | ~48 MB |

Each release includes a `.sha256` checksum and GPG signature. The install script verifies the checksum before executing.

---

## License

MIT

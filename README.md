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

### Slash command no Claude Code

After `devprofile init`, the `/devprofile` slash command is available directly in Claude Code chat:

```
/devprofile              → resumo: score geral + top insights
/devprofile scores       → os 4 scores com barras de progresso
/devprofile insights     → próxima ação recomendada (1 insight de "opportunity")
/devprofile full         → perfil completo com plataformas, ecosystems e workflow
```

### CLI no terminal

```bash
# onboarding e daemons
devprofile init [--force]                      # wizard de 4 telas (--force re-roda)
devprofile start                               # sobe MCP server (7337) + engine (7338)
devprofile stop                                # para ambos os daemons
devprofile restart                             # stop + start
devprofile status                              # estado dos daemons + sessão atual

# perfil
devprofile view                                # perfil completo no terminal
devprofile view --json                         # output JSON para scripts
devprofile view --scores-only                  # apenas os 4 scores numéricos
devprofile view --refresh                      # processa eventos órfãos antes de exibir
devprofile view --coach                        # contexto de coaching (padrões + sugestões)
devprofile view --coach --session-hint <phase> # phase ∈ feature_work | debug | refactor | exploration

# chaves Ed25519 (Fase 5 — assinatura de snapshots)
devprofile keys show                           # public key + fingerprint
devprofile keys import <arquivo>               # importa JWK ou PEM (PKCS#8)
devprofile keys rotate                         # gera novo par, arquiva o anterior

# snapshots assinados (.dpbundle — Fase 5)
devprofile snapshot                            # gera bundle local
devprofile snapshot --output <path>            # também grava em <path>
devprofile snapshot --share                    # gera + upload + QR + URL curta
devprofile snapshot list                       # histórico (newest-first)
devprofile verify <arquivo.dpbundle>           # schema + hash + signature offline
devprofile verify <arquivo.dpbundle> --chain   # também walks previous_hash

# manutenção
devprofile update                              # verifica e instala nova versão
devprofile delete --local                      # apaga ~/.devprofile/
devprofile delete --all                        # local + remove hooks
```

### Subcomando interno

> Usado pelo Claude Code e pelo autostart — não é para uso direto.

```bash
devprofile server          # HTTP server na porta 7337 (modo standalone)
devprofile server --stdio  # protocolo MCP via stdin/stdout (spawned pelo Claude Code)
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

### devprofile view --coach

Coaching context derived from real usage. Patterns are detected deterministically (no LLM call), and a `✓` marks each pattern relevant to the current session's ecosystem.

```
DevProfile · coach (v1 · live)

Padrões (2):

✓ [high  ] Testes escritos após o código  conf 0.84
   80% das sessões classificadas como test-after, mediana 12 min.

  [low   ] Loop de debug com pouca leitura prévia  conf 0.60
   Bash representa 6.0x o uso de Read.

Contexto: feature_work · rails · react
Score: 35/100 · 30 sessões
```

```sh
devprofile view --coach                          # render ANSI (above)
devprofile view --coach --session-hint debug     # tag the phase
devprofile view --coach --json                   # raw CoachPayload (for jq / debug)
```

### MCP tools exposed to the host LLM

The `mcp-server` registers three tools your IDE's LLM can call. The agent layer is **the LLM you're already using** — DevProfile only provides context, never calls an external API itself.

| Tool | Purpose |
|------|---------|
| `devprofile` | On-demand score + insights (the data behind `/devprofile`) |
| `devprofile_coach` | Coaching context: patterns + guidance for the host LLM to act on |
| `devprofile_status` | Compact score for sidebars (Continue.dev) |

#### How `devprofile_coach` works

1. Engine computes `WorkflowMetrics` every scoring cycle — 10 deterministic scalars over the last 30 days (ratios, medians, concentration index).
2. `detect_patterns()` derives behavioural patterns from those metrics (e.g. `test_after_dominant`, `debug_driven_bash_heavy`). No LLM; pattern matching only.
3. The tool returns a text block followed by a delimited JSON contract:

   ```
   DevProfile · coaching context (v1)
   Padrões detectados (N): ...

   ---DEVPROFILE-JSON---
   { "version": 1, "patterns": [...], "coaching_guidance": {...}, ... }
   ---END-JSON---
   ```

4. The host LLM reads the JSON, follows `coaching_guidance.must`/`must_not`, and surfaces **at most one pattern** matching `applies_to_current_session AND confidence >= 0.6`.

The tool description tells the host **when not to call it** (during debug sessions, after recent invocation, for pure execution tasks). Privacy posture is preserved: no data leaves the machine, the LLM is whatever you're already paying for in your IDE.

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
  → coach pipeline: compute_workflow_metrics + detect_patterns (deterministic, no LLM)
  → persists to ~/.devprofile/profile.db (SQLite, versioned schema)
        ↓
CLI (devprofile view) and Continue.dev sidebar (via MCP server · localhost:7337)
        ↓
Host LLM (Claude Code, Cursor, …) calls devprofile_coach → applies coaching guidance
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
│   │       ├── coach.py           # compute_workflow_metrics + detect_patterns
│   │       ├── processor.py       # classify → score → metrics pipeline
│   │       └── storage/sqlite.py  # SQLite persistence (versioned migrations)
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
| `DEVPROFILE_PORTAL_URL` | `https://devprofile.app` | Portal base URL for `snapshot --share` |

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

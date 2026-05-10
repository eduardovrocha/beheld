# DevProfile

Privacy-first developer profiling built on real Claude Code and Continue.dev usage. Captures technical metadata silently — never conversation content, file contents, or secrets — and generates four developer scores.

## What it collects

| Collected | Never collected |
|-----------|----------------|
| Bash commands executed | Conversation text |
| File names and extensions | File contents |
| MCP tools used | Secrets and env var values |
| Timestamps and durations | Business data |

## Installation

```sh
curl -fsSL https://devprofile.app/install | sh
```

After installation, type `/devprofile` in Claude Code to see your profile.

## Scores

| Dimension | What it measures |
|-----------|-----------------|
| Prompt Quality | Context richness, tool variety, iteration depth |
| Test Maturity | TDD adoption, test coverage signals, test commands |
| Tech Breadth | Ecosystems, platforms, languages touched |
| Growth Rate | 30-day delta across all dimensions |

## Local ports

| Service | Port |
|---------|------|
| MCP server | 7337 |
| Scoring engine | 7338 |

## Commands

```
devprofile init    # Configure hooks and start daemon
devprofile view    # Display your profile
devprofile status  # Show daemon and session status
devprofile start   # Start daemon
devprofile stop    # Stop daemon
devprofile update  # Update to latest version
devprofile delete  # Remove data
```

## Development

Requirements: [Bun](https://bun.sh) ≥ 1.1, Python ≥ 3.11

```sh
bun install          # install all workspace dependencies
bun test             # run all tests (TypeScript)
pytest packages/engine/tests  # run Python tests

sh scripts/build.sh  # build local binary → dist/devprofile
```

## Architecture

```
Claude Code hooks (PreToolUse / PostToolUse / Stop)
Continue.dev MCP events
        ↓
[Sanitizer — strips secrets before any write]
        ↓
~/.devprofile/sessions/YYYY-MM-DD_<uuid>.jsonl
        ↓
Scoring Engine (Python FastAPI :7338)
  → reads JSONL incrementally
  → calculates 4 scores
  → persists to ~/.devprofile/profile.db (SQLite)
        ↓
CLI / /devprofile slash command
```

## License

MIT

# Subdivisões — daemon

Tabela mestra dos 3 packages. Detalhes em `subdivisions/<nome>.md`.

| # | Nome | Caminho | Pacote/versão | Propósito | Estado |
|---|---|---|---|---|---|
| 1 | [cli](subdivisions/cli.md) | `packages/cli` | `@beheld/cli` 0.4.1 | Binário `beheld`: onboarding, snapshot assinado, publicação, chaves/identidade | Implementado |
| 2 | [engine](subdivisions/engine.md) | `packages/engine` | `beheld-engine` 0.4.1 | Scoring local: lê JSONL + git, 4 dimensões, monta bundle, serve HTTP 127.0.0.1:7338 | Implementado |
| 3 | [mcp-server](subdivisions/mcp-server.md) | `packages/mcp-server` | `@beheld/mcp-server` 0.4.0 | Hooks de 7 harnesses + daemon HTTP; sanitiza e grava eventos pro engine | Implementado |

## Dependências

```
cli ──spawns──▶ engine (binário embutido em packages/cli/assets/, HTTP 127.0.0.1:7338)
cli ──spawns──▶ mcp-server (subcomando `beheld server`)
mcp-server ──HTTP──▶ engine (grava eventos JSONL; dispara /process)
cli ──HTTPS POST /api/v1/bundles──▶ backend Rails (repo `web`)
```

Os harnesses (Claude Code, Cursor, Continue, Codex, Copilot CLI/VSCode, Gemini, Windsurf) chamam
hooks HTTP do `mcp-server`. O binário `beheld-engine` é embutido no package `cli` (gerado pelo build).

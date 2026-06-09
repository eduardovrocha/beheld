# Base de Conhecimento — daemon (produto local Beheld)

Repositório `beheld` (`git@github.com:eduardovrocha/beheld.git`). Produto local: CLI + engine de
scoring + MCP server. Companion do repo irmão **`web`** (portal `beheld.dev`). Gerada por análise
estrutural do código em **2026-06-09**.

> Complementa o `CLAUDE.md` na raiz deste repo (guia de trabalho). Esta base é a análise estrutural.

## Navegação

- **[OVERVIEW.md](OVERVIEW.md)** — o que o produto local é, stack, topologia, estado geral.
- **[SUBDIVISIONS.md](SUBDIVISIONS.md)** — tabela mestra dos 3 packages + dependências.
- **[DOMAIN.md](DOMAIN.md)** — modelo de eventos, scoring, e wire format do bundle; fluxos.
- **[CONFIG.md](CONFIG.md)** — variáveis de ambiente (engine/cli/mcp).
- **[STATE.md](STATE.md)** — tabela honesta: implementado / parcial / placeholder.
- **[OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)** — o que exige decisão humana.
- **[CHANGELOG.md](CHANGELOG.md)** — histórico desta base.

## Subdivisões (packages)

| # | Subdivisão | Arquivo |
|---|---|---|
| 1 | cli | [subdivisions/cli.md](subdivisions/cli.md) |
| 2 | engine | [subdivisions/engine.md](subdivisions/engine.md) |
| 3 | mcp-server | [subdivisions/mcp-server.md](subdivisions/mcp-server.md) |

## Mapa

```
daemon/  (repo beheld)
├── packages/
│   ├── cli/         (1)  @beheld/cli — binário `beheld` (Bun/TS)
│   ├── engine/      (2)  beheld-engine — scoring (Python/FastAPI, SQLite)
│   └── mcp-server/  (3)  @beheld/mcp-server — hooks + daemon HTTP (Bun/TS)
└── scripts/              build.sh / install.sh / reinstall.sh
```

> O portal (perfis públicos, dashboards, publicação de bundles) vive no repo **`web`** —
> ver `../../web/.knowledge/`.

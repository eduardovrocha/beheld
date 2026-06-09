# daemon — Visão Geral

> Repo `beheld`. Estado real derivado do código em 2026-06-09.

## O que é

O lado **local** do Beheld: um agente que o dev instala. Observa o uso de harnesses de IA
(Claude Code, Cursor, Continue, etc.) + histórico git, calcula um score multidimensional, e
empacota tudo num bundle assinado com Ed25519 (`.beheld`/`.dpbundle`). Tudo roda na máquina do dev;
**nada sai sem publicação explícita** (`scripts/install.sh`, `packages/cli/src/ui/wizard.ts:68`).

A publicação e os retratos públicos ficam no repo irmão **`web`**.

## Topologia

Multi-package sem manifest único na raiz montado por `scripts/build.sh` (o `.gitignore` do repo
versiona `package.json`/`bun.lock` na raiz como workspace Bun; ver `CLAUDE.md`). Buildа para um
**único binário** `beheld` (PyInstaller + `bun build --compile`).

```
daemon/
└── packages/
    ├── cli/         @beheld/cli — binário `beheld` (Bun/TS, commander)
    ├── engine/      beheld-engine — scoring (Python/FastAPI, SQLite local)
    └── mcp-server/  @beheld/mcp-server — hooks de harness + daemon HTTP (Bun/TS)
```

## Stack

| Package | Tecnologia |
|---|---|
| cli | TypeScript, Bun, commander, @sigstore/sign, qrcode-terminal |
| engine | Python ≥3.11, FastAPI, uvicorn, anthropic SDK, apscheduler, jsonschema; SQLite |
| mcp-server | TypeScript, Bun, @modelcontextprotocol/sdk; daemon HTTP em 127.0.0.1 |

## Estado geral

- **cli** — implementado. ~25 comandos, 34 arquivos de teste.
- **engine** — implementado. 4 dimensões de score, L1 (git) + enrichment, ~22 endpoints FastAPI, 17 testes.
- **mcp-server** — implementado. Hooks para 7 harnesses, daemon HTTP, 18 testes.

## Integração com o repo `web`

O CLI publica o bundle assinado via `POST /api/v1/bundles` no backend Rails (repo `web`). **O wire
format do bundle é travado em 3 runtimes** (engine Python e CLI Bun aqui; browser SPA no `web`).
Mudá-lo exige bump de versão nos três.

⚠️ **Refundação em andamento**: o working tree está parcialmente desmontado **de propósito** (vários
arquivos da estrutura antiga foram removidos do disco). Esta análise descreve a estrutura **anterior**
à refundação e ficará desatualizada conforme a nova for construída — ver `OPEN_QUESTIONS.md` #3.

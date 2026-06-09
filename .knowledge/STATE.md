# Estado de Implementação — daemon

Estados: **implementado** | **parcial** | **esqueleto** | **placeholder**.

## Por subdivisão

| Subdivisão | Estado | Evidência |
|---|---|---|
| cli | implementado | ~25 comandos (`packages/cli/src/index.ts`), 34 arquivos de teste |
| engine | implementado | 4 scorers + L1 + identity, ~22 endpoints FastAPI, 17 testes |
| mcp-server | implementado | 7 hooks de harness, 3 tools MCP, daemon HTTP, 18 testes |

## Funcionalidades — granular

| Funcionalidade | Estado | Nota / evidência |
|---|---|---|
| Captura de telemetria multi-harness | implementado | hooks p/ 7 harnesses + testes |
| Scoring 4 dimensões + renormalização | implementado | `scorers/overall.py` |
| `work_mode` (solo/collaborative) | **placeholder** | sempre "solo" (`extractors/timing.py:29`) |
| Snapshot assinado Ed25519 + chain | implementado | `packages/cli/src/keys`, `bundle.py` |
| Verificação cripto no HTML de snapshot do CLI | **placeholder** | `// TODO: real Ed25519...` (`snapshot-html.ts:1138`) |
| Importação L1 (git history) | implementado | `l1/*`, `POST /l1/import` |
| Publicação de bundle (→ repo `web`) | implementado | `packages/cli/src/bundle/share.ts` |
| Identidade técnica via LLM + fallback | implementado | `identity/*` (orchestrator, fallback) |

## Dívida estrutural

- **Divergência de versão (5 valores)**: root `package.json` **0.3.2** / cli **0.4.1** / mcp-server
  **0.4.0** / engine pyproject **0.4.1** vs `api.py` VERSION **"0.1.1"**; wire do bundle **"7"**.
  Sem fonte única de verdade — `api.py` VERSION "0.1.1" parece o mais defasado.
- **Refundação R1 em andamento** (intencional, working tree vivo — muda entre sessões):
  - **Mantido/reescrito no disco**: `README.md` (manifesto R1), `package.json` (workspace Bun,
    v0.3.2), `packages/{cli,engine,mcp-server}`, `scripts/`, `.gitignore`, `CLAUDE.md`.
  - **Removido do disco de propósito** (25 deleções ainda não-commitadas vs HEAD): `docs/` (19 specs
    internos), `produto/`, `.github/workflows/{ci,release}.yml`, `CHANGELOG.md`,
    `beheld-refundacao-status.md`. Ver `OPEN_QUESTIONS.md` #3/#4.
  - **Cruft novo**: `app/views/{contacts,directory,profiles,contact_mailer}` — pastas **vazias,
    não-versionadas** (nomes batem com views do *web backend* → provável resíduo). `data/` tem
    artefatos de runtime do engine.
  - **Consequência**: as subdivisões abaixo (cli/engine/mcp-server) seguem válidas estruturalmente,
    mas o `CLAUDE.md` versionado ainda tem linguagem de fases antiga; o `README.md` é a fonte R1 atual.

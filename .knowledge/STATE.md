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

- **Divergência de versão**: cli 0.4.1 / mcp-server 0.4.0 / engine pyproject 0.4.1 vs `api.py`
  VERSION "0.1.1". Sem fonte única de verdade.
- **Refundação em andamento** (intencional): vários arquivos rastreados (`README.md`, `package.json`,
  `bun.lock`, `docs/`, `produto/`, `.github/`, `.gitignore`) foram **deletados do disco** de propósito
  vs HEAD; `app/` e `data/` são diretórios novos da estrutura sendo construída. As deleções ainda não
  foram commitadas (serão pelo dono da refundação). Ver `OPEN_QUESTIONS.md` #3. **Consequência**: a
  análise abaixo e o `CLAUDE.md` versionado refletem a estrutura **anterior** à refundação.

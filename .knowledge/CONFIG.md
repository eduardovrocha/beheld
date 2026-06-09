# Configuração e Ambiente — daemon

Variáveis derivadas do código.

## Engine (Python) — `config.py`, `reader/`, `storage/`, `insights.py`

| Variável | Onde | Notas |
|---|---|---|
| `BEHELD_ENV` | `config.py:59` | `development`/`dev`/`local` → development; resto → **production** (default seguro) |
| `BEHELD_API_URL` | `config.py:67` | override da base do backend (repo `web`) |
| `BEHELD_PORTAL_URL` | `config.py:75` | override do portal |
| `BEHELD_REKOR_URL` | `config.py:83` | Sigstore transparency log |
| `BEHELD_OLLAMA_URL` | `config.py:91` | default local |
| `BEHELD_DATA_DIR` | `reader/jsonl_reader.py:16`, `storage/sqlite.py:15` | raiz dos dados (`~/.beheld`) |
| `ANTHROPIC_API_KEY` | `insights.py:42`, `classifiers/project_type.py:151` | **segredo**; habilita enriquecimento por LLM |
| `SSH_AUTH_SOCK` | `l1/auth_resolver.py` | acesso git autenticado |

Engine escuta em `127.0.0.1:7338` por default (`main.py`).

## CLI / MCP server (TS) — `process.env.*`

`BEHELD_API_URL`, `BEHELD_ENGINE_URL`, `BEHELD_MCP_URL`, `BEHELD_PORTAL_URL`, `BEHELD_REKOR_URL`,
`BEHELD_ENV`, `BEHELD_PORT`, `BEHELD_HOME`, `BEHELD_DATA_DIR`, `BEHELD_DESKTOP_DIR`,
`BEHELD_CACHE_DB`, `BEHELD_NO_DESKTOP_COPY`, `BEHELD_NO_TELEMETRY`, `BEHELD_FORCE_NUDGE`, `NO_COLOR`.
Daemon HTTP escuta em `127.0.0.1` (`mcp-server/src/daemon.ts`).

## Ambientes

`BEHELD_ENV` distingue dev/prod no engine e no CLI/MCP, com fallback silencioso para `production`
(`config.py:54-62`) — um typo nunca tira o engine do ar.

## Dados locais (não versionar)

`~/.beheld/` (ou `BEHELD_DATA_DIR`): JSONL de eventos, SQLite (`state_store.db`), snapshots, chaves
Ed25519. O `.gitignore` do repo ignora `.claude/`, `node_modules/`, `dist/`, binários Python e
`*.js`/`*.d.ts` gerados — **exceto** `packages/cli/assets/beheld-engine` (whitelisted).

Nenhum segredo de servidor mora aqui (a platform key de assinatura fica no repo `web`/no host de
prod). O único segredo de runtime é `ANTHROPIC_API_KEY` (opcional, do ambiente do dev).

# Subdivisão: engine

- **Caminho**: `packages/engine`
- **Pacote**: `beheld-engine` v0.4.1 (`pyproject.toml`) — porém `src/api.py:33` declara
  `VERSION = "0.1.1"` (divergência; ver `OPEN_QUESTIONS.md`).
- **Propósito**: engine de scoring local. Lê eventos JSONL dos harnesses + histórico git (L1),
  calcula 4 dimensões de score, monta o payload do bundle, e expõe via FastAPI em `127.0.0.1:7338`.

## Stack interna

- Python ≥3.11, FastAPI + uvicorn (`main.py`, `api.py`). `anthropic` SDK (identidade/insights via
  LLM, opcional). `apscheduler`, `jsonschema`. Persistência local **SQLite** em `~/.beheld/`
  (`storage/sqlite.py`). Build: PyInstaller `--onefile` reprodutível (`build.sh`).

## Módulos

`scorers/` (overall, prompt_quality, test_maturity, tech_breadth, growth_rate, base),
`classifiers/` (platform, project_type, workflow), `extractors/` (commands, files, timing, tools),
`l1/` (git_extractor, architecture_detector, auth_resolver, language_map, importer),
`identity/` (orchestrator, llm, fallback, selector, validators, schema, labels),
`reader/jsonl_reader.py`, `bundle.py`, `coach.py`, `insights.py`, `processor.py`, `models.py`.

## Modelo de score (`scorers/overall.py:11-16`)

| Dimensão | Peso | Fontes |
|---|---|---|
| prompt_quality | 0.30 | enrichment |
| test_maturity | 0.30 | core + enrichment |
| tech_breadth | 0.25 | core + enrichment |
| growth_rate | 0.15 | core + enrichment |

Pesos somam 1.0 (assert em runtime). Dimensões ausentes são **dropadas e renormalizadas**, não
tratadas como 0. `prompt_quality` retorna `None` quando enrichment ausente.

## API HTTP (`api.py`)

`GET /health|status|profile/readiness|profile/summary`, `POST /process`,
`GET /scores/current|history`, `GET /insights`, `GET /metrics/workflow`, `GET /coach`,
`GET /snapshot/latest`, `GET /snapshot/chain/status`, `POST /snapshot/{payload,html-data,save}`,
`GET /snapshots`, `GET /l1/{summary,repositories,stack}`, `POST /l1/import`, `GET /l1/import/status`,
`DELETE /l1/repositories/{root_hash}`, `GET /export`.

## Dependências

- **Quem depende**: `cli` (embute o binário; fala HTTP) e `mcp-server` (grava eventos; dispara `/process`).
- **Externas**: API Anthropic (opcional, `ANTHROPIC_API_KEY`); Ollama local (`BEHELD_OLLAMA_URL`);
  git local via SSH agent (`l1/auth_resolver.py`); SQLite em disco.

## Estado de implementação: **Implementado**

Evidência: 17 arquivos de teste (`tests/test_*.py`). ~22 endpoints FastAPI.

### Débito visível

- `extractors/timing.py:29` — `work_mode` é **placeholder, sempre "solo"**.
- Divergência de versão pyproject (0.4.1) vs `api.py` VERSION (0.1.1).

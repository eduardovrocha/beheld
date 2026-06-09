# Modelo de Domínio e Fluxos — daemon

## Entidades (engine — `packages/engine/src/models.py`)

- **BeheldEvent** (`models.py:13`) — evento bruto do JSONL: `event_id`, `session_id`, `source`
  (default "claude-code"), `event_type`, `timestamp`, `duration_ms`, `tool_name`, `file_extension`,
  `command_sanitized`, `prompt_length`, `has_test_context`, `cwd_hash`, `metadata`.
- **Session** (`models.py:48`) — sessão agregada: `tools_used`, `file_extensions` (Counter),
  `commands`, `total_turns`, `project_category`, `workflow_pattern`, `avg_prompt_length`, etc.
- **Scores / CoachPayload / SessionContext / WorkflowMetrics** — saída do scoring (em `api.py`).
- Dimensões: `prompt_quality` (0.30), `test_maturity` (0.30), `tech_breadth` (0.25),
  `growth_rate` (0.15) — `scorers/overall.py`.

## Wire format do bundle — `BUNDLE_VERSION = "7"`

Fonte de verdade no código: `packages/engine/src/models.py:234` e `packages/cli/src/bundle/types.ts:18`
(twins; mudar exige bump nos dois + no browser do repo `web`). `verify.ts:74` aceita v7 com chave `core`.

Estrutura (wire **v7**, modelo R1 — ver `README.md`):
```
{ "version": "7",
  "payload": {
    "core":       { "ecosystems": {...}, "avg_test_ratio": 0.42, ... },   ← L1, git history
    "enrichment": { "harness_sources": [ {harness, capture_fidelity, sessions}, ... ],
                    "workflow_distribution": {...}, ... },                 ← L2, harnesses
    "scores":     { "prompt_quality": 84, "growth_rate": null, ... } },    ← null p/ dimensão ausente
  "hash": "sha256:…", "signature": "ed25519:…", "public_key": "ed25519:…" }
```
- **`capture_fidelity`** por fonte de enrichment: `native_hook` (Claude Code, Gemini CLI),
  `editor_extension` (Continue), `local_log_tail` (Cursor), `statusline` (Copilot CLI), `inferred`.
  Um entry por harness — o recrutador vê qual sinal veio de qual ferramenta e em que fidelidade.
- Compat: wire v5 usava `l1`/`l2`; ≤v4 usava `signals` flat. `beheld verify` lê todos offline.
- **Travado em 3 runtimes** (engine Python + CLI Bun aqui; browser no repo `web`). CLI calcula
  SHA-256 do payload canônico e assina com Ed25519.

## Fluxos principais (lado local)

### 1. Captura de telemetria
Harness usa uma ferramenta → hook HTTP `POST /hook/{pre,post}-tool` no `mcp-server` →
`sanitizer.ts` limpa → `writers/jsonl.ts` grava evento em `~/.beheld/` → `engine-trigger.ts`
dispara `POST /process` no engine → `processor.py` agrega Sessions → scorers calculam dimensões →
persiste em SQLite (`storage/sqlite.py`). **Side effects**: escrita JSONL, escrita SQLite.

### 2. Geração de snapshot assinado
`beheld snapshot` → `GET /snapshot/payload` no engine monta payload canônico → CLI calcula SHA-256
e assina com Ed25519 (`packages/cli/src/keys/`) → grava `.beheld`/`.dpbundle` + HTML.
**Side effects**: arquivos locais; encadeamento por `previous_hash` (chain).

### 3. Importação L1 (git)
`beheld import [url]` → `POST /l1/import` no engine → `l1/git_extractor` + `architecture_detector`
+ `auth_resolver` (SSH agent) extraem histórico/stack → persiste em SQLite.
**Side effects**: leitura de repos git locais; escrita SQLite.

### 4. Publicação (cruza pro repo `web`)
`beheld share` (`packages/cli/src/bundle/share.ts`) → `POST /api/v1/bundles` no backend Rails →
retorna `url_slug` → CLI renderiza QR. **Side effects**: rede (HTTPS ao portal).

## Side effects — resumo (local)

- **Writes SQLite** (engine): sessões, scores, snapshots, L1.
- **Writes JSONL** (mcp-server): eventos sanitizados em `~/.beheld/`.
- **Externos**: API Anthropic/Ollama (engine, opcional); Sigstore Rekor (CLI); git local.
- **Crypto**: assinatura Ed25519 (CLI). **Privacidade**: nada sai sem publicação explícita.

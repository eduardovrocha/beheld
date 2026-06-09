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

## Wire format do bundle

A struct do bundle assinado (version, hash, signature, public_key, payload{scores, l1, ...}) é
**travada em 3 runtimes**: o engine Python e o CLI Bun (aqui) e o browser SPA (repo `web`). Mudá-la
exige bump de versão nos três. O CLI calcula SHA-256 do payload canônico e assina com Ed25519.

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

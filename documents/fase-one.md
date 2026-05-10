# Fase 1 — MCP Server TypeScript

> Implementação concluída em 2026-05-10. Commit: `2922065`.

---

## Objetivo

Daemon HTTP em `localhost:7337` que captura eventos do Claude Code e do Continue.dev, sanitiza todo conteúdo sensível antes de tocar o disco, e persiste os sinais técnicos em `~/.devprofile/sessions/` como JSONL.

---

## O que foi criado

### Estrutura do pacote

```
packages/mcp-server/
├── src/
│   ├── server.ts              # entrada principal — Bun HTTP server
│   ├── types.ts               # interfaces compartilhadas (atualizado)
│   ├── sanitizer.ts           # redação de dados sensíveis
│   ├── daemon.ts              # lifecycle do processo + autostart
│   ├── hooks/
│   │   ├── claude-code.ts     # handlers PreToolUse / PostToolUse / Stop
│   │   └── continue.ts        # mapeamento de eventos do Continue.dev
│   ├── writers/
│   │   └── jsonl.ts           # classe JsonlWriter com rotação e gzip
│   └── tools/
│       ├── types.ts           # interface McpTool
│       ├── devprofile-tool.ts # tool "/devprofile" para Claude Code
│       └── status-tool.ts     # tool "devprofile_status" para Continue.dev
└── tests/
    ├── sanitizer.test.ts
    ├── hooks.test.ts
    ├── jsonl.test.ts
    ├── continue.test.ts
    └── server.test.ts
```

---

## Componentes

### `src/sanitizer.ts`

Função pura `sanitize(input: unknown): unknown` aplicada em **todos** os eventos antes de qualquer gravação.

| Padrão | Alvo |
|--------|------|
| `[A-Z_]{3,}=(?<q>["']?)...\k<q>` | Env vars com valor (`DATABASE_URL=...`) |
| `sk-[a-zA-Z0-9]{32,}` | API keys Anthropic |
| `ghp_[a-zA-Z0-9]{36}` | GitHub personal access tokens |
| `Bearer\s+...` | Bearer tokens (JWT, OAuth) |
| `password[...]=...` | Passwords em qualquer formato |
| `"content"\s*:\s*"[^"]{50,}"` | Campos `content` longos — nunca armazena texto de conversas |

Substituição: `<redacted>`.

**Comportamento por tipo:**
- `string` → padrões aplicados diretamente
- `number` / `boolean` / `null` → passados sem modificação
- `object` / `array` → serializado → padrões aplicados → re-parseado

A env var usa backreference nomeada (`\k<q>`) para que a aspa de fechamento case com a de abertura — evita consumir `"` estrutural do JSON.

O padrão `"content"` é o único que preserva a chave ao redigir (`"content":"<redacted>"`), mantendo o JSON válido.

Funções exportadas:
- `sanitize(unknown): unknown`
- `sanitizeObject(obj): Record<string, unknown>`
- `sanitizeCommand(cmd): string` — hasha paths absolutos + aplica padrões

---

### `src/writers/jsonl.ts`

Classe `JsonlWriter(baseDir: string)`.

**Naming:** `YYYY-MM-DD_<session-id>.jsonl` — todos os eventos de um `session_id` vão para o mesmo arquivo, identificado pela data de criação e pelo ID da sessão. Session IDs são sanitizados para uso em nomes de arquivo (apenas `[a-zA-Z0-9\-_]`, máx. 64 chars).

**Append-only:** usa `fs.appendFileSync` — nunca sobrescreve.

**Rotação automática:**
- Data: quando um evento chega com data diferente da do arquivo em cache, um novo arquivo é criado.
- Tamanho: ao atingir 50 MB, o arquivo é comprimido com `gzip` (`zlib.gzipSync`) e um novo é criado.

**Índice:** `~/.devprofile/sessions/index.json` — atualizado a cada evento com `{ session_id, date, path, events, size_bytes }`.

**Permissões:** `~/.devprofile/` criado com `chmod 700`.

Métodos:
- `async write(event: DevProfileEvent): Promise<void>`
- `async index(): Promise<SessionIndex>` — lê e sincroniza `size_bytes` do disco

---

### `src/hooks/claude-code.ts`

Processa payloads do Claude Code enviados via `curl -d @-` pelos hooks `PreToolUse`, `PostToolUse` e `Stop`.

| Função | Hook | Sinais extraídos |
|--------|------|-----------------|
| `handlePreToolUse(body)` | `PreToolUse` | `tool_name`, `file_extension`, `command_sanitized`, `has_test_context`, `cwd_hash` |
| `handlePostToolUse(body)` | `PostToolUse` | `tool_name`, `duration_ms` |
| `handleStop(body)` | `Stop` | `total_turns` (em `metadata`) |

**`cwd_hash`:** SHA256 hex do campo `cwd` — identifica o projeto sem revelar o path.

**`has_test_context`:** `true` se `tool_name === "Bash"` e o comando contém qualquer uma das palavras-chave: `rspec`, `jest`, `pytest`, `playwright`, `vitest`. Apenas para ferramentas Bash — `undefined` para todas as outras.

**`file_extension`:** extraída de `file_path`, `path`, `relative_path` ou `filename` nos campos do input — ao chamar ferramentas de leitura/escrita de arquivo.

**`command_sanitized`:** produzido apenas para Bash. Paths absolutos são hasheados (`[path:<hash8>]/filename`) e segredos são redidos.

O `sanitize()` é chamado no `body` inteiro antes de qualquer extração.

---

### `src/hooks/continue.ts`

```typescript
handleMcpRequest(body: unknown): DevProfileEvent | null
```

Retorna `null` para mensagens de protocolo MCP (`initialize`, `tools/list`, `tools/call`) e para eventos desconhecidos.

| Evento Continue.dev | `event_type` | Campos capturados |
|---------------------|-------------|-------------------|
| `chat_request` | `chat_request` | `prompt_length`, `has_code_context`, `file_extension` |
| `chat_response` | `chat_response` | `duration_ms`, `response_length`, `model` (em `metadata`) |
| `edit_apply` | `edit_apply` | `file_extension`, `lines_changed` |
| `command_run` | `command_run` | `command_sanitized`, `exit_code`, `duration_ms` |

**Nunca captura:** texto de conversas, conteúdo de arquivos, nomes de modelos em campos free-text.

---

### `src/server.ts`

Servidor HTTP com `Bun.serve()` em `127.0.0.1:7337` (configurável via `DEVPROFILE_PORT`).

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/health` | GET | `{ ok: true, version, uptime_seconds }` |
| `/status` | GET | `{ running, session_active, events_today, sessions_today, pid }` |
| `/session/current` | GET | Métricas da sessão mais recente em memória |
| `/hook/pre-tool` | POST | Hook `PreToolUse` do Claude Code |
| `/hook/post-tool` | POST | Hook `PostToolUse` do Claude Code |
| `/hook/stop` | POST | Hook `Stop` do Claude Code |
| `/mcp` | POST | Protocolo MCP para Continue.dev + captura de eventos |

**Tratamento de erros:** respostas com `{ error: string }` e status HTTP correto. Stack traces nunca são expostos — apenas logados internamente com `console.error`.

**Endpoint `/mcp`:** dois papéis simultâneos — extrai o `DevProfileEvent` via `handleMcpRequest` (se não for `null`, sanitiza e grava), e retorna a resposta de protocolo MCP correta ao Continue.dev (tools/list, tools/call, etc.).

**Estado em memória:** sessões ativas rastreadas em `Map<session_id, SessionMeta>` — contagem de eventos, ferramentas usadas, `has_test_context` acumulado. Reset a cada restart do daemon (não persiste; o JSONL é a fonte de verdade).

O servidor exporta `startServer()` para uso programático pelos testes e pelo CLI.

---

### `src/daemon.ts`

| Função | Comportamento |
|--------|---------------|
| `start()` | Verifica se já está rodando; se não, faz spawn do binário em `~/.local/bin/devprofile server` como processo detached com stdout/stderr redirecionados para `daemon.log` |
| `stop()` | Lê o PID de `daemon.pid`, envia SIGTERM, remove o arquivo |
| `isRunning()` | Lê o PID e verifica com `process.kill(pid, 0)` |
| `writePid(n)` / `readPid()` / `clearPid()` | Gerenciamento do arquivo `~/.devprofile/daemon.pid` |
| `rotateLogs()` | Move `daemon.log` para `daemon.log.1` ao atingir 10 MB |
| `setupAutostart(bin?)` | Instala autostart para o sistema operacional atual |
| `removeAutostart()` | Remove o arquivo de autostart instalado |

**Autostart — macOS:** `~/Library/LaunchAgents/com.devprofile.daemon.plist` com `RunAtLoad=true` e `KeepAlive=true`, apontando para `~/.local/bin/devprofile server`.

**Autostart — Linux:** `~/.config/systemd/user/devprofile.service` com `Restart=always`, apontando para `~/.local/bin/devprofile server`.

---

### `src/tools/devprofile-tool.ts`

Tool MCP `devprofile` exposta ao Claude Code (registrada pelo `devprofile init` na Fase 3).

- Busca `GET localhost:7338/scores/current` do engine Python (com timeout de 2 s).
- Parâmetro opcional `view`: `"summary"` (padrão) | `"scores"` | `"insights"` | `"full"`.
- Formata barra de progresso ANSI: `█████░░░░░` por score.
- Se engine não estiver rodando ou não tiver sessões: retorna mensagem explicativa.

### `src/tools/status-tool.ts`

Tool MCP `devprofile_status` para a sidebar do Continue.dev.

- Busca scores do engine e retorna `{ score, sessions_today, last_updated, top_insight }`.
- Retorna zeros se o engine não responder — nunca falha com erro HTTP.

---

## Testes

76 testes, 0 falhas (`bun test packages/mcp-server`).

| Arquivo | Testes | O que cobre |
|---------|--------|-------------|
| `sanitizer.test.ts` | 17 | Cada padrão de redação, primitivos preservados, objetos aninhados, `sanitizeCommand` |
| `hooks.test.ts` | 22 | Todos os handlers, SHA256 do cwd, detecção de test context, sanitização de input |
| `jsonl.test.ts` | 11 | Permissões do diretório, naming por session-id, append-only, dias diferentes, índice |
| `continue.test.ts` | 14 | Retorno `null` para protocolo, 4 tipos de evento, extração de campos |
| `server.test.ts` | 12 | Todos os endpoints, sanitização end-to-end, erros sem stack trace |

---

## Decisões de implementação

**SHA256 para `cwd_hash`.** A spec v1 usava um hash djb2 de 8 hex chars — colisões frequentes em bases de código grandes. SHA256 garante unicidade por projeto e é verificável externamente se o usuário quiser confirmar qual projeto corresponde a qual hash.

**Padrão `"content"` preserva a chave.** A substituição literal por `<redacted>` quebra o JSON serializado. A substituição por `"content":"<redacted>"` mantém o JSON válido e redige apenas o valor, que é o dado sensível.

**`has_test_context` undefined vs false para não-Bash.** Ferramentas de leitura de arquivo nunca saberão se há contexto de teste — `undefined` expressa "não se aplica" em vez de "não" (`false`), o que permite ao engine ignorar o campo em vez de penalizar o score.

**`handleMcpRequest` retorna `null` para protocolo MCP.** O servidor precisa de dois comportamentos distintos no endpoint `/mcp`: capturar um evento (se houver) E responder ao protocolo. Separar a extração de evento (`continue.ts`) da geração de resposta (`server.ts`) mantém cada função com responsabilidade única e facilita o teste de ambas independentemente.

**Classe `JsonlWriter` em vez de módulo stateful.** O estado anterior (variável de módulo `_currentFile`) tornava os testes dependentes da ordem de execução e do ambiente. A classe encapsula o estado e permite múltiplas instâncias isoladas — essencial para os testes de integração do servidor, que criam um diretório temporário.

---

## Resultados verificados

```
bun test packages/mcp-server  →  76 pass, 0 fail (111 ms)
localhost:7337/health         →  {"ok":true,"version":"0.1.0","uptime_seconds":0}
POST /hook/pre-tool (rspec)   →  has_test_context: true no JSONL
sk-test... em qualquer campo  →  redacted — ausente no JSONL
cwd_hash de "/Users/test/..."  →  SHA256 correto verificado via shasum
```

---

## Critérios de conclusão

- [x] `localhost:7337/health` responde `{ ok: true }` com daemon rodando
- [x] POST `/hook/pre-tool` com payload de exemplo → evento aparece no JSONL
- [x] Sanitizador remove `sk-test...` de qualquer campo
- [x] `has_test_context = true` detectado quando command contém `rspec`
- [x] `cwd_hash` é SHA256 hex do cwd, não o path em si
- [x] Arquivo JSONL em `~/.devprofile/sessions/` com nome `YYYY-MM-DD_<session-id>.jsonl`
- [x] `daemon.ts` expõe `start()`, `stop()`, `isRunning()` com autostart via LaunchAgent/systemd
- [x] Todos os testes passam: `bun test packages/mcp-server`
- [ ] Daemon reinicia após reboot — requer `devprofile init` (Fase 3) para instalar o autostart

---

## Próxima fase

**Fase 2 — Scoring Engine Python**

- Leitor incremental de JSONL com cursor em `~/.devprofile/.cursor`
- Extratores de padrões técnicos (comandos, extensões, sequência de tools)
- Classificador de tipo de projeto
- 4 scorers: `prompt_quality`, `test_maturity`, `tech_breadth`, `growth_rate`
- Persistência em `~/.devprofile/profile.db` (SQLite)
- FastAPI em `localhost:7338` com os endpoints que as tools da Fase 1 já consultam

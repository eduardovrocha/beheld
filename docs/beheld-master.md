# DevProfile — Documento Mestre

> Última atualização: 2026-05-24
> Unificação de: estratégia · listagem de fases · backlog

---

## Índice

1. [Síntese Estratégica](#1-síntese-estratégica)
2. [Visão geral das fases](#2-visão-geral-das-fases)
3. [Backlog por fase](#3-backlog-por-fase)
   - [Fase 0 — Build & Release Pipeline](#fase-0--build--release-pipeline)
   - [Fase 1 — MCP Server TypeScript](#fase-1--mcp-server-typescript)
   - [Fase 2 — Scoring Engine Python](#fase-2--scoring-engine-python)
   - [Fase 3 — CLI + Instalação](#fase-3--cli--instalação-via-claude)
   - [Fase 4 — Integração VS Code via MCP](#fase-4--integração-vs-code-via-mcp)
   - [Fase 5 — Signed Snapshot (.dpbundle)](#fase-5--signed-snapshot-dpbundle)
   - [Fase 6 — Git Bootstrap (L1)](#fase-6--git-bootstrap-l1)
4. [Decisões pendentes](#4-decisões-pendentes)
5. [Bugs identificados](#5-bugs-identificados)
6. [Verificação pré-release v0.1.0](#6-verificação-pré-release-v010)
7. [Próximos passos](#7-próximos-passos)
8. [Registro de mudanças na spec](#8-registro-de-mudanças-na-spec)

---

## 1. Síntese Estratégica

### Posicionamento

> **Contratação pelo trabalho real, não pelo currículo.**

### Proposta de valor

**Para o dev**
> Seu trabalho real, documentado automaticamente. Sem CV, sem performance de entrevista.

O dev não faz nada diferente do que já faz. O perfil se constrói enquanto ele trabalha.
Quando alguém precisar saber como ele trabalha de verdade — a resposta já está lá, verificável, assinada por ele.

**Para a empresa**
> Veja como o dev trabalha antes de falar com ele. Não o que ele declara — o que ele demonstra.

Test ratio real ao longo de meses. Ritmo de trabalho. Evolução de padrões.
Tudo derivado de uso real, não auto-declarado.

---

### Perfil do dev-alvo

O dev passivo — não está ativamente procurando emprego, mas está aberto a oportunidades.
Não abre o LinkedIn, não atualiza o CV, não responde cold email de recrutador.
Só se move se a oportunidade parece boa o suficiente para valer a interrupção.

O que ele quer sentir:
> *"Meu trabalho real está documentado. Se aparecer a oportunidade certa,
> eu sou encontrável — sem ter que fazer nada."*

### Perfil da empresa-alvo

- **Fase 1:** startups e empresas médias — self-serve, decisão rápida
- **Fase 2:** enterprise — após casos de sucesso estabelecidos

Problema que a empresa tem:
> *"Eu contrato alguém que parece ótimo no processo seletivo e descubro só depois
> como ele realmente trabalha. Entrevista técnica mede performance sob pressão, não trabalho real."*

---

### Modelo de negócio

**Dev**

| Plano | Preço | O que inclui |
|-------|-------|--------------|
| Grátis | $0 | Daemon, scores, perfil local, URL temporária (30 dias) |
| Diretório | $15–19/mês | Listado no diretório, URL permanente, badge verificado |

O pagamento só ocorre quando o dev decide ativamente ser encontrável.
A URL temporária gratuita permite usar o produto em processos seletivos antes de pagar.

**Empresa**

| Plano | Preço | O que inclui |
|-------|-------|--------------|
| Starter | $199/mês | 1 recrutador · busca + filtros básicos · até 20 contatos/mês |
| Growth | $499/mês | até 3 recrutadores · filtros avançados · contatos ilimitados · histórico |
| Enterprise | custom | ATS integration, relatórios, SLA — fase futura |

Modelo: assinatura com acesso ao diretório — busca, filtro e contato ilimitado (Growth).
Sem success fee, sem créditos por contato.

---

### Ordem de construção

```
1. Dev acumula perfil        v0.1 → v0.3  (em andamento)
2. Diretório + página pública             dev paga para aparecer
3. Portal de recrutadores                 empresa paga para buscar
```

O portal de recrutadores chega com uma base de perfis reais — resolve o problema do chicken-and-egg do marketplace.

---

### Diferenciais competitivos

| O que existe hoje | O que o DevProfile faz diferente |
|-------------------|----------------------------------|
| CV — auto-declarado e estático | Perfil vivo, atualizado a cada sessão de trabalho |
| GitHub — só repos públicos | Captura como o dev pensa, não só o que commitou |
| LinkedIn — exige manutenção constante | Zero manutenção — cresce enquanto o dev trabalha |
| Entrevista técnica — performance sob pressão | Histórico real de meses de trabalho |
| Headhunter — success fee, ciclo longo | Self-serve, assinatura, acesso imediato |

### O que o perfil captura que nenhum currículo captura

- Ritmo e consistência de trabalho ao longo do tempo
- Padrão de testes (test ratio real, evolução de debug-driven para TDD)
- Uso de ferramentas e ecosystems no dia a dia
- Como o dev usa IA no fluxo de trabalho
- Evolução — não só onde está, mas para onde está indo

---

## 2. Visão geral das fases

| Fase | Componente | Versão | Status |
|------|------------|--------|--------|
| 0 | Build & release pipeline | v0.1.0 | ✅ implementada |
| 1 | MCP server TypeScript | v0.1.0 | ✅ implementada |
| 2 | Scoring engine Python | v0.1.0 | ✅ implementada |
| 3 | CLI + instalação via Claude | v0.1.0 | ✅ implementada |
| 4 | Integração VS Code via MCP | v0.1.0 | ✅ implementada |
| 5 | Signed Snapshot (.dpbundle) | v0.2.0 | ⬜ planejada |
| 6 | Git Bootstrap (L1) | v0.3.0 | ⬜ planejada |

**Legenda**

| Ícone | Significado |
|-------|------------|
| ✅ | Concluído e validado |
| 🔄 | Em andamento |
| ⬜ | Não iniciado |
| 🚫 | Bloqueado |
| ⚠️ | Concluído com ressalvas / revisar |

---

## 3. Backlog por fase

### Fase 0 — Build & Release Pipeline

> **Status:** ✅ implementada

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F0.1 | Inicializar monorepo com Bun workspaces | ✅ | `package.json` raiz + workspaces mcp-server e cli |
| F0.2 | Scaffolding mínimo dos 3 pacotes | ✅ | Entry points que compilam sem lógica de produto |
| F0.3 | Build do binário TypeScript com Bun `--compile` | ✅ | Gerar `dist/beheld` standalone |
| F0.4 | Build do binário Python com PyInstaller `--onefile` | ✅ | Gerar `dist/beheld-engine` standalone |
| F0.5 | Embutir binário engine no binário CLI como asset | ✅ | `import engine with { type: "file" }` no Bun |
| F0.6 | Script `scripts/build.sh` local | ✅ | Build completo em um comando |
| F0.7 | Script `scripts/install.sh` público | ✅ | Detecta SO/arch, baixa, verifica SHA256, executa |
| F0.8 | GitHub Actions CI (`ci.yml`) | ✅ | Jobs: `test-ts` (Bun) + `test-python` (pytest) |
| F0.9 | GitHub Actions Release (`release.yml`) | ✅ | Matrix 3 targets, SHA256, GPG sign, publish |
| F0.10 | Job publish atualiza `install.sh` com nova versão | ✅ | sed + commit automático na tag |
| F0.11 | Smoke test: `beheld --version` sem Node/Python no PATH | ✅ | Critério de conclusão da fase |

---

### Fase 1 — MCP Server TypeScript

> **Status:** ✅ implementada

#### Tipos e contratos

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F1.1 | Interface `DevProfileEvent` em `src/types.ts` | ✅ | Todos os campos opcionais tipados corretamente |
| F1.2 | Testes unitários dos tipos (type-checking) | ✅ | Garantir que campos obrigatórios são obrigatórios |

#### Sanitizador

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F1.3 | Função `sanitize()` com os 5 padrões de redação | ✅ | env vars, API keys, tokens, Bearer, passwords |
| F1.4 | Padrão adicional: redação de campos `content` longos (>50 chars) | ✅ | Nunca gravar texto livre de conversas |
| F1.5 | Testes unitários: cada padrão com fixture positiva e negativa | ✅ | Campos numéricos e booleanos nunca modificados |

#### Writer JSONL

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F1.6 | Classe `JsonlWriter` — append e criação de arquivo | ✅ | `~/.beheld/sessions/YYYY-MM-DD_<uuid>.jsonl` |
| F1.7 | Rotação automática à meia-noite | ✅ | Novo arquivo no dia seguinte |
| F1.8 | Rotação por tamanho (>50 MB → gzip + novo arquivo) | ✅ | |
| F1.9 | Índice de sessões em `sessions/index.json` | ✅ | |
| F1.10 | Testes: mesmo session_id → mesmo arquivo | ✅ | |
| F1.11 | Testes: dias diferentes → arquivos diferentes | ✅ | |
| F1.12 | Testes: append-only (nunca sobrescreve) | ✅ | |

#### Handlers de hooks do Claude Code

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F1.13 | `handlePreToolUse()` — extrai campos permitidos | ✅ | `tool_name`, `session_id`, `timestamp` |
| F1.14 | `handlePostToolUse()` — extrai campos + `duration_ms` | ✅ | Sanitize em `tool_response` |
| F1.15 | `handleStop()` — marca fim de sessão | ✅ | `session_id`, `timestamp`, `total_turns` |
| F1.16 | Cálculo de `cwd_hash` (SHA256 do cwd) | ✅ | Identifica projeto sem revelar path |
| F1.17 | Detecção de `has_test_context` por keywords no comando | ✅ | rspec, jest, pytest, playwright, vitest |
| F1.18 | Detecção de `file_extension` em `read_file`/`write_file` | ✅ | |

#### Handler do Continue.dev

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F1.19 | `handleMcpRequest()` — mapeia eventos Continue.dev | ✅ | chat_request, chat_response, edit_apply, command_run |
| F1.20 | Extração de `prompt_length` sem gravar o texto | ✅ | Apenas `string.length` |
| F1.21 | Retorno `null` para eventos desconhecidos | ✅ | |

#### HTTP Server

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F1.22 | `Bun.serve()` na porta 7337 | ✅ | |
| F1.23 | `POST /hook/pre-tool` | ✅ | |
| F1.24 | `POST /hook/post-tool` | ✅ | |
| F1.25 | `POST /hook/stop` | ✅ | Dispara processamento no engine após gravar |
| F1.26 | `POST /mcp` — endpoint MCP para Continue.dev | ✅ | |
| F1.27 | `GET /status` | ✅ | `{ running, session_active, events_today }` |
| F1.28 | `GET /session/current` — métricas da sessão ativa | ✅ | |
| F1.29 | `GET /health` — `{ ok, version, uptime_seconds }` | ✅ | |
| F1.30 | Erros sem stack trace — apenas `{ error: string }` | ✅ | |

#### Timing de atualização do perfil

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F1.31 | Hook `Stop` dispara `POST localhost:7338/process` em background | ✅ | Não bloqueia a resposta do hook |
| F1.32 | Hook `Stop` verifica se deve enviar notificação diária | ✅ | Após processamento concluir |
| F1.33 | Hook `Stop` verifica nova versão disponível (1x/dia) | ✅ | Timeout 3s, ignora falha |
| F1.34 | Leitura de perfil (`/session/current`, `/status`) é sempre do SQLite | ✅ | Nunca dispara reprocessamento |

#### Tools MCP

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F1.35 | Tool `beheld` — busca scores e formata perfil | ✅ | Parâmetro `view`: summary/scores/insights/full |
| F1.36 | Tool `beheld_status` — retorna score atual para sidebar | ✅ | Para Continue.dev na Fase 4 |
| F1.37 | Registro das tools no endpoint `/mcp` | ✅ | |

#### Escopo global do /beheld

> **Problema a evitar:** quando o MCP server é registrado com escopo de projeto, o Claude Code exibe prompt de confirmação a cada invocação em projetos diferentes. **Causa raiz:** registro em `~/.claude/projects/<hash>/settings.json` (escopo de projeto) em vez de `~/.claude/settings.json` (escopo global de usuário). **Solução:** registrar exclusivamente no `~/.claude/settings.json` global.

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F1.42 | Registro do MCP server em `~/.claude/settings.json` — escopo global | ✅ | Nunca em `~/.claude/projects/<hash>/settings.json` |
| F1.43 | `beheld init` detecta e corrige registro em escopo de projeto | ✅ | Remove de `~/.claude/projects/*/settings.json` se encontrar |
| F1.44 | Registro no Continue.dev em `~/.continue/config.json` — escopo global | ✅ | Não em `.continue/config.json` local do workspace |
| F1.45 | `beheld init` nunca cria ou edita arquivos de config dentro do CWD | ✅ | Proibido: `./.claude/`, `./.continue/` — apenas `~/` |
| F1.46 | Validação cruzada: `/beheld` sem prompt em projeto diferente do instalado | ✅ | Teste: init em `~/projects/a`, invocar em `~/projects/b` sem confirmação |
| F1.47 | Wizard tela 3 informa: "disponível em todos os projetos, sem confirmação" | ✅ | |
| F1.48 | `beheld delete --all` remove de `~/.claude/settings.json` e de qualquer escopo de projeto | ✅ | Limpeza completa |

#### Daemon e autostart

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F1.38 | PID gravado em `~/.beheld/daemon.pid` | ✅ | |
| F1.39 | LaunchAgent para macOS | ✅ | `com.beheld.daemon.plist` |
| F1.40 | Systemd user service para Linux | ✅ | `beheld.service` |
| F1.41 | Log com rotação em 10 MB | ✅ | `~/.beheld/daemon.log` |

#### Critérios de conclusão da Fase 1

| Critério | Status |
|----------|--------|
| `localhost:7337/health` responde `{ ok: true }` | ✅ |
| POST `/hook/pre-tool` grava evento no JSONL | ✅ |
| Sanitizador remove API keys de qualquer campo | ✅ |
| `has_test_context = true` quando command contém "rspec" | ✅ |
| `cwd_hash` é SHA256 hex, não o path | ✅ |
| Arquivo JSONL em `~/.beheld/sessions/` com nome correto | ✅ |
| Hook Stop dispara processamento do engine em background | ✅ |
| Daemon reinicia após reboot | ✅ |
| `/beheld` responde em projeto diferente sem prompt de confirmação | ✅ |
| Nenhum arquivo de config criado dentro do diretório do projeto | ✅ |
| `bun test packages/mcp-server` passa sem erros | ✅ |

---

### Fase 2 — Scoring Engine Python

> **Status:** ✅ implementada

#### Setup e storage

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F2.1 | `pyproject.toml` com dependências e grupo `[dev]` | ✅ | fastapi, uvicorn, anthropic, apscheduler |
| F2.2 | Schema SQLite — tabela `sessions` | ✅ | |
| F2.3 | Schema SQLite — tabela `technical_signals` | ✅ | |
| F2.4 | Schema SQLite — tabela `scores` | ✅ | |
| F2.5 | Schema SQLite — tabela `profile` (cache e config) | ✅ | |
| F2.6 | Funções CRUD em `src/storage/sqlite.py` | ✅ | save, get, history, set_profile |
| F2.7 | Testes com banco em memória (`:memory:`) | ✅ | |

#### Leitor incremental de JSONL

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F2.8 | Dataclass `Session` com todos os campos | ✅ | |
| F2.9 | Classe `JsonlReader` com cursor persistente | ✅ | `~/.beheld/.cursor` |
| F2.10 | `read_new_sessions()` processa apenas eventos novos | ✅ | |
| F2.11 | Agrupamento de eventos por `session_id` | ✅ | |
| F2.12 | Skip de linhas JSON inválidas sem falhar | ✅ | Log warning |
| F2.13 | Teste: segunda chamada retorna lista vazia | ✅ | Cursor foi atualizado |
| F2.14 | Teste: fixtures JSONL em `tmp_path` | ✅ | |

#### Extratores

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F2.15 | `commands.py` — `detect_platforms()` com 8 plataformas | ✅ | docker, github, cloud_infra, ci_cd, database, testing, mobile, blockchain |
| F2.16 | `files.py` — `detect_ecosystems()` com 6 ecosystems | ✅ | rails, node, python, flutter, react, devops |
| F2.17 | `tools.py` — `detect_workflow()` com 5 padrões | ✅ | tdd, test-after, debug-driven, refactor, exploratory |
| F2.18 | `timing.py` — `analyze_timing()` com horário e modo | ✅ | peak_hours, avg_duration, work_mode, rhythm |
| F2.19 | Testes de cada extrator com casos-limite | ✅ | Lista vazia, sequência mista, sem extensão |

#### Classificador de projeto

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F2.20 | Heurística local com 5 regras de combinação | ✅ | Sem chamar IA se confiança ≥ 0.70 |
| F2.21 | Classificação via Anthropic API com prompt restritivo | ✅ | Prompt nunca menciona domínio de negócio |
| F2.22 | Sanitização do output da IA — rejeita termos de negócio | ✅ | Retorna "unknown" se detectar |
| F2.23 | Fallback Ollama quando `ANTHROPIC_API_KEY` ausente | ✅ | `localhost:11434` com qwen2.5-coder:14b |
| F2.24 | Confiança < 0.60 → categoria `"unknown"` | ✅ | Não força classificação incorreta |
| F2.25 | Testes mockando API — confirma sanitização do output | ✅ | |

#### Scorers (4 dimensões)

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F2.26 | `PromptQualityScorer.score()` — 6 sinais, pesos documentados | ✅ | |
| F2.27 | `TestMaturityScorer.score()` — 4 sinais, pesos documentados | ✅ | |
| F2.28 | `TechBreadthScorer.score()` — 4 sinais, pesos documentados | ✅ | |
| F2.29 | `GrowthRateScorer.score()` — compara 30d vs 30d anteriores | ✅ | Retorna 50 se histórico < 60 dias |
| F2.30 | Testes: sessão vazia → 0 (ou 50 para growth) | ✅ | |
| F2.31 | Testes: sessão ideal → score próximo de 100 | ✅ | |
| F2.32 | Score geral (`overall`) = média ponderada dos 4 scores | ✅ | Pesos: quality 30%, maturity 30%, breadth 25%, growth 15% |

#### Timing de atualização

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F2.33 | `POST /process` aceita chamada do MCP server (via Stop hook) | ✅ | Responde 202 Accepted imediatamente |
| F2.34 | Processamento roda em background (thread/asyncio task) | ✅ | |
| F2.35 | `GET /scores/current` lê apenas SQLite — nunca dispara processamento | ✅ | Resposta sempre < 50ms |
| F2.36 | `GET /scores/current` retorna `sessions_today` e `updated_at` | ✅ | |
| F2.37 | Detecção de eventos órfãos (JSONL mais novo que último processamento) | ✅ | Reportado em `/status` como `unprocessed_events: N` |

#### Geração de insights

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F2.38 | `InsightGenerator.generate()` com payload seguro | ✅ | Nunca inclui conteúdo de conversas |
| F2.39 | Cache de insights no SQLite com TTL de 24h | ✅ | Chave `"insights_cache"` na tabela `profile` |
| F2.40 | Insights rodam assincronamente após processamento | ✅ | Não bloqueiam o cálculo de scores |
| F2.41 | Flag `force=True` para regenerar ignorando cache | ✅ | |
| F2.42 | Geração de 3 tipos: strength, opportunity, trend | ✅ | |

#### FastAPI e scheduler

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F2.43 | `POST /process` — processa novos JSONL | ✅ | Responde 202, processa em background |
| F2.44 | `GET /scores/current` | ✅ | |
| F2.45 | `GET /scores/history?days=N` | ✅ | |
| F2.46 | `GET /profile/summary` | ✅ | plataformas, ecosystems, workflow, categorias |
| F2.47 | `GET /insights` | ✅ | Retorna cache, regenera se expirado |
| F2.48 | `GET /export` — JSON para sync com plataforma web | ✅ | Nunca inclui eventos individuais |
| F2.49 | `GET /health` | ✅ | `{ ok, version, db_path, sessions_processed }` |
| F2.50 | APScheduler: polling de JSONL a cada 60s (fallback ao Stop) | ✅ | Processa apenas se há eventos novos não processados |

#### PyInstaller

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F2.51 | `build.sh` com PyInstaller `--onefile` | ✅ | |
| F2.52 | Smoke test: `./dist/beheld-engine` sem Python no PATH | ✅ | |

#### Critérios de conclusão da Fase 2

| Critério | Status |
|----------|--------|
| `localhost:7338/health` responde `{ ok: true }` | ✅ |
| `POST /process` com JSONL real grava sessão no SQLite | ✅ |
| `GET /scores/current` responde em < 50ms (leitura pura) | ✅ |
| `POST /process` responde 202 imediatamente (background) | ✅ |
| Classificador não retorna palavras de negócio no output | ✅ |
| Detector de workflow: sequência TDD → retorna "tdd" | ✅ |
| Scorer prompt quality: sessão vazia → 0 | ✅ |
| Growth rate: histórico < 60 dias → retorna 50 | ✅ |
| Insights cacheados no SQLite (não chama IA na segunda leitura) | ✅ |
| `pytest packages/engine/tests` passa sem erros | ✅ |
| Binário PyInstaller executa sem Python no host | ✅ |

---

### Fase 3 — CLI + Instalação via Claude

> **Status:** ✅ implementada

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F3.1 | Clientes HTTP para portas 7337 e 7338 | ✅ | Timeout 3s, retorna null se offline |
| F3.2 | `engine-extractor.ts` — extrai binário embarcado | ✅ | `~/.beheld/bin/engine` |
| F3.3 | `daemon-manager.ts` — start, stop, isRunning | ✅ | |
| F3.4 | Instalação de autostart (macOS + Linux) | ✅ | |
| F3.5 | Wizard 4 telas com readline | ✅ | Tela 1: transparência, 2: opt-in, 3: ambientes, 4: progresso |
| F3.6 | `installClaudeCodeHooks()` — edita `~/.claude/settings.json` (global) | ✅ | Nível de usuário — não cria config local no projeto |
| F3.7 | `installContinueDevMcp()` — edita `~/.continue/config.json` (global) | ✅ | Nível de usuário — não cria config local no workspace |
| F3.8 | `removeAllHooks()` — remove apenas entradas do DevProfile | ✅ | |
| F3.9 | Renderer de perfil ANSI com barras de progresso | ✅ | Verde ≥75, amarelo 50–74, vermelho <50 |
| F3.10 | Comando `beheld init` | ✅ | |
| F3.11 | Comando `beheld start / stop / status` | ✅ | |
| F3.12 | Comando `beheld view` com flags `--json`, `--scores-only`, `--since`, `--dimension` | ✅ | `--refresh` força reprocessamento se há eventos órfãos |
| F3.13 | Comando `beheld update` com verificação de SHA256 | ✅ | |
| F3.14 | Comando `beheld delete` com confirmação obrigatória | ✅ | |
| F3.15 | Subcomando `beheld server` para autostart do SO | ✅ | Inicia apenas o MCP server |
| F3.16 | Salva config em `~/.beheld/config.json` | ✅ | Dimensões ativas, portas, notificações |
| F3.17 | Testes de integração com daemons mockados | ✅ | |

---

### Fase 4 — Integração VS Code via MCP

> **Status:** ✅ implementada

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F4.1 | Tool `beheld_status` registrada no MCP server | ✅ | Score, sessions_today, top_insight |
| F4.2 | Tool `beheld` — views: summary, scores, insight, full | ✅ | Plain text legível no chat do Continue.dev |
| F4.3 | `NotificationService.send()` — macOS e Linux | ✅ | osascript / notify-send |
| F4.4 | `shouldNotifyToday()` — controle por tipo e data | ✅ | `~/.beheld/notifications.json` |
| F4.5 | Notificação diária de score no Stop (1x/dia) | ✅ | Com delta vs ontem |
| F4.6 | Notificação de update disponível (1x/dia) | ✅ | |
| F4.7 | Respeitar `config.json` — `notifications.enabled` | ✅ | |
| F4.8 | Teste manual: score na sidebar do Continue.dev | ✅ | VS Code 1.85+ com Continue.dev v0.9+ |
| F4.9 | Teste manual: `/beheld` no chat do Continue.dev | ✅ | |

---

### Fase 5 — Signed Snapshot (.dpbundle)

> **Status:** ⬜ planejada · v0.2.0 · bloqueada por v0.1.0 released

#### Decisões definidas

| ID | Decisão | Resolução |
|----|---------|-----------|
| SS-D1 | Payload do bundle | Todas as informações — 4 scores + sinais técnicos brutos (plataformas, ecosystems, workflow distribution, project categories) |
| SS-D2 | TTL da URL pública | 30 dias sem conta · permanente com conta |
| SS-D3 | Rotação de chaves | **Opção A** — bundle carrega a `public_key` usada na assinatura. Cada snapshot é verificável com a chave embutida nele. Chaves antigas não são invalidadas. Comprometimento de chave não afeta integridade histórica (bundle é read-only por design) |
| SS-D4 | Versão de lançamento | v0.2.0 — primeira feature pós-release |

#### Estrutura do .dpbundle

```json
{
  "version": "1",
  "payload": {
    "created_at": "2026-05-11T10:00:00Z",
    "beheld_version": "0.1.0",
    "previous_hash": "sha256:abc123...",
    "scores": {
      "overall": 78,
      "prompt_quality": 84,
      "test_maturity": 62,
      "tech_breadth": 91,
      "growth_rate": 75
    },
    "signals": {
      "platforms": { "docker": 72, "github": 44, "vscode": 58 },
      "ecosystems": { "rails": 89, "react": 76, "python": 61 },
      "workflow_distribution": { "tdd": 0.23, "test-after": 0.39, "debug-driven": 0.31 },
      "project_categories": { "saas_b2b": 0.38, "api_backend": 0.24 },
      "sessions_analyzed": 847,
      "period_days": 90
    }
  },
  "hash": "sha256:...",
  "signature": "ed25519:...",
  "public_key": "ed25519-pub:..."
}
```

#### F5.1 — Geração de chaves Ed25519

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F5.1.1 | Geração automática no `beheld init` se chave não existir | ⬜ | `~/.beheld/keys/private.pem` com permissão `0600` |
| F5.1.2 | Chave pública exportável em `~/.beheld/keys/public.pem` | ⬜ | |
| F5.1.3 | `beheld keys show` — exibe chave pública atual | ⬜ | |
| F5.1.4 | `beheld keys import <path>` — importa chave Ed25519 existente | ⬜ | Valida formato antes de substituir |
| F5.1.5 | `beheld keys rotate` — gera novo par, mantém histórico de chaves públicas | ⬜ | Snapshots antigos continuam verificáveis com chave embutida |
| F5.1.6 | Lib: `@noble/ed25519` (zero deps, auditável) | ⬜ | |
| F5.1.7 | Testes unitários para geração, importação e rotação | ⬜ | |

#### F5.2 — Chain of snapshots

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F5.2.1 | Tabela `snapshots` no SQLite — `id`, `hash`, `previous_hash`, `created_at`, `bundle_path` | ⬜ | |
| F5.2.2 | Genesis snapshot tem `previous_hash: null` | ⬜ | |
| F5.2.3 | Cada novo snapshot referencia o `hash` do anterior | ⬜ | |
| F5.2.4 | Endpoint `GET /snapshot/latest` — retorna hash do último snapshot | ⬜ | Usado pelo CLI na geração |
| F5.2.5 | Validação de cadeia na verificação — detecta adulteração retroativa | ⬜ | |
| F5.2.6 | Testes: adulteração de snapshot intermediário quebra cadeia | ⬜ | |

#### F5.3 — Geração do .dpbundle

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F5.3.1 | `beheld snapshot` — comando CLI principal | ⬜ | |
| F5.3.2 | Endpoint `POST /snapshot/payload` no engine — monta payload com todas as métricas | ⬜ | Engine monta, CLI assina |
| F5.3.3 | CLI calcula SHA-256 do payload serializado (JSON canônico — chaves ordenadas) | ⬜ | Determinístico: mesmos dados = mesmo hash |
| F5.3.4 | CLI assina o hash com Ed25519 | ⬜ | |
| F5.3.5 | CLI embute `public_key` no bundle | ⬜ | |
| F5.3.6 | Salva `.dpbundle` em `~/.beheld/snapshots/` e no path especificado por `--output` | ⬜ | |
| F5.3.7 | `beheld snapshot list` — lista histórico com data, overall e hash | ⬜ | |
| F5.3.8 | `beheld verify <arquivo.dpbundle>` — verificação offline | ⬜ | Verifica hash + assinatura + cadeia |
| F5.3.9 | Testes end-to-end: gerar, verificar, adulterar e detectar adulteração | ⬜ | |

#### F5.4 — Upload e QR code

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F5.4.1 | `beheld snapshot --share` — upload para portal + QR | ⬜ | |
| F5.4.2 | QR code no terminal via unicode block chars (sem dependência de imagem) | ⬜ | Lib: `qrcode-terminal` |
| F5.4.3 | URL curta retornada pelo portal: `beheld.dev/v/<id>` | ⬜ | |
| F5.4.4 | TTL: 30 dias sem conta · permanente com conta | ⬜ | Header `X-TTL` na resposta do upload |
| F5.4.5 | Upload falha graciosamente — bundle local sempre gerado primeiro | ⬜ | Erro de rede não impede geração local |

#### F5.5 — Verificação pública (plataforma web)

| ID | Item | Status | Notas |
|----|------|--------|-------|
| F5.5.1 | Endpoint `POST /bundles` no backend Rails — armazena bundle | ⬜ | |
| F5.5.2 | Página `GET /v/:id` — exibe perfil verificado publicamente | ⬜ | Sem conta para visualizar |
| F5.5.3 | Verificação Ed25519 no browser via Web Crypto API | ⬜ | Sem chamada ao backend para verificar |
| F5.5.4 | Exibe: scores, data, status da assinatura (✓/✗), integridade da chain | ⬜ | |
| F5.5.5 | Badge embed: `<img src="beheld.dev/v/:id/badge.svg">` | ⬜ | Para README e LinkedIn |

---

### Fase 6 — Git Bootstrap (L1)

> **Status:** ⬜ planejada · v0.3.0 · bloqueada por v0.2.0

> Execute um prompt por sessão no Claude Code. Ordem obrigatória: F6.1 → F6.2 → F6.3 → F6.4 → F6.5 → F6.6 → F6.7 → F6.8

#### Contexto de camadas

A Fase 6 introduz duas camadas distintas no perfil:
- **L1:** sinais extraídos de repositórios git (histórico — imutável por repo)
- **L2:** sinais de sessão do Claude Code / Continue.dev (contínuo — já existente)

Os scorers **nunca** misturam as duas camadas como se fossem o mesmo sinal.

#### Contexto global (cole no início de cada sessão Claude Code)

```
Você está trabalhando no DevProfile — daemon local que constrói o perfil
técnico de um desenvolvedor a partir do uso do Claude Code e do Continue.dev.

Stack:
- TypeScript compilado com Bun (MCP server + CLI) — sem Node.js no host
- Python compilado com PyInstaller (scoring engine) — sem Python no host
- SQLite local em ~/.beheld/profile.db
- Monorepo com Bun workspaces

Estrutura do repositório:
  beheld/
  ├── packages/
  │   ├── mcp-server/src/     # TypeScript — captura eventos, hooks Claude Code
  │   ├── engine/src/         # Python — lê JSONL, calcula scores, SQLite
  │   └── cli/src/            # TypeScript — comandos, wizard, binário final
  ├── scripts/
  └── .github/workflows/

Portas locais:
  7337 — MCP server
  7338 — scoring engine (FastAPI)

Regras de implementação:
1. Implemente uma feature por vez, completa e funcional antes de avançar
2. Escreva testes junto com o código — nunca depois
3. Nunca deixe TODO ou placeholder — implemente ou não inclua
4. Valide cada critério de conclusão antes de reportar como concluída
5. Prefira código explícito a abstrações prematuras
6. Use conventional commits: feat:, fix:, chore:, test:, docs:
```

#### F6.1 — Modelo de dados L1

**Tabelas SQLite a adicionar em `packages/engine/src/storage/sqlite.py`:**

Tabela `l1_repositories`:
- `root_commit_hash TEXT PRIMARY KEY` — hash SHA-1 do primeiro commit (opaco)
- `imported_at TEXT NOT NULL` — ISO-8601
- `commit_count INTEGER NOT NULL`
- `author_email_hash TEXT NOT NULL` — SHA-256 do email do dev, nunca o email

Tabela `l1_signals`:
- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `root_commit_hash TEXT NOT NULL REFERENCES l1_repositories`
- `file_extensions TEXT NOT NULL DEFAULT '{}'` — JSON: `{"py": 312, "rb": 88}`
- `ecosystems TEXT NOT NULL DEFAULT '{}'` — JSON: `{"rails": true}`
- `platforms TEXT NOT NULL DEFAULT '{}'` — JSON: `{"docker": true}`
- `test_ratio REAL NOT NULL DEFAULT 0.0`
- `timing TEXT NOT NULL DEFAULT '{}'` — JSON: `{"peak_hours": [9,10]}`
- `first_commit_at TEXT`, `last_commit_at TEXT`

View `l1_aggregated` — campos: `total_repos`, `total_commits`, `earliest_commit`, `latest_commit`, `all_extensions_json`, `all_ecosystems_json`, `all_platforms_json`, `avg_test_ratio`

**Funções CRUD:** `save_l1_repository`, `save_l1_signals`, `get_l1_summary`, `get_l1_repositories`, `delete_l1_repository` (cascata)

**Endpoints FastAPI:** `GET /l1/summary`, `GET /l1/repositories`, `DELETE /l1/repositories/{root_hash}`

**Restrições de privacidade:** nunca adicionar colunas para nome do repositório, URL, path, branch names, commit messages, nomes de arquivo completos, texto livre.

**Critério de conclusão:** `pytest packages/engine/tests/test_l1_storage.py` → todos passando · `GET /l1/summary` com banco vazio retorna zeros sem erro 500

#### F6.2 — Extrator git

**Arquivo:** `packages/engine/src/l1/git_extractor.py`

Fluxo interno do `extract(repo_url, author_email, git_env)`:
1. `tmpdir = tempfile.mkdtemp()`
2. `try:` clonar com `--bare --filter=blob:none`, verificar autoria, extrair root_commit_hash, contar commits do autor, extrair timestamps, extrair nomes de arquivo do log
3. A partir dos nomes: contar extensões, detectar ecosystems (Gemfile→rails, package.json→node, pyproject.toml→python, etc.), detectar plataformas (Dockerfile→docker, .github/workflows/→github, etc.), calcular test_ratio
4. `finally: shutil.rmtree(tmpdir, ignore_errors=True)` — **SEMPRE executado**

**Exceções:** `AuthorNotFoundError`, `CloneError`, `ExtractionError`

**Restrições críticas:** conteúdo de arquivo nunca baixado; mensagens de commit, nomes de branch e paths absolutos nunca gravados; tmpdir sempre removido no `finally`; `author_email_hash = hashlib.sha256(email.encode()).hexdigest()[:16]`

**Critério de conclusão:** `pytest packages/engine/tests/l1/test_git_extractor.py` → todos passando

#### F6.3 — Autenticação e clone

**Arquivo:** `packages/engine/src/l1/auth_resolver.py`

Cascata de autenticação:
1. SSH agent disponível? → usa socket do agente
2. `gh` CLI autenticado? → delega clone ao gh
3. `glab` CLI autenticado? → delega clone ao glab
4. Nenhum → solicita PAT temporário no CLI

**Regras críticas:** PAT nunca em argv — sempre via `GIT_ASKPASS`; script GIT_ASKPASS sempre removido no `finally`; token nunca logado; nunca gravado em nenhum arquivo além do script temporário.

**Critério de conclusão:** `pytest packages/engine/tests/l1/test_auth_resolver.py` → todos passando · `test_pat_never_appears_in_argv` confirma proteção

#### F6.4 — Engine: endpoint de ingestão

**Arquivo:** `packages/engine/src/l1/importer.py`

Fluxo do `L1Importer.import_repository()`:
1. Verifica idempotência pelo `root_commit_hash` **antes** do clone
2. Resolve autenticação → se `needs_pat`: retorna `{"status": "needs_pat"}`
3. Clona e extrai sinais → trata `AuthorNotFoundError`, `CloneError`
4. Persiste no SQLite
5. Retorna `{"status": "imported", "root_commit_hash": ..., "commit_count": ...}`

**Endpoints:** `POST /l1/import` (202 imediato + background task), `GET /l1/import/status`

**Critério de conclusão:** `POST /l1/import` com repo público retorna 202 imediatamente · `GET /l1/import/status` retorna schema válido em qualquer estado

#### F6.5 — Scorers: separação L1 / L2

**Contrato base:** cada scorer declara `data_sources: ClassVar[list[Literal["l1", "l2"]]]`

| Scorer | Fontes | Lógica |
|--------|--------|--------|
| TechBreadthScorer | l1, l2 | `final = l1_score * 0.60 + l2_score * 0.40`; se L1 vazio → só L2; se L2 vazio → só L1 |
| TestMaturityScorer | l1, l2 | `final = l1_baseline * 0.50 + l2_score * 0.50` |
| GrowthRateScorer | l1, l2 | Compara ecosystems/test_ratio/platforms L2 contra baseline L1; se L1 vazio → comportamento atual |
| PromptQualityScorer | l2 | Exclusivamente L2 — sem alteração |

**Critério de conclusão:** `pytest packages/engine/tests/l1/test_scorers_l1.py` → todos passando · nenhum teste existente quebrado

#### F6.6 — CLI: comando `beheld import`

**Arquivo:** `packages/cli/src/commands/import.ts`

Fluxo do loop interativo:
1. Solicita URL (Enter vazio → exibe resumo e encerra)
2. Chama `POST /l1/import`
3. Se `needs_pat`: solicita PAT sem echo, rechama, descarta da memória
4. Polling em `GET /l1/import/status` a cada 1s com spinner e mensagens de progresso
5. Trata `author_not_found`, `already_imported`, `clone_error`
6. Loop volta ao passo 1

**Flags:** `--list` (tabela formatada), `--remove <hash>` (com confirmação), `--github`, `--gitlab`

**Na primeira execução:** pergunta email de commit e salva em `config.json`

**Critério de conclusão:** `bun test packages/cli/tests/import.test.ts` → todos passando · PAT não aparece em nenhum arquivo após execução

#### F6.7 — Onboarding: bootstrap integrado ao wizard

Adiciona **Tela 3.5** entre opt-in (Tela 2) e ambientes (Tela 3):

```
─────────────────────────────────────────────────────
DevProfile · Histórico git (opcional)
─────────────────────────────────────────────────────

Seu perfil começa a se formar a partir de hoje.
Quer carregar também o histórico dos seus projetos anteriores?

O que é coletado:   extensões de arquivo, ecosystems, timing
O que é ignorado:   mensagens de commit, nomes de branch, conteúdo de código

Cada repositório é processado uma única vez.
Reimportar o mesmo repo não altera o perfil.

[1] Importar agora
[2] Importar depois  (beheld import)
[3] Pular
```

**Mensagem de privacidade obrigatória:**
- "Cada repositório é processado uma única vez — reimportar não altera o perfil."
- "Mensagens de commit, nomes de branch e conteúdo de código nunca são gravados."

**Critério de conclusão:** `bun test packages/cli/tests/init.test.ts` → todos passando · Opção [3] não pergunta email nem faz chamada ao engine

#### F6.8 — Integração com .dpbundle

Atualiza o bundle para incluir L1 e L2 como seções separadas:

```json
{
  "payload": {
    "l1": {
      "total_repos": 12,
      "total_commits": 4832,
      "ecosystems": {"rails": true, "python": true},
      "platforms": {"docker": true},
      "avg_test_ratio": 0.42,
      "root_commit_hashes": ["a3f8c1d2..."]
    },
    "l2": {
      "sessions_analyzed": 847,
      "period_days": 90,
      "workflow_distribution": {"tdd": 0.23}
    }
  }
}
```

**Regra:** se L1 vazio (bootstrap não realizado), seção presente com zeros/listas vazias. Nenhum campo contém texto livre.

**Output do `beheld snapshot`:**
```
Base histórica:       12 repositórios · 4.832 commits
Trajetória observada: 847 sessões · 90 dias
```

**Critério de conclusão:** bundle gerado contém chaves `"l1"` e `"l2"` como objetos distintos · `beheld verify` valida L1 e L2 separadamente

#### Verificação final — Fase 6 completa

Checklist antes da tag `v0.3.0`:

```
[ ] beheld import <url> clona, extrai sinais e descarta clone
[ ] Mesmo repo importado duas vezes → segundo retorna already_imported
[ ] Repo sem commits do dev → rejeitado com mensagem clara
[ ] Cascata SSH → gh CLI → glab CLI → PAT funciona
[ ] PAT nunca aparece em logs, disco ou paths temporários
[ ] TechBreadthScorer com apenas L1 → score válido (não zero)
[ ] GrowthRateScorer compara L2 atual contra baseline L1
[ ] PromptQualityScorer ignora L1 — sem alteração de comportamento
[ ] Clone usa --bare --filter=blob:none
[ ] beheld import --list exibe tabela correta
[ ] Wizard beheld init oferece Tela 3.5 de bootstrap
[ ] Bundle .dpbundle inclui seções l1 e l2 separadas
[ ] pytest packages/engine/tests → zero falhas
[ ] bun test packages/cli → zero falhas
```

---

## 4. Decisões pendentes

| ID | Decisão | Status | Resolução |
|----|---------|--------|-----------|
| D1 | Score geral: pesos da média ponderada dos 4 scores | ✅ resolvido | `quality 30% · maturity 30% · breadth 25% · growth 15%` — banker's rounding documentado |
| D2 | Fallback quando engine offline no `/beheld` | ✅ resolvido | `source: "cache"` via `bun:sqlite` direto. View exibe aviso com data. `process.exit(1)` sem nenhum dado. |
| D3 | Comportamento do Stop hook se engine demorar > 3s | ✅ resolvido | Fire-and-forget com `AbortController` 3s + `clearTimeout` no `finally`. Stop retorna em 17ms independente do engine. |
| D4 | Mínimo de sessões para exibir o perfil | ✅ resolvido | 3 sessões mínimas — `/profile/readiness`, `renderCollecting()` com barra de progresso, singular/plural correto. |
| D5 | Nome do repositório no GitHub | ✅ resolvido | `eduardovrocha/beheld` |
| D6 | Domínio do produto | ⚠️ pendente | `beheld.dev` assumido na spec — confirmar |

---

## 5. Bugs identificados

| ID | Bug | Impacto | Status |
|----|-----|---------|--------|
| B1 | `beheld start` e `beheld init` não detectam daemons já em execução | Médio | ✅ resolvido — `isMcpRunning()` + `isEngineRunning()` via `/health` antes de qualquer spawn |
| B2 | `beheld server` sobe HTTP server em vez de implementar protocolo MCP stdio | Alto | ✅ resolvido — `StdioServerTransport` do SDK MCP. Flag `--stdio` explícito em `args`. |
| B3 | `engine-extractor.ts` não executa `codesign` após extrair o binário no macOS | Alto | ✅ resolvido — `xattr -d quarantine` + `codesign --sign -` em `codesignEngine()`. |
| B4 | Path leakage em `metadata.command` — caminhos absolutos expostos nos JSONL | 🔴 Crítico | ✅ resolvido — `sanitizeMetadata()` substitui paths por `[path:<8-char-hash>]`. |
| B5 | Permissões `~/.beheld` são `0755` em vez de `0700` | 🔴 Crítico | ✅ resolvido — `mode: 0o700` em todos os `mkdirSync`. `ensureSecurePermissions()` corrige instalações existentes. |
| B6 | Engine não é iniciado pelo LaunchAgent após reboot — só porta 7337 sobe | Alto | ✅ resolvido — LaunchAgent e systemd usam `beheld start`. |
| B7 | `beheld view --json` polui stdout com warnings — quebra pipe com `jq` | Alto | ✅ resolvido — warnings redirecionados para `process.stderr` quando `--json` ou `--scores-only`. |
| B8 | Teste CLI stale: `installClaudeMcpServer` espera `args: ["server"]` mas implementação usa `["server", "--stdio"]` | Alto | ✅ resolvido — testes atualizados. 69/69 testes CLI passando. |
| B9 | Testes CLI assumem engine offline — falham se porta 7338 estiver em uso | Médio | ⬜ pendente |
| B10 | `processor.py` e `insights.py` sem testes unitários dedicados | Médio | ⬜ pendente |
| B11 | `timing.py` — `work_mode` sempre retorna `"solo"` (placeholder) | Médio | ⬜ pendente |
| B12 | `installClaudeSlashCommand()` não sobrescreve arquivo vazio | Alto | ✅ resolvido — guarda agora verifica `existsSync` + `isEmpty`. Preserva conteúdo customizado. |

---

## 6. Verificação pré-release v0.1.0

| Item | Resultado |
|------|-----------|
| mcp-server | 134 pass · 0 fail |
| cli | 69 pass · 0 fail |
| engine | 149 pass · 0 fail |
| **Total** | **352 pass · 0 fail** |
| Bugs B1–B8 | ✅ todos corrigidos |
| Endpoints HTTP (10/10) | ✅ todos 200 |
| `~/.claude.json` | ✅ `type: stdio` · `args: ["server","--stdio"]` |
| `~/.claude/settings.json` | ✅ hooks PreToolUse · PostToolUse · Stop |
| Slash command | ⚠️ ausente nesta máquina de dev — código correto, `beheld init` cria no primeiro uso |
| **Veredicto** | **✅ PRONTO para tag v0.1.0** |

---

## 7. Próximos passos

### Release (v0.1.0)

| Prioridade | Ação | Bloqueia |
|-----------|------|---------|
| 🔴 Alta | Resolver D5 — criar repositório GitHub | Primeiro release |
| 🔴 Alta | Resolver D6 — registrar domínio | `install.sh` público |
| 🟢 | Criar tag `v0.1.0` — GitHub Actions publica 3 binários automaticamente | Distribuição |
| 🟢 | Teste end-to-end em ambiente limpo (macOS + Linux) | Validação final |

### Pós-release (v0.2.0 — Signed Snapshot)

| Prioridade | Item |
|-----------|------|
| 🟡 B9 | Mockar `engine-client` nos testes que assumem porta 7338 offline |
| 🟡 B10 | Criar `test_processor.py` e `test_insights.py` com fixtures JSONL reais |
| 🟡 B11 | Remover `work_mode` do schema ou documentar como feature futura |
| 🔵 | `work_hours` no `config.json` não documentado na spec — alinhar |
| 🔵 | Insights retornam `model: "rule-based"` — integrar Anthropic API ou documentar |
| 🔵 | Divergência de schema: `sessions_today` e `updated_at` computados vs spec |
| 🔵 | Implementar Fase 5 completa — F5.1 → F5.5 |

### Pós-v0.2.0 (v0.3.0 — Git Bootstrap L1)

Implementar Fase 6 na ordem: F6.1 → F6.2 → F6.3 → F6.4 → F6.5 → F6.6 → F6.7 → F6.8 → verificação final → tag v0.3.0

---

## 8. Registro de mudanças na spec

| Data | Mudança | Impacto |
|------|---------|---------|
| 2026-05-10 | Instalação via Claude Code (`curl \| sh`) substituindo npm/VSIX | Fases 0 e 3 redesenhadas |
| 2026-05-10 | Binário standalone (Bun + PyInstaller) — zero pré-requisitos | Nova Fase 0 adicionada |
| 2026-05-10 | Extensão VSIX removida — integração VS Code via Continue.dev | Fase 4 simplificada |
| 2026-05-10 | Timing de atualização definido: cálculo no Stop, leitura do SQLite | F1.31–F1.34 e F2.33–F2.37 adicionados |
| 2026-05-10 | `POST /process` responde 202 Accepted (processamento em background) | F2.33–F2.34 |
| 2026-05-10 | `GET /scores/current` nunca dispara processamento (< 50ms) | F2.35 |
| 2026-05-10 | Flag `--refresh` em `beheld view` para eventos órfãos | F3.12 |
| 2026-05-10 | `/beheld` global: registro em `~/.claude/settings.json` evita prompt de confirmação por projeto | F1.42–F1.48, F3.6–F3.7 |
| 2026-05-10 | Todas as fases 0–4 implementadas — produto em estado funcional | Status geral atualizado |
| 2026-05-10 | Registro MCP corrigido de `type: http` para `type: stdio` em `~/.claude.json` | Elimina prompt de confirmação por projeto |
| 2026-05-10 | `migrateProjectScopedRegistrations()` implementada | F1.43 |
| 2026-05-10 | Guarda de segurança contra escrita no CWD em `installClaudeCodeHooks()` | F1.45 |
| 2026-05-10 | `scripts/test-global-scope.sh` adicionado | 5/7 automáticos, 2 manuais |
| 2026-05-10 | Eventos órfãos: `unprocessed_events` em `/status`, aviso no `view`, flag `--refresh` com polling 30s | F3.12 — 11/11 checks |
| 2026-05-10 | D2 resolvido: fallback `source: "cache"` via `bun:sqlite` | 10/10 — 39 testes |
| 2026-05-10 | D4 resolvido: mínimo 3 sessões | 11/11 — 45 testes |
| 2026-05-10 | D3 resolvido: Stop fire-and-forget 3s | 9/9 — 120 testes |
| 2026-05-10 | B1 corrigido: detecção de daemons em execução via `/health` antes de spawnar | 8/8 — 52 testes |
| 2026-05-11 | B2 corrigido: protocolo MCP stdio via `StdioServerTransport` | 11/11 — 11 testes |
| 2026-05-11 | B4 corrigido: `sanitizeMetadata()` — paths substituídos por `[path:<8-char-hash>]` | 7/7 — 134 testes |
| 2026-05-11 | B5 corrigido: `mode: 0o700` em todos os `mkdirSync` | 7/7 — 59 testes |
| 2026-05-11 | B6 corrigido: LaunchAgent/systemd usam `beheld start` | 6/6 — 63 testes |
| 2026-05-11 | B7 corrigido: warnings redirecionados para `stderr` quando `--json` ou `--scores-only` | stdout limpo |
| 2026-05-11 | B8 corrigido: testes atualizados para `args: ["server", "--stdio"]` | 69/69 testes CLI |
| 2026-05-11 | Verificação pré-release v0.1.0 — 352/352 testes · 8/8 bugs · 10/10 endpoints · **APROVADO** | — |
| 2026-05-11 | B12 corrigido: `installClaudeSlashCommand()` sobrescreve arquivo vazio | 6/7 — 69 testes |
| 2026-05-14 | Fase 6 (Git Bootstrap L1) especificada — F6.1 → F6.8 + verificação final | v0.3.0 planejado |
| 2026-05-24 | Documento mestre criado — unificação de estratégia, fases e backlog | — |
| 2026-06-06 | **Configuração e ambientes — Etapa B executada** | Ver seção dedicada abaixo |

---

## Configuração e ambientes

Adicionado em 2026-06-06 após a Etapa A (inventário read-only — ver
[analise-ambientes.md](analise-ambientes.md)) e Etapa B (parametrização,
7 commits).

### Modelo

Uma única variável controla para qual backend remoto a CLI aponta:

| `BEHELD_ENV` | API Rails | Portal | Rekor | Quando usar |
|---|---|---|---|---|
| `production` (default) | `https://beheld.dev` | `https://beheld.dev` | `https://rekor.sigstore.dev` | Distribuição via `curl \| sh` — usuários reais |
| `development` | `http://localhost:3000` | `http://localhost:3000` | `https://rekor.sigstage.dev` | Dev local com Rails dockerizado |

**Default `production` é deliberado:** a CLI roda sem nenhuma config em
máquinas de devs externos e precisa apontar a infra real desde o boot.

### Precedência

```
override individual (BEHELD_API_URL / BEHELD_PORTAL_URL / BEHELD_REKOR_URL)
    >
BEHELD_ENV
    >
default 'production'
```

Overrides individuais existem para casos de teste e staging pontuais
(ex.: `BEHELD_API_URL=http://localhost:9999`). Todos os tests do projeto
que setam essas vars continuam funcionando.

### Módulos centrais

- TS: [packages/cli/src/config/env.ts](../packages/cli/src/config/env.ts) — `getEnv()`, `getApiBaseUrl()`, `getPortalUrl()`, `getRekorUrl()`, `getApiUrl()`
- MCP server: [packages/mcp-server/src/config/env.ts](../packages/mcp-server/src/config/env.ts) — espelho enxuto, mesma semântica
- Python: [packages/engine/src/config.py](../packages/engine/src/config.py) — análogo + `get_ollama_url()`

Todos os call-sites antes hardcoded ou com defaults divergentes
(`update.ts:8`, `mcp-server/notifications.ts:143`, `attest.ts:29`,
`delete.ts:26`, `install/counter.ts:33`, `share.ts:15`, `auth.ts:22`,
`lib/rekor.ts:40`, `ui/snapshot-html.ts:539,1112`, `snapshot.ts:429`)
passam a ler dos módulos centrais.

### Constantes locais (NÃO são config de ambiente)

| Valor | Onde | Por quê |
|---|---|---|
| MCP server port `7337` | `packages/mcp-server/src/server.ts` (`BEHELD_PORT` override existe) | local sempre — porta da máquina do dev |
| Engine port `7338` | `packages/cli/src/client/engine-client.ts` etc. (`BEHELD_ENGINE_URL` override) | mesmo |
| Ollama port `11434` | `packages/engine/src/classifiers/project_type.py` (agora `BEHELD_OLLAMA_URL` override) | Ollama é sempre local |
| OAuth callback port `51823` | CLI flow | porta efêmera no browser |
| `~/.beheld/` | em ~20 arquivos (`BEHELD_DATA_DIR` override) | filesystem local |

### Face web

- Rails: `RAILS_ENV` (já existente) + `PORTAL_PUBLIC_URL` agora **obrigatória** (sem fallback). `.env.example` para dev e prod com placeholder.
- Vite (frontend): `VITE_API_URL` resolvido por `.env.development` (`http://localhost:3000`) vs `.env.production` (`/api` same-origin). Ambos versionados.
- Caddyfile (prod): `BEHELD_INSTALL_SCRIPT_URL` parametriza o redirect do `/install.sh`. Default mantém GitHub raw da `main`.

### O que NÃO foi feito

- Fallback de `DEVPROFILE_*` envs antigas: pulado. Grep confirmou zero hits em código vivo; só docs históricas tinham referências.
- Renomeação `PORTAL_PUBLIC_URL` → `BEHELD_PORTAL_PUBLIC_URL`: descartado para evitar churn em `/etc/beheld/app.env` na VPS.
- Renomeação `VITE_API_URL` → `VITE_API_BASE_URL`: descartado, mesma razão.
- Dashboard (TanStack Start + Cloudflare Workers): env resolution pendente — sem reads diretos no código fonte, depende de investigação adicional.

### Commits da Etapa B

```
feat(cli): resolucao de ambiente via BEHELD_ENV          (B1+B2)
feat(engine): config por ambiente no scoring engine      (B3)
refactor(web): PORTAL_PUBLIC_URL obrigatorio              (B4)
refactor(web): VITE_API_URL via .env por ambiente         (B5)
refactor(env): remove residuos devprofile + delete legacy (B6)
chore(deploy): parametriza install URL no Caddyfile       (B7)
docs: padroniza comandos beheld nas specs vivas           (B8)
```

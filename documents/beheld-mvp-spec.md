# Beheld — Especificação do MVP

> Documento de referência para implementação. Cada fase é independente e entrega valor incremental.
> Stack: TypeScript/Bun (MCP server + CLI) · Python/PyInstaller (scoring engine) · SQLite (storage local)
>
> **v2:** instalação via Claude Code, binário standalone zero pré-requisitos, slash command `/beheld` substituindo extensão VSIX separada.

---

## Visão geral das fases

| Fase | Componente | Duração | Dependências |
|------|-----------|---------|-------------|
| 0 | Build & release pipeline | 1–2 dias | nenhuma |
| 1 | MCP server TypeScript | 2–3 dias | Fase 0 |
| 2 | Scoring engine Python | 3–4 dias | Fase 1 (JSONL) |
| 3 | CLI + instalação via Claude | 2 dias | Fases 0, 1 e 2 |
| 4 | Integração VS Code via MCP | 2–3 dias | Fases 1, 2 e 3 |

---

## Experiência de instalação

O Beheld é instalado diretamente pelo Claude Code. Não há npm, não há extensão VSIX, não há pré-requisitos.

### Fluxo completo do usuário

```
Usuário: "instale o beheld para mim"

Claude:  Vou instalar o Beheld agora. Ele roda em segundo plano e
         constrói seu perfil de desenvolvedor a partir do seu uso do Claude.
         Posso prosseguir?

Usuário: sim

Claude:  [executa: curl -fsSL https://beheld.dev/install | sh]
         [wizard de terminal abre automaticamente]
         [hooks configurados, daemon iniciado]

         Beheld instalado. Rodando em segundo plano.
         Digite /beheld a qualquer momento para ver seu perfil.
```

### Script de instalação (`install.sh`)

```bash
#!/usr/bin/env sh
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)          ARCH="x64" ;;
  arm64|aarch64)   ARCH="arm64" ;;
  *) echo "Arquitetura não suportada: $ARCH" && exit 1 ;;
esac

VERSION=$(curl -fsSL https://api.github.com/repos/beheld/beheld/releases/latest \
  | grep '"tag_name"' | cut -d'"' -f4)

URL="https://github.com/beheld/beheld/releases/download/${VERSION}/beheld-${OS}-${ARCH}"

echo "Baixando Beheld ${VERSION} para ${OS}-${ARCH}..."
curl -fsSL "$URL" -o ~/.local/bin/beheld
curl -fsSL "$URL.sha256" -o /tmp/beheld.sha256

echo "$(cat /tmp/beheld.sha256)  $HOME/.local/bin/beheld" | sha256sum -c -
chmod +x ~/.local/bin/beheld

~/.local/bin/beheld init
```

### Targets de distribuição

| Plataforma | Binário | Tamanho estimado |
|-----------|---------|-----------------|
| macOS Apple Silicon | `beheld-darwin-arm64` | ~45 MB |
| macOS Intel | `beheld-darwin-x64` | ~45 MB |
| Linux x64 | `beheld-linux-x64` | ~48 MB |
| Windows x64 | `beheld-windows-x64.exe` | v2 |

---

## Fase 0 — Build & Release Pipeline

**Objetivo:** Infraestrutura de build que compila MCP server + CLI (TypeScript via Bun) e scoring engine (Python via PyInstaller) em binários standalone por plataforma, assina e publica automaticamente no GitHub Releases.

**Duração estimada:** 1–2 dias  
**Ferramentas:** GitHub Actions · Bun · PyInstaller · GPG

> Esta fase deve existir antes de qualquer outra. Sem ela não há como distribuir o produto.

---

### 0.1 Estrutura do repositório

```
beheld/
├── packages/
│   ├── mcp-server/          # Fase 1 — TypeScript
│   ├── engine/              # Fase 2 — Python
│   └── cli/                 # Fase 3 — TypeScript
├── scripts/
│   ├── build.sh             # build local para desenvolvimento
│   └── install.sh           # script público de instalação
├── .github/
│   └── workflows/
│       ├── ci.yml           # testes em cada PR
│       └── release.yml      # build + publish ao criar tag
├── package.json             # workspace root (Bun workspaces)
└── README.md
```

> A Fase 4 (integração VS Code) não gera pacote separado — é implementada dentro do `mcp-server` como tool MCP adicional.

---

### 0.2 Features

#### F0.1 — Build do binário TypeScript com Bun

Bun compila MCP server + CLI em um único executável standalone por plataforma:

```bash
# Desenvolvimento local (host atual)
bun build ./packages/cli/src/index.ts --compile --outfile dist/beheld

# CI — cross-compilation para os 3 targets
bun build ./packages/cli/src/index.ts --compile --target=bun-darwin-arm64 --outfile dist/beheld-darwin-arm64
bun build ./packages/cli/src/index.ts --compile --target=bun-darwin-x64   --outfile dist/beheld-darwin-x64
bun build ./packages/cli/src/index.ts --compile --target=bun-linux-x64    --outfile dist/beheld-linux-x64
```

O binário TypeScript inclui: CLI, MCP server, cliente HTTP para o engine e todos os tipos compartilhados. Node.js não é necessário no host.

---

#### F0.2 — Build do binário Python com PyInstaller

O scoring engine Python é empacotado com seu runtime Python embarcado:

```bash
# packages/engine/build.sh
pyinstaller \
  --onefile \
  --name beheld-engine \
  --add-data "src/classifiers/prompts:classifiers/prompts" \
  src/main.py

# Output: dist/beheld-engine (~35 MB standalone)
```

O binário do engine é bundlado dentro do binário TypeScript principal como asset embutido. Na primeira execução, o CLI extrai o engine para `~/.beheld/bin/engine` e o executa a partir daí.

```typescript
// packages/cli/src/engine-extractor.ts
import engineBinary from "../assets/beheld-engine" with { type: "file" };

async function extractEngine(): Promise<string> {
  const dest = path.join(homeDir, ".beheld", "bin", "engine");
  if (!fs.existsSync(dest)) {
    await fs.copyFile(engineBinary, dest);
    await fs.chmod(dest, 0o755);
  }
  return dest;
}
```

---

#### F0.3 — GitHub Actions: CI (testes em cada PR)

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test-ts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun test

  test-python:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - run: pip install -e packages/engine[dev]
      - run: pytest packages/engine/tests
```

---

#### F0.4 — GitHub Actions: Release (build + publish ao criar tag)

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    tags: ["v*"]

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-latest, target: bun-darwin-arm64, name: beheld-darwin-arm64
          - os: macos-13,     target: bun-darwin-x64,   name: beheld-darwin-x64
          - os: ubuntu-latest,target: bun-linux-x64,    name: beheld-linux-x64

    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }

      - run: pip install pyinstaller && pip install -e packages/engine
      - run: cd packages/engine && pyinstaller --onefile src/main.py
      - run: cp packages/engine/dist/beheld-engine packages/cli/assets/

      - run: bun build packages/cli/src/index.ts --compile --target=${{ matrix.target }} --outfile dist/${{ matrix.name }}

      - run: sha256sum dist/${{ matrix.name }} > dist/${{ matrix.name }}.sha256
      - run: gpg --batch --yes --detach-sign dist/${{ matrix.name }}

      - uses: actions/upload-artifact@v4
        with: { name: ${{ matrix.name }}, path: dist/${{ matrix.name }}* }

  publish:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
      - uses: softprops/action-gh-release@v2
        with: { files: "**/*", generate_release_notes: true }
      - run: |
          sed -i "s/VERSION=.*/VERSION=${{ github.ref_name }}/" scripts/install.sh
          git commit -am "chore: bump install.sh to ${{ github.ref_name }}"
          git push
```

---

#### F0.5 — Versionamento e atualização

- Versão semântica: `vMAJOR.MINOR.PATCH`
- Binário verifica nova versão 1x por dia: `GET https://beheld.dev/api/version`
- Se nova versão disponível: avisa no `beheld status`, nunca atualiza sozinho
- `beheld update` baixa, verifica checksum e substitui o binário atual

---

### 0.3 Critérios de conclusão da Fase 0

- [ ] `bun build --compile` gera binário funcional localmente
- [ ] PyInstaller gera engine standalone sem Python no host
- [ ] Binário final executa `beheld --version` sem Node ou Python instalados
- [ ] CI passa em todo PR (testes TS + Python)
- [ ] Release pipeline publica 3 binários + checksums ao criar tag
- [ ] `install.sh` baixa, verifica checksum e instala em macOS e Linux
- [ ] Checksum SHA256 validado antes de executar o binário

---

## Fase 1 — MCP Server TypeScript

**Objetivo:** Capturar eventos de sessões do Claude Code e do Continue.dev, gravar em JSONL local e expor API HTTP interna para as demais fases.

**Duração estimada:** 2–3 dias  
**Linguagem:** TypeScript (compilado com Bun — sem Node.js no host)  
**Porta local:** `7337`  
**Output:** `~/.beheld/sessions/YYYY-MM-DD_<uuid>.jsonl`

---

### 1.1 Estrutura do pacote

```
packages/mcp-server/
├── src/
│   ├── server.ts          # entrada principal — MCP + HTTP
│   ├── hooks/
│   │   ├── claude-code.ts # handler de hooks do Claude Code
│   │   └── continue.ts    # handler de eventos do Continue.dev
│   ├── tools/
│   │   ├── beheld-tool.ts   # tool "/beheld" para Claude Code
│   │   └── status-tool.ts       # tool de status para Continue.dev (Fase 4)
│   ├── writers/
│   │   └── jsonl.ts       # gravação e rotação de arquivos JSONL
│   ├── sanitizer.ts       # remove conteúdo sensível antes de gravar
│   └── types.ts           # interfaces compartilhadas
└── package.json
```

---

### 1.2 Features

#### F1.1 — Registro como MCP server no Claude Code

Configurado automaticamente pelo `beheld init`:

```json
// ~/.claude/settings.json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{ "type": "command", "command": "curl -s -X POST http://localhost:7337/hook/pre-tool -d @-" }]
    }],
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{ "type": "command", "command": "curl -s -X POST http://localhost:7337/hook/post-tool -d @-" }]
    }],
    "Stop": [{
      "hooks": [{ "type": "command", "command": "curl -s -X POST http://localhost:7337/hook/stop -d @-" }]
    }]
  }
}
```

**Campos capturados por hook:**

| Hook | Campos capturados |
|------|------------------|
| `PreToolUse` | `tool_name`, `tool_input`, `session_id`, `timestamp` |
| `PostToolUse` | `tool_name`, `tool_response` (sanitizado), `duration_ms`, `session_id` |
| `Stop` | `session_id`, `timestamp`, `total_turns` |

---

#### F1.2 — Listener de eventos do Continue.dev

```json
// ~/.continue/config.json — adicionado pelo beheld init
{
  "mcpServers": [{
    "name": "beheld",
    "transport": { "type": "http", "url": "http://localhost:7337/mcp" }
  }]
}
```

| Evento | Campos capturados |
|--------|------------------|
| `chat.request` | `prompt_length`, `has_code_context`, `file_extension`, `timestamp` |
| `chat.response` | `response_length`, `duration_ms`, `model` |
| `edit.apply` | `file_extension`, `lines_changed`, `timestamp` |
| `command.run` | `command` (sanitizado), `exit_code`, `duration_ms` |

---

#### F1.3 — Sanitizador de conteúdo

Aplicado em **todos** os eventos antes da gravação:

```typescript
// src/sanitizer.ts
const REDACT_PATTERNS = [
  /[A-Z_]{3,}=["']?[a-zA-Z0-9+/=_\-]{8,}["']?/g,  // env vars com valor
  /sk-[a-zA-Z0-9]{32,}/g,                            // API keys Anthropic
  /ghp_[a-zA-Z0-9]{36}/g,                            // GitHub tokens
  /Bearer\s+[a-zA-Z0-9\-._~+/]+=*/g,                 // Bearer tokens
  /password["']?\s*[:=]\s*["']?[^\s"']+/gi,           // passwords
];
```

Remove: conteúdo de arquivos, env vars com valor, texto livre de prompts e respostas, paths absolutos (substituídos por hash do projeto).

---

#### F1.4 — Gravação JSONL com rotação diária

- Um arquivo por dia: `~/.beheld/sessions/2026-05-10_abc123.jsonl`
- Append-only — cada linha é um evento JSON independente
- Rotação automática à meia-noite e ao atingir 50 MB
- Índice em `~/.beheld/sessions/index.json`

```typescript
interface BeheldEvent {
  event_id: string;           // uuid v4
  session_id: string;
  source: "claude-code" | "continue-vscode";
  event_type: string;
  timestamp: string;          // ISO 8601
  duration_ms?: number;
  tool_name?: string;
  file_extension?: string;
  command_sanitized?: string;
  prompt_length?: number;
  has_test_context?: boolean;
  cwd_hash?: string;          // hash do projeto sem revelar o path
  metadata: Record<string, unknown>;
}
```

---

#### F1.5 — HTTP API interna (localhost:7337)

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/hook/pre-tool` | POST | Hook PreToolUse do Claude Code |
| `/hook/post-tool` | POST | Hook PostToolUse do Claude Code |
| `/hook/stop` | POST | Hook Stop do Claude Code |
| `/mcp` | POST | Endpoint MCP para Continue.dev |
| `/status` | GET | Status do daemon e sessão ativa |
| `/session/current` | GET | Métricas da sessão em andamento |
| `/health` | GET | Health check |

---

#### F1.6 — Daemon e autostart

- PID em `~/.beheld/daemon.pid`
- Autostart configurado pelo `beheld init`:
  - **macOS:** LaunchAgent em `~/Library/LaunchAgents/com.beheld.daemon.plist`
  - **Linux:** systemd user service em `~/.config/systemd/user/beheld.service`
- Log em `~/.beheld/daemon.log` com rotação em 10 MB

---

### 1.3 Critérios de conclusão da Fase 1

- [ ] Daemon sobe e responde em `localhost:7337/health`
- [ ] Hook registrado em `~/.claude/settings.json`
- [ ] Continue.dev apontando para o MCP server
- [ ] Eventos gravados em JSONL após sessão real no Claude Code
- [ ] Sanitizador bloqueando secrets em testes unitários
- [ ] Rotação de arquivo funcionando
- [ ] Daemon reinicia automaticamente após reboot

---

## Fase 2 — Scoring Engine Python

**Objetivo:** Ler os JSONL da Fase 1, extrair padrões técnicos, classificar tipo de projeto, calcular scores e persistir em SQLite local.

**Duração estimada:** 3–4 dias  
**Linguagem:** Python 3.11+ (distribuído como binário via PyInstaller — sem Python no host)  
**Porta local:** `7338`  
**Storage:** `~/.beheld/profile.db` (SQLite)

---

### 2.1 Estrutura do pacote

```
packages/engine/
├── src/
│   ├── main.py              # FastAPI + scheduler
│   ├── reader/
│   │   └── jsonl_reader.py
│   ├── extractors/
│   │   ├── commands.py      # padrões de comandos bash
│   │   ├── files.py         # extensões e paths
│   │   ├── tools.py         # ferramentas MCP e sequência de workflow
│   │   └── timing.py        # horário e duração
│   ├── classifiers/
│   │   ├── project_type.py  # tipo de projeto sem tema de negócio
│   │   ├── platform.py      # plataformas e ambiente
│   │   └── workflow.py      # TDD, refactor, debug-driven
│   ├── scorers/
│   │   ├── prompt_quality.py
│   │   ├── test_maturity.py
│   │   ├── tech_breadth.py
│   │   └── growth_rate.py
│   ├── storage/
│   │   └── sqlite.py
│   └── api.py               # FastAPI endpoints
├── pyproject.toml
└── build.sh
```

---

### 2.2 Features

#### F2.1 — Leitor incremental de JSONL

- Cursor de posição em `~/.beheld/.cursor` — processa apenas eventos novos
- Agrupa eventos por `session_id`
- Linhas corrompidas são ignoradas sem falhar

```python
@dataclass
class Session:
    session_id: str
    source: str
    started_at: datetime
    ended_at: datetime | None
    duration_minutes: float
    events: list[BeheldEvent]
    tools_used: list[str]
    file_extensions: Counter[str]
    commands: list[str]
    cwd_hash: str
    total_turns: int
    has_test_context: bool
```

---

#### F2.2 — Extratores de padrões técnicos

**Plataformas (por comandos bash):**

```python
PLATFORM_SIGNALS: dict[str, list[str]] = {
    "docker":      ["docker", "docker-compose", "podman"],
    "github":      ["gh ", "git push", "git pull", "git commit"],
    "cloud_infra": ["aws ", "gcloud", "az ", "terraform", "kubectl"],
    "ci_cd":       ["gh workflow", "act ", "circleci"],
    "database":    ["psql", "mysql", "redis-cli", "prisma migrate", "rails db"],
    "testing":     ["rspec", "jest", "pytest", "playwright", "vitest"],
    "mobile":      ["flutter", "pod install", "gradle", "xcodebuild"],
    "blockchain":  ["hardhat", "foundry", "truffle", "anchor"],
}
```

**Workflow (por sequência de tools MCP):**

| Padrão | Sequência observada |
|--------|---------------------|
| TDD | `read_file`(test) → `write_file`(test) → `bash`(run) → `write_file`(impl) |
| Test-after | `write_file`(impl) → `write_file`(test) → `bash`(run test) |
| Debug-driven | `bash`(run) → `read_file` → `str_replace` → `bash`(run) |
| Refactor | múltiplos `str_replace` no mesmo arquivo sem novo `write_file` |
| Exploratório | muitos `read_file`, poucos `write_file` |

---

#### F2.3 — Classificador de tipo de projeto

```python
PROJECT_CATEGORIES = [
    "saas_b2b",        "api_backend",     "financial_data",
    "mobile",          "web3_blockchain", "automation_ai",
    "library_sdk",     "cli_tool",
]
```

Pipeline: sinais técnicos → prompt restritivo → sanitização do output → categoria. Confiança < 0.6 → `"unknown"`.

---

#### F2.4 — Scores (4 dimensões, 0–100)

**Prompt Quality**

| Sinal | Peso |
|-------|------|
| `prompt_length` médio > 200 chars | +20 |
| `has_code_context = true` | +20 |
| Proporção de prompts com contexto de arquivo | +20 |
| Variedade de `tool_name` por sessão (> 4) | +15 |
| Sessões longas com muitas iterações | +15 |
| Uso de ferramentas avançadas | +10 |

**Test Maturity**

| Sinal | Peso |
|-------|------|
| % sessões com `has_test_context = true` | +35 |
| Padrão TDD detectado | +30 |
| Extensões de teste (`.spec.`, `.test.`, `_spec.rb`) | +20 |
| Comandos de teste em bash | +15 |

**Tech Breadth**

| Sinal | Peso |
|-------|------|
| Ecosystems distintos (máx. 6) | +40 |
| Plataformas distintas (máx. 5) | +30 |
| Linguagens distintas (máx. 4) | +20 |
| Ferramentas de infra (Docker, CI/CD, cloud) | +10 |

**Growth Rate** — compara últimos 30 dias com os 30 anteriores:

| Métrica | Peso |
|---------|------|
| Δ Prompt Quality | +30 |
| Δ % sessões com testes | +30 |
| Δ variedade de tools | +20 |
| Δ duração média de sessão | +10 |
| Novas plataformas ou ecosystems | +10 |

---

#### F2.5 — Schema SQLite

```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_minutes REAL,
    total_turns INTEGER,
    cwd_hash TEXT,
    project_category TEXT,
    project_confidence REAL,
    workflow_pattern TEXT,
    processed_at TEXT NOT NULL
);

CREATE TABLE technical_signals (
    session_id TEXT REFERENCES sessions(id),
    signal_type TEXT NOT NULL,
    signal_value TEXT NOT NULL,
    occurrences INTEGER DEFAULT 1
);

CREATE TABLE scores (
    date TEXT NOT NULL PRIMARY KEY,
    prompt_quality INTEGER,
    test_maturity INTEGER,
    tech_breadth INTEGER,
    growth_rate INTEGER,
    overall INTEGER,
    sessions_analyzed INTEGER
);

CREATE TABLE profile (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

---

#### F2.6 — HTTP API interna (localhost:7338)

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/process` | POST | Processa JSONL novos |
| `/scores/current` | GET | Scores atuais |
| `/scores/history` | GET | Histórico (últimos N dias) |
| `/profile/summary` | GET | Resumo do perfil |
| `/insights` | GET | Insights por IA (cache 24h) |
| `/export` | GET | Export JSON para sync web |
| `/health` | GET | Health check |

---

#### F2.7 — Geração de insights por IA

Payload enviado (nunca inclui conteúdo de conversas):

```python
insight_payload = {
    "scores": { "prompt_quality": 84, "test_maturity": 62, ... },
    "top_platforms": ["docker", "github", "vscode"],
    "top_ecosystems": ["rails", "react", "python"],
    "workflow_distribution": { "tdd": 0.23, "test-after": 0.39, ... },
    "project_categories": { "saas_b2b": 0.38, "api_backend": 0.24, ... },
    "sessions_last_30_days": 124,
    "growth_deltas": { "prompt_quality": +8, "test_maturity": +4, ... },
}
```

Modelo: `claude-sonnet-4-6`. Fallback: `qwen2.5-coder:14b` via Ollama (configurável). Cache de 24h no SQLite.

---

### 2.3 Critérios de conclusão da Fase 2

- [ ] Engine processa JSONL real e grava no SQLite
- [ ] 4 scores calculados e armazenados por dia
- [ ] Classificador retornando categoria sem dados de negócio
- [ ] Workflow detector identificando TDD em sessão de exemplo
- [ ] API respondendo em `localhost:7338/scores/current`
- [ ] Insights gerados com mínimo 10 sessões
- [ ] Testes unitários para cada scorer com fixtures reais
- [ ] Binário PyInstaller executa sem Python no host

---

## Fase 3 — CLI + Instalação via Claude

**Objetivo:** Interface de linha de comando e experiência de instalação zero-fricção via Claude Code. O CLI é o ponto de entrada de tudo — instala hooks, sobe daemon, exibe perfil e registra o slash command `/beheld`.

**Duração estimada:** 2 dias  
**Linguagem:** TypeScript (compilado com Bun — sem Node.js no host)  
**Distribuição:** binário standalone via `curl -fsSL https://beheld.dev/install | sh`

> **Mudança em relação à v1:** distribuição como npm package removida. Binário exclusivamente via GitHub Releases.

---

### 3.1 Estrutura do pacote

```
packages/cli/
├── src/
│   ├── index.ts             # entry point
│   ├── commands/
│   │   ├── init.ts          # wizard 4 telas
│   │   ├── start.ts         # inicia daemons
│   │   ├── stop.ts          # para daemons
│   │   ├── status.ts        # status e sessão atual
│   │   ├── view.ts          # perfil no terminal
│   │   ├── update.ts        # atualiza binário
│   │   └── delete.ts        # apaga dados
│   ├── ui/
│   │   ├── wizard.ts        # wizard interativo
│   │   ├── profile-view.ts  # renderização ANSI
│   │   └── spinner.ts
│   ├── engine-extractor.ts  # extrai binário Python embarcado
│   └── client/
│       ├── mcp-client.ts    # HTTP client 7337
│       └── engine-client.ts # HTTP client 7338
├── assets/
│   └── beheld-engine    # binário Python (gerado no build)
└── package.json
```

---

### 3.2 Features

#### F3.1 — Instalação via Claude Code

```
Usuário: instale o beheld para mim

Claude:  Vou instalar o Beheld. Roda silenciosamente e constrói
         seu perfil a partir do uso do Claude. Posso prosseguir?

Usuário: sim

Claude:  [executa curl -fsSL https://beheld.dev/install | sh]
```

Sem abrir browser, sem sair do Claude Code, sem pré-requisitos.

---

#### F3.2 — `beheld init` (wizard 4 telas)

Executado automaticamente pelo `install.sh`. Máximo 2 minutos.

**Tela 1 — O que é coletado** (leitura, sem input):
```
  Beheld — perfil silencioso do seu uso do Claude

  COLETADO                         NUNCA COLETADO
  ✓ Comandos bash executados       ✗ Texto das conversas
  ✓ Nomes e extensões de arquivo   ✗ Conteúdo de arquivos
  ✓ Ferramentas MCP utilizadas     ✗ Secrets e env vars
  ✓ Timestamps e durações          ✗ Dados de negócio

  [Enter para continuar]
```

**Tela 2 — Opt-in granular:**
```
  Quais dimensões ativar?

  ◉ Qualidade de prompt
  ◉ Maturidade em testes
  ◉ Diversidade técnica
  ◯ Horário de trabalho  (opcional)
  ◯ Tipo de projeto      (opcional)

  [Espaço para toggle · Enter para confirmar]
```

**Tela 3 — Ambientes detectados:**
```
  Ambientes encontrados:

  ✓ Claude Code  (~/.claude/settings.json)
  ✓ Continue.dev (~/.continue/config.json)

  Configurar ambos? (S/n)
```

**Tela 4 — Configurando** (progresso em tempo real):
```
  ✓ Hooks instalados no Claude Code
  ✓ MCP server registrado no Continue.dev
  ✓ Engine extraído (~/.beheld/bin/engine)
  ✓ Daemon iniciado (localhost:7337, 7338)
  ✓ Autostart configurado

  Pronto. Digite /beheld no Claude Code para ver seu perfil.
```

---

#### F3.3 — Slash command `/beheld` no Claude Code

Registrado como MCP tool pelo `beheld init`. Disponível como `/beheld` no Claude Code sem nenhuma configuração adicional.

```typescript
// packages/mcp-server/src/tools/beheld-tool.ts
export const beheldTool = {
  name: "beheld",
  description: "Exibe o perfil de desenvolvedor baseado no uso do Claude",
  inputSchema: {
    type: "object",
    properties: {
      view: { type: "string", enum: ["summary", "scores", "insights", "full"] }
    }
  },
  async handler({ view = "summary" }) {
    const scores   = await engineClient.get("/scores/current");
    const profile  = await engineClient.get("/profile/summary");
    const insights = await engineClient.get("/insights");
    return formatProfileForClaude({ scores, profile, insights, view });
  }
};
```

Saída do `/beheld` na conversa:
```
Score geral: 78/100 · 847 sessões analisadas

Prompt quality  84  ████████░░
Test maturity   62  ██████░░░░
Tech breadth    91  █████████░
Growth rate     75  ███████░░░

Padrões: docker · rails · react · rspec · playwright
Projetos: saas-b2b (38%) · api-backend (24%)

→ Top 10% em qualidade de prompt
→ TDD em apenas 23% das sessões — oportunidade
→ Tech breadth +12 pts nos últimos 60 dias
```

---

#### F3.4 — `beheld view`

```
$ beheld view

  Beheld · 847 sessões · atualizado há 2h

  SCORE GERAL     78/100   ████████░░  (+14 vs mês anterior)

  Prompt quality  84/100   ████████░░
  Test maturity   62/100   ██████░░░░
  Tech breadth    91/100   █████████░
  Growth rate     75/100   ███████░░░

  Plataformas    docker · github · vscode · postgresql
  Ecosystems     rails · react · python · flutter
  Workflow       test-after (39%) · debug-driven (31%) · tdd (23%)
  Projetos       saas-b2b (38%) · api-backend (24%) · financeiro (18%)

  → Top 10% em qualidade de prompt
  → Oportunidade: TDD em apenas 23% das sessões
  → Tech breadth cresceu 12 pts nos últimos 60 dias
```

Flags: `--json` · `--scores-only` · `--since <days>` · `--dimension <name>`

---

#### F3.5 — `beheld start` / `stop` / `status`

```bash
beheld start    # sobe MCP server (7337) + engine (7338)
beheld stop     # para ambos gracefully
beheld restart
beheld status
```

```
$ beheld status

  MCP server      ● running  (pid 12345, port 7337)
  Scoring engine  ● running  (pid 12346, port 7338)

  Sessão atual    47 min · 83 eventos · debug-driven
  Coleta hoje     3 sessões · 241 eventos · score há 12 min
```

---

#### F3.6 — `beheld update`

```bash
beheld update
```

```
  Beheld v0.3.1 disponível (atual: v0.2.4)
  Baixando beheld-darwin-arm64... ✓
  Verificando checksum... ✓
  Substituindo binário... ✓
  Reiniciando daemon... ✓
  Atualizado para v0.3.1
```

---

#### F3.7 — `beheld delete`

```bash
beheld delete --local   # apaga ~/.beheld/
beheld delete --remote  # apaga conta e dados na plataforma web
beheld delete --all     # local + remoto + remove hooks
```

Confirmação obrigatória:
```
  Isso apagará 847 sessões (90 dias). Não pode ser desfeito.
  Digite "apagar tudo" para confirmar:
```

---

### 3.3 Critérios de conclusão da Fase 3

- [ ] `curl -fsSL https://beheld.dev/install | sh` instala e configura tudo
- [ ] Wizard completa em menos de 2 minutos sem erro
- [ ] `/beheld` disponível no Claude Code após `beheld init`
- [ ] `beheld view` renderiza dados reais do SQLite
- [ ] `beheld start/stop/status` gerencia processos corretamente
- [ ] `beheld update` substitui binário sem perder dados
- [ ] `beheld delete --all` remove hooks e dados sem rastro
- [ ] Binário funciona sem Node.js, Python ou npm instalados
- [ ] Funciona offline após instalação

---

## Fase 4 — Integração VS Code via MCP

**Objetivo:** Presença discreta no VS Code via Continue.dev — sem extensão VSIX separada. A integração usa o MCP server já em execução desde a Fase 1.

**Duração estimada:** 2–3 dias  
**Linguagem:** TypeScript (dentro do pacote `mcp-server`)  
**Distribuição:** zero — já incluída no binário standalone

> **Mudança em relação à v1:** extensão VSIX separada removida. Sem VS Code Marketplace. Integração via Continue.dev (já configurado na Fase 1) e notificações nativas do SO.

---

### 4.1 Features

#### F4.1 — Score na sidebar do Continue.dev

O Continue.dev exibe o score atual via tool MCP `beheld_status`:

```typescript
// packages/mcp-server/src/tools/status-tool.ts
export const statusTool = {
  name: "beheld_status",
  description: "Status atual do Beheld para exibição na sidebar",
  inputSchema: { type: "object", properties: {} },
  async handler() {
    const scores = await fetch("http://localhost:7338/scores/current").then(r => r.json());
    return {
      score: scores.overall,
      sessions_today: scores.sessions_today,
      last_updated: scores.updated_at,
      top_insight: scores.top_insight,
    };
  }
};
```

---

#### F4.2 — Slash commands no Continue.dev

Disponíveis automaticamente após `beheld init`:

```
/beheld           → resumo do perfil
/beheld scores    → apenas os 4 scores
/beheld insight   → próximo passo recomendado
```

---

#### F4.3 — Notificações nativas do SO

Enviadas pelo daemon, máximo 1 por dia, em dois momentos:

| Evento | Notificação |
|--------|------------|
| Score atualizado (1x/dia) | `Beheld: score 78 → 82 (+4 hoje)` |
| Nova versão disponível | `Beheld v0.3.1 — beheld update` |

macOS: `osascript -e 'display notification ...'`  
Linux: `notify-send ...`

Desativável em `~/.beheld/config.json`.

---

### 4.3 Critérios de conclusão da Fase 4

- [ ] Score visível na sidebar do Continue.dev sem configuração adicional
- [ ] `/beheld` funciona no chat do Continue.dev
- [ ] Notificação de sistema enviada ao fim do dia com score atualizado
- [ ] Nenhuma instalação adicional além do `beheld init`
- [ ] Testado no VS Code 1.85+ com Continue.dev v0.9+

---

## Considerações transversais

### Segurança e privacidade

- Nenhuma chamada de rede para fora de `localhost` sem opt-in explícito
- Sanitizador ativo em todas as entradas antes de qualquer gravação
- `~/.beheld/` com permissão `700`
- Binário assinado com GPG — checksum verificado antes da execução
- Sem telemetria do Beheld sem consentimento separado

### Estratégia de testes

| Fase | Estratégia |
|------|-----------|
| Fase 0 | Smoke test: `beheld --version` no binário gerado |
| Fase 1 | Bun test + fixtures de hooks reais do Claude Code |
| Fase 2 | pytest + fixtures JSONL da Fase 1 |
| Fase 3 | Integração CLI com daemons mockados |
| Fase 4 | Testes manuais no VS Code + Continue.dev |

### Estrutura final do repositório

```
beheld/
├── packages/
│   ├── mcp-server/   # Fases 1 e 4 — TypeScript (Bun)
│   ├── engine/       # Fase 2 — Python (PyInstaller)
│   └── cli/          # Fase 3 — TypeScript (Bun)
├── scripts/
│   ├── build.sh
│   └── install.sh
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── release.yml
├── package.json      # Bun workspaces
└── README.md
```

### Sequência de desenvolvimento

```
Fase 0 → binário compila e instala via curl
Fase 1 → JSONL sendo gravado em sessões reais
Fase 2 → scores calculados e no SQLite
Fase 3 → /beheld funciona no Claude Code
Fase 4 → score visível no VS Code via Continue.dev
```

Cada fase é demonstrável de forma independente antes da próxima começar.
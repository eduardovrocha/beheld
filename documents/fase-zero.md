# Fase 0 — Build & Release Pipeline

> Implementação concluída em 2026-05-10. Commit: `79525c8`.

---

## Objetivo

Estabelecer a infraestrutura de build antes de qualquer outra fase. Sem ela não há como compilar, distribuir ou testar o produto de ponta a ponta.

---

## O que foi criado

### Estrutura do monorepo

```
beheld/
├── packages/
│   ├── mcp-server/          # TypeScript — tipos e sanitizador
│   ├── cli/                 # TypeScript — entry point compilável
│   └── engine/              # Python — FastAPI stub
├── scripts/
│   ├── build.sh             # build local (engine + CLI)
│   └── install.sh           # script público de instalação
├── .github/workflows/
│   ├── ci.yml               # testes em cada PR/push
│   └── release.yml          # build + publish ao criar tag vX.Y.Z
└── package.json             # Bun workspaces
```

Bun workspaces une os três pacotes TypeScript. Python não participa do workspace — gerenciado pelo `pyproject.toml` próprio.

---

## Pacotes

### `packages/mcp-server`

Contém dois arquivos de produção usados pelas fases seguintes:

**`src/types.ts`** — interface `BeheldEvent` e tipos auxiliares. Define o contrato de dados que percorre todo o sistema: o que o MCP server grava, o que o engine lê, o que o CLI exibe.

**`src/sanitizer.ts`** — redação de dados sensíveis antes de qualquer gravação. Cinco padrões de redação:

| Padrão | Alvo |
|--------|------|
| `[A-Z_]{3,}=(?<q>["']?)...\k<q>` | Env vars com valor (`DATABASE_URL=...`) |
| `sk-[a-zA-Z0-9\-]{32,}` | API keys Anthropic |
| `ghp_[a-zA-Z0-9]{36}` | GitHub personal access tokens |
| `Bearer\s+...` | Bearer tokens (JWT, OAuth) |
| `password[...]=...` | Passwords em qualquer formato |

A env var usa backreference (`\k<q>`) para que a aspa de fechamento case com a de abertura — evita consumir a `"` estrutural do JSON e quebrar o parse.

Funções exportadas:
- `sanitize(string): string` — aplica todos os padrões
- `sanitizeObject(obj): obj` — serializa → sanitize → parse
- `sanitizeCommand(cmd): string` — hash de paths absolutos + sanitize de secrets

**Testes:** 10 casos cobrindo cada padrão, objetos aninhados, hashing de paths e leak de secrets em comandos.

---

### `packages/cli`

Entry point do binário final. Compilado com `bun build --compile` em um executável standalone sem Node.js no host.

**`src/index.ts`** — parsing de args, roteamento de comandos, help. Nenhuma dependência externa. Os comandos (`init`, `start`, `stop`, etc.) existem no roteador mas retornam erro controlado — implementação completa nas Fases 1–3.

```
beheld --version  → beheld 0.1.0
beheld --help     → usage + lista de comandos
beheld <cmd>      → erro claro + sugestão de help
beheld unknown    → exit 1
```

**Testes:** 5 casos que fazem spawn do processo real (não mock) e verificam stdout, stderr e exit code.

---

### `packages/engine`

FastAPI stub compilável com PyInstaller. Três endpoints funcionais na Fase 0:

| Endpoint | Descrição |
|----------|-----------|
| `GET /health` | Status + versão |
| `GET /scores/current` | Estrutura dos 4 scores (zeros por enquanto) |
| `POST /process` | Aceita requisição, retorna `{status: "ok"}` |

O argumento `--version` funciona no binário compilado via `argparse`. O servidor sobe em `127.0.0.1:7338` por padrão.

**Testes:** 5 casos via `TestClient` do FastAPI cobrindo health, versão, estrutura dos scores e endpoint de processamento.

---

## Scripts

### `scripts/build.sh`

Build local para desenvolvimento. Sequência:

1. Verifica se PyInstaller está disponível — avisa e continua sem engine se não estiver
2. Compila engine com `pyinstaller --onefile` → `packages/engine/dist/beheld-engine`
3. Copia engine binary para `packages/cli/assets/`
4. Compila CLI com `bun build --compile` → `dist/beheld`
5. Executa smoke test: `dist/beheld --version`

### `scripts/install.sh`

Script público invocado via `curl | sh`. Fluxo:

1. Detecta OS (`darwin`/`linux`) e arch (`x64`/`arm64`)
2. Busca última versão via GitHub API
3. Baixa binário + arquivo `.sha256`
4. Verifica checksum com `sha256sum` ou `shasum -a 256`
5. Abort com mensagem clara se checksum não bater
6. Move para `~/.local/bin/beheld` e executa `beheld init`

---

## CI/CD

### `ci.yml` — roda em todo push e PR

Três jobs paralelos:

| Job | Runner | O que faz |
|-----|--------|-----------|
| `test-ts` | ubuntu-latest | `bun install` + `bun test` |
| `test-python` | ubuntu-latest | `pip install -e packages/engine[dev]` + `pytest` |
| `build-check` | ubuntu-latest | `bun build --compile` + `dist/beheld --version` |

### `release.yml` — roda ao criar tag `v*`

Job `build` — matrix com 3 targets:

| Target | Runner | Binário |
|--------|--------|---------|
| `bun-darwin-arm64` | macos-latest | `beheld-darwin-arm64` |
| `bun-darwin-x64` | macos-13 | `beheld-darwin-x64` |
| `bun-linux-x64` | ubuntu-latest | `beheld-linux-x64` |

Cada runner:
1. Compila engine com PyInstaller
2. Copia engine para `packages/cli/assets/`
3. Compila CLI com `bun build --compile --target=<target>`
4. Gera `<binary>.sha256` com `sha256sum` / `shasum`
5. Assina com GPG se `secrets.GPG_PRIVATE_KEY` estiver configurado
6. Faz smoke test no binário nativo

Job `publish` — aguarda todos os builds, baixa artefatos e publica no GitHub Releases com `softprops/action-gh-release`. Release notes geradas automaticamente a partir dos commits.

---

## Decisões de implementação

**Backreference na regex de env var.** O padrão original da spec (`["']?...[a-zA-Z0-9...]{8,}["']?`) consumia a `"` de fechamento ao sanitizar JSON serializado, resultando em JSON inválido e `JSON.parse` falhando. Solução: named capture group `(?<q>["']?)` + backreference `\k<q>` — a aspa de fechamento só é consumida se uma de abertura equivalente foi capturada.

**Sem bundling do engine na Fase 0.** O CLI da Fase 0 não importa o binário Python como asset. Isso é implementado na Fase 3 (`engine-extractor.ts`). O `packages/cli/assets/` existe com `.gitkeep`; o `build.sh` o popula antes de compilar o CLI.

**Python 3.13 e `setuptools.build_meta`.** O ambiente usa Python 3.13 que não tem `setuptools.backends.legacy` disponível. Trocado para `setuptools.build_meta` que é o backend estável e amplamente suportado.

---

## Resultados verificados

```
bun test          → 10 pass, 0 fail (sanitizer + CLI)
pytest            → 5 passed in 0.40s (engine)
bun build         → dist/beheld (58 MB, macOS ARM64)
dist/beheld --version → beheld 0.1.0
pyinstaller       → dist/beheld-engine (30 MB, macOS ARM64)
./beheld-engine --version → beheld-engine 0.1.0
```

---

## Próxima fase

**Fase 1 — MCP Server TypeScript**

- Hooks do Claude Code (PreToolUse / PostToolUse / Stop) via HTTP
- Listener de eventos do Continue.dev via MCP
- Gravação JSONL com rotação diária (`~/.beheld/sessions/`)
- Daemon com autostart (LaunchAgent no macOS, systemd no Linux)
- HTTP API interna em `localhost:7337`

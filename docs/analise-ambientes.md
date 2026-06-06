# Análise de Ambientes — beheld

> **Etapa A — read-only.** Inventário de tudo que é ambiente-dependente no monorepo `beheld` (CLI/daemon + web layer). Documento gerado para gate de aprovação antes da Etapa B (parametrização). Não há código de produto alterado nesta etapa.
>
> **Fonte confirmada:** beheld (`/Users/eduardovrocha/Development/ioit.solutions/beheld`). Grep amplo NÃO retornou nenhuma referência a `andrequice.store`, `e-shop` ou `ioit.solutions/e-shop`. Documento isolado da fonte e-shop.

---

## 1. Resumo

O monorepo tem **duas faces** com naturezas de ambiente bem distintas e o trabalho de separação precisa respeitar isso:

- **Face 1 — CLI/daemon (local-first).** Roda na máquina do dev. "Ambiente" aqui significa **qual backend remoto a CLI consome**: produção (`beheld.dev` + `rekor.sigstore.dev`) vs local (`localhost:3000` + `rekor.sigstage.dev`). Portas locais 7337/7338/11434 e callback OAuth 51823 são **constantes locais**, não config de ambiente.
- **Face 2 — web layer (server-side).** Roda em Docker, dev e prod clássicos. Postgres em ambos. Já tem `docker-compose.yml` separado por `web/deploy/{development,production}/` e `env_file` apontando para `/etc/beheld/` em prod.

**Principais riscos encontrados (priorizados):**

1. **Defaults divergentes para `BEHELD_API_URL`** entre `cli/src/commands/delete.ts` (→ `beheld.dev`), `cli/src/commands/attest.ts` (→ `localhost:3000`) e `install/counter.ts` (→ `beheld.dev`). A mesma variável significa coisas diferentes em comandos diferentes.
2. **Dois endpoints `beheld.dev` hardcoded SEM override:** `cli/src/commands/update.ts:8` e `mcp-server/src/notifications.ts:143`. Impossível redirecionar para staging sem editar código.
3. **Resíduo `devprofile` no `.env` real de dev:** `web/deploy/development/.env:19-20` ainda tem `DB_NAME=devprofile_backend_development`. Provoca tabela vazia se um dev novo subir o stack.
4. **Compose duplicado e divergente:** `web/source/docker-compose.yml` (Postgres em container, credenciais hardcoded `beheld:beheld`) vs `web/deploy/development/docker-compose.yml` (Postgres na host, variáveis). O primeiro parece legacy mas continua presente.
5. **Resíduo extensivo em docs:** `docs/beheld-master.md` e `docs/beheld-fase{5,7}-prompts.md` ainda referem o CLI como `devprofile <comando>`. Não afeta runtime, mas confunde quem consulta a doc.

---

## 2. Topologia por face

| Componente | Path | Runtime | Porta | Datastore (dev) | Datastore (prod) | Onde roda |
|---|---|---|---|---|---|---|
| CLI (`beheld`) | `packages/cli/` | Bun TS compilado | — | SQLite local `~/.beheld/profile.db` | mesmo | máquina do dev |
| MCP server | `packages/mcp-server/` | Bun TS | `7337` | mesmo SQLite | mesmo | máquina do dev |
| Scoring engine | `packages/engine/` | Python FastAPI (PyInstaller) | `7338` | mesmo SQLite | mesmo | máquina do dev |
| Ollama (opcional) | externo | binário | `11434` | — | — | máquina do dev |
| OAuth callback browser | CLI in-process | HTTP efêmero | `51823` | — | — | máquina do dev |
| Backend Rails | `web/source/backend/` | Rails 7.2 + Puma | `3000` | **Postgres** na host (Docker compose dev) | **Postgres** native no VPS (`network_mode: host`) | container Docker |
| Frontend SPA | `web/source/frontend/` | React + Vite + Bun | `5173` (dev) / estático (prod) | — | — | container Docker (dev) / build estático servido por Caddy (prod) |
| Dashboard | `web/source/dashboard/` | TanStack Start + Cloudflare Workers (`wrangler`) | wrangler dev | — | Cloudflare Workers (presumido) | local dev / Cloudflare (deploy a confirmar) |
| Admin | `web/source/admin/` | **não existe ainda** | — | — | — | — |
| Caddy (reverse-proxy + TLS) | `web/deploy/production/Caddyfile` | `caddy:2-alpine` | `80/443` | — | — | container Docker no VPS (`45.225.129.168`) |
| Redis | externo (host) | nativo / container `web/source/docker-compose.yml` | `6379` | host (dev) | host (prod) | máquina do dev / VPS |

Observação: o Rails backend é **Postgres em todos os ambientes** (`database.yml` usa `adapter: postgresql` em dev/test/prod). O SQLite do projeto refere-se exclusivamente ao perfil local da CLI (`~/.beheld/profile.db`), não ao backend.

---

## 3. Inventário de valores ambiente-dependentes

Coluna **"injeção proposta"** distingue:
- **CONST-LOCAL** — valor que é constante na máquina local e NÃO muda por ambiente; manter literal.
- **`BEHELD_ENV`** — resolvido pelo módulo central via `BEHELD_ENV ∈ {production, local}`.
- **`BEHELD_<X>`** — override individual já existente (manter) ou a criar.
- **`VITE_<X>`** — env do Vite, build-time + runtime.
- **`ENV[…]` (Rails)** — env padrão do Rails (já em uso).

### 3.1 Face CLI / daemon

| valor | aparece em (arquivo:linha) | face | valor dev | valor prod | hoje está | injeção proposta |
|---|---|---|---|---|---|---|
| MCP server port | `packages/mcp-server/src/server.ts:142` | CLI | `7337` | `7337` | já parametrizado (`BEHELD_PORT`) com default `7337` | manter — `BEHELD_PORT` é **CONST-LOCAL** com override para testes |
| MCP URL (CLI → MCP) | `packages/cli/src/client/mcp-client.ts:3`, `lib/log-tail.ts:181` | CLI | `127.0.0.1:7337` | `127.0.0.1:7337` | parametrizado (`BEHELD_MCP_URL`) | manter — **CONST-LOCAL** |
| Engine URL (CLI/MCP → engine) | `packages/cli/src/client/engine-client.ts:27`, `commands/snapshot.ts:26`, `mcp-server/src/tools/{coach,status,beheld}-tool.ts`, `mcp-server/src/{engine-trigger,notifications,clients/engine-client}.ts`, `cli/src/commands/heal-engine.ts:70` | CLI | `127.0.0.1:7338` | `127.0.0.1:7338` | parametrizado (`BEHELD_ENGINE_URL`) | manter — **CONST-LOCAL** |
| Ollama URL | `packages/engine/src/classifiers/project_type.py:133` | CLI | `localhost:11434` | `localhost:11434` | **hardcoded sem override** | manter literal (Ollama é sempre local) — **CONST-LOCAL** — opcionalmente promover a `BEHELD_OLLAMA_URL` para testes |
| OAuth callback port (browser) | `docs/beheld-fase5-extensions-prompts.md:148` (não achei o código vivo da porta — confirmar em `auth.ts`/`identity.ts`) | CLI | `51823` | `51823` | hardcoded | manter — **CONST-LOCAL** |
| Backend attestation URL (default) | `packages/cli/src/commands/attest.ts:29` | CLI | `localhost:3000` | `beheld.dev` (mas o default literal é `localhost:3000`!) | parametrizado (`BEHELD_API_URL`), default **divergente** dos demais usos | resolver por `BEHELD_ENV`: prod→`https://beheld.dev`, local→`http://localhost:3000` |
| Portal/API URL (delete) | `packages/cli/src/commands/delete.ts:26` | CLI | `localhost:3000` | `https://beheld.dev` | parametrizado (`BEHELD_API_URL`), default `beheld.dev` | mesmo que acima |
| Portal/API URL (install counter) | `packages/cli/src/install/counter.ts:33,37` | CLI | `localhost:3000` | `https://beheld.dev` | parametrizado (`BEHELD_API_URL`), default `beheld.dev` | mesmo que acima |
| Portal URL (share/auth) | `packages/cli/src/bundle/share.ts:15,41`, `commands/auth.ts:22` | CLI | `localhost:3000` (?) | `https://beheld.dev` | parametrizado (`BEHELD_PORTAL_URL`), default `beheld.dev` | unificar com `BEHELD_API_URL` via `BEHELD_ENV` — ou manter as duas mas resolvidas pelo módulo central |
| Update API URL | `packages/cli/src/commands/update.ts:8` | CLI | n/a | `https://beheld.dev/api` | **hardcoded SEM override** | resolver via `BEHELD_ENV` no módulo central |
| Notifications/version URL | `packages/mcp-server/src/notifications.ts:143` | CLI | n/a | `https://beheld.dev/api/version` | **hardcoded SEM override** | resolver via `BEHELD_ENV` no módulo central |
| Rekor URL | `packages/cli/src/lib/rekor.ts:40,48` | CLI | `rekor.sigstage.dev` | `rekor.sigstore.dev` | parametrizado (`BEHELD_REKOR_URL`), default `sigstore.dev` | resolver default por `BEHELD_ENV` |
| Rekor URL renderizada em HTML do snapshot | `packages/cli/src/ui/snapshot-html.ts:539` | CLI | mesmo | mesmo | **hardcoded `rekor.sigstore.dev`** | usar a mesma constante do módulo central (importar de `rekor.ts`) |
| Snapshot identity schema `$id` | `packages/engine/src/identity/schema.py:33` | CLI | `https://beheld.dev/schemas/identity-signals.v1.json` | mesmo | hardcoded | manter (é apenas identificador do JSON Schema, não é fetched) — **CONST-LOGICA** |
| Strings de UI mencionando `beheld.dev` | `packages/cli/src/i18n/install.ts:20-21,91-92`, `ui/snapshot-html.ts:1112` (link `<a>`), `commands/snapshot.ts:429` (log) | CLI | mesmo | mesmo | hardcoded | manter no caso de strings UI (cosmético) — substituir por placeholder se for crítico em staging |
| Data dir | `packages/cli/src/{daemon-manager,supervisor/backoff,keys/{attestation-cache,keystore},storage/local-cache,lib/harness-installer}.ts`, `mcp-server/src/daemon.ts`, etc. (extensa lista — `BEHELD_DATA_DIR` aparece em ~20 arquivos) | CLI | default `~/.beheld` | mesmo | parametrizado (`BEHELD_DATA_DIR`) | manter — **CONST-LOCAL** com override para testes |
| Cache DB path | `packages/cli/src/storage/local-cache.ts:6`, `mcp-server/tests/*` | CLI | parametrizado (`BEHELD_CACHE_DB`) | mesmo | OK | manter — **CONST-LOCAL** |
| Desktop dir | `packages/cli/src/commands/snapshot.ts:121-122` | CLI | `BEHELD_NO_DESKTOP_COPY`, `BEHELD_DESKTOP_DIR` | mesmo | OK | manter — **CONST-LOCAL** |
| Telemetry opt-out | `packages/cli/src/install/counter.ts:82` | CLI | `BEHELD_NO_TELEMETRY` | mesmo | OK | manter |
| Nudge / force-nudge / home | `packages/cli/src/lib/nudge.ts:19,28` | CLI | `BEHELD_HOME`, `BEHELD_FORCE_NUDGE` | mesmo | OK | manter |
| ANTHROPIC_API_KEY (presença) | `packages/engine/src/{classifiers/project_type,insights}.py` | CLI | env usuário | env usuário | OK | manter — escopo do usuário |
| Rekor live test flag | `packages/cli/tests/rekor.test.ts:256` | testes | `REKOR_LIVE` | n/a | OK | manter — **TEST-ONLY** |
| `NO_COLOR` | `packages/cli/src/install/render.ts:24` | CLI | env usuário | env usuário | OK | manter |
| `SSH_AUTH_SOCK` (l1 git fetch via ssh) | `packages/engine/src/l1/auth_resolver.py:63,87` | CLI | env usuário | env usuário | OK | manter |

### 3.2 Face web — Rails backend

| valor | aparece em (arquivo:linha) | face | valor dev | valor prod | hoje está | injeção proposta |
|---|---|---|---|---|---|---|
| `SECRET_KEY_BASE` | Rails default | web | `.env`/`master.key` | `/etc/beheld/app.env` | OK | manter |
| `RAILS_MASTER_KEY` | `config/environments/production.rb:18` | web | n/a | env / `master.key` | OK | manter |
| `DATABASE_URL` | `config/database.yml:21` (produção, com fallback para DB_*) | web | (não usado em dev) | env | OK | manter |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` / `DB_NAME_TEST` | `config/database.yml` | web | `host.docker.internal:5432 postgres/postgres beheld_backend_development beheld_backend_test` | env | OK | manter |
| `REDIS_URL` | `config/environments/development.rb:24`, `config/cable.yml:9`, `app/services/oauth_state_store.rb:46`, `config/initializers/rack_attack.rb` | web | default `redis://localhost:6379/{0,1}` | env | OK | manter (consolidar default? ver §7) |
| `CORS_ORIGINS` | `web/deploy/development/docker-compose.yml:44`, `web/deploy/production/.env.example:33` | web | `*` | vazio (same-origin) | OK | manter |
| `GITHUB_OAUTH_CLIENT_ID` | `app/services/github_oauth.rb:15`, `spec/services/github_oauth_spec.rb`, `spec/requests/auth_github_spec.rb` | web | dev app (`Ov23liVeZQqKw2fLYsP8`) | prod app (`Ov23ligjSeBo4NfXzr7j`) | OK | manter — public, valor difere por ambiente |
| `GITHUB_OAUTH_CLIENT_SECRET` | mesmo | web | dev secret | prod secret | OK | manter — segredo |
| `BEHELD_PLATFORM_KEY_ID` | `app/services/platform_key_signer.rb:28`, specs | web | `beheld-platform-2026-q2-dev` | `beheld-platform-2026-q2` | OK | manter |
| `BEHELD_PLATFORM_PRIVATE_KEY` | mesmo | web | dev seed (base64) | prod seed (base64) | OK | manter — segredo |
| `PORTAL_PUBLIC_URL` (fallback hardcoded p/ `beheld.dev`) | `app/views/dashboard/index.html.erb:1`, `app/views/directory/index.html.erb:5`, `app/mailers/company_mailer.rb:27`, `app/controllers/api/v1/bundles_controller.rb:109` | web | env não setada → fallback `beheld.dev` ❌ (provoca link errado em emails de dev) | env opcional | hardcoded fallback `https://beheld.dev` em 4 lugares | exigir env em todos os ambientes; tornar `PORTAL_PUBLIC_URL` obrigatório (`BEHELD_PORTAL_PUBLIC_URL`?) ou padronizar fallback diferente em dev |
| `INSTALL_REGISTER_RATE_LIMIT` | `config/initializers/rack_attack.rb:17` | web | default `10/3600` | env | OK | manter |
| `PIDFILE` (Puma) | `config/puma.rb:34` | web | opcional | env | OK | manter |
| `RAILS_MAX_THREADS` | `config/database.yml` | web | default `5` | env | OK | manter |
| `RAILS_LOG_TO_STDOUT`, `RAILS_SERVE_STATIC_FILES`, `BINDING`, `PORT`, `RAILS_ENV` | `compose.yml`, `puma.rb`, etc. | web | dev compose | prod compose | OK | manter |
| Postgres URL hardcoded | `web/source/docker-compose.yml:36,56` | web | `postgres://beheld:beheld@postgres:5432/beheld_development` | n/a | **hardcoded** | decidir: deletar este compose legacy ou parametrizar (ver §7) |

### 3.3 Face web — Frontend / Vite

| valor | aparece em (arquivo:linha) | face | valor dev | valor prod | hoje está | injeção proposta |
|---|---|---|---|---|---|---|
| API base (browser → Rails) | `web/source/frontend/src/lib/api.ts:3,7` | web | `http://localhost:3000` (default) ou env `VITE_API_URL` | `/api` (same-origin via Caddy) | parametrizado (`VITE_API_URL`) | manter — usar `.env.development` / `.env.production` |
| Vite dev proxy target | `web/source/frontend/vite.config.ts:21` | web | `http://beheld-backend-dev:3000` (default no container) ou env `VITE_API_TARGET` | n/a (build estático em prod) | parametrizado (`VITE_API_TARGET`) | manter — `VITE_*` é build-time |
| Vite port | `web/source/frontend/vite.config.ts:13` | web | `5173` (strict) | n/a | hardcoded | manter — **CONST-LOCAL** |
| Compose passa `VITE_API_URL` para frontend | `web/deploy/development/docker-compose.yml:73` | web | derivado de `BACKEND_PORT` | n/a | OK | manter |

### 3.4 Face web — Dashboard (TanStack Start + Cloudflare Workers)

| valor | aparece em (arquivo:linha) | face | valor dev | valor prod | hoje está | injeção proposta |
|---|---|---|---|---|---|---|
| (env reads diretos) | `web/source/dashboard/` — nenhum `process.env.*` ou `import.meta.env.*` no grep | web | — | — | env injetadas pelo preset `@lovable.dev/vite-tanstack-config` (auto-injeta `VITE_*`) | a confirmar — ver §8 |
| wrangler `main` | `wrangler.jsonc` | web | local dev | Cloudflare Workers | OK | a confirmar deploy target |

### 3.5 Face web — Caddy / deploy de produção

| valor | aparece em (arquivo:linha) | face | valor dev | valor prod | hoje está | injeção proposta |
|---|---|---|---|---|---|---|
| Hostname principal | `web/deploy/production/Caddyfile:11` | web | n/a | `beheld.dev` | hardcoded | manter — é o Caddyfile DA produção (não deveria ter outro hostname) |
| Hostname install redirect | `web/deploy/production/Caddyfile:87` | web | n/a | `install.beheld.dev` | hardcoded | manter |
| GitHub raw URL (install script) | `web/deploy/production/Caddyfile:72,88` | web | n/a | `https://raw.githubusercontent.com/eduardovrocha/beheld/main/scripts/install.sh` | hardcoded — **user `eduardovrocha` exposto** | parametrizar via `{$BEHELD_INSTALL_SCRIPT_URL}` no Caddyfile (Caddy suporta env interpolation) ou aceitar — ver §7 |
| Backend backend de proxy | `web/deploy/production/Caddyfile:21-64` | web | n/a | `127.0.0.1:3000` | hardcoded | manter — é a porta nativa do Rails — **CONST-DEPLOY** |

---

## 4. Inventário de segredos

| Segredo | Onde vive hoje (dev / prod) | Como é lido | Risco | Onde deveria viver |
|---|---|---|---|---|
| `SECRET_KEY_BASE` (Rails) | dev: `.env` / `master.key` · prod: `/etc/beheld/app.env` | Rails | OK | mantido |
| `RAILS_MASTER_KEY` | dev: `config/master.key` · prod: env / `master.key` | Rails | OK | mantido |
| `BEHELD_PLATFORM_PRIVATE_KEY` (Ed25519 seed b64) | **dev: `web/deploy/development/.env` (populado com seed real `95Zhcp+nk/W5mutcZA7INjkTmbzUrnn5+frWmrFmcD4=`)** · prod: `/etc/beheld/app.env` | env | em dev, fica em disco em `.env` gitignored — risco apenas se o usuário commitar acidentalmente | mantido; verificar §7 sobre histórico git |
| `BEHELD_PLATFORM_KEY_ID` | dev: `.env` · prod: `/etc/beheld/app.env` | env | público | mantido |
| `GITHUB_OAUTH_CLIENT_SECRET` | **dev: `web/deploy/development/.env` (populado com `d09acb36a192d423dc1da77cc786eea8ee9ee643`)** · prod: `/etc/beheld/app.env` | env | igual ao de cima (gitignored) | mantido |
| `GITHUB_OAUTH_CLIENT_ID` | dev: `.env` · prod: `/etc/beheld/app.env` | env | público | mantido |
| `DB_PASSWORD` | dev: `.env` (`postgres`) · prod: `/etc/beheld/postgres.env` | env | OK | mantido |
| `ANTHROPIC_API_KEY` | env do usuário (engine Python lê via `os.environ`) | env | escopo do usuário | mantido |
| `GITHUB_TOKEN` | **não encontrei no código atual** (apenas mencionado na spec) | — | — | confirmar uso |
| `web/deploy/keys/beheld_deploy`, `vps-bootstrap.pem` | sistema de arquivos do dev | — | chaves SSH em `web/deploy/keys/`, gitignored pelo monorepo raiz (`web/` no `.gitignore`); o subrepo `web/` precisa confirmar que `deploy/keys/` está ignorado | local apenas |

**Verificação de gitignore (atual):**
- `web/.gitignore` ignora `.env`, `.env.local`, `.env.*.local`. ✅
- `web/source/frontend/.gitignore` ignora `.env`, `.env.*` exceto `.env.example`. ✅
- monorepo raiz ignora `web/` inteiro. ✅
- `web/source/backend/.gitignore` não existe; herda do `web/.gitignore`. ✅
- `web/deploy/keys/` **não** está explicitamente listado no `web/.gitignore` — confirmar §7.
- `git ls-files` em `web/` confirma que `deploy/development/.env` (com segredos) **NÃO é rastreado**. ✅

---

## 5. Resíduos `devprofile`

Categorizados por intenção:

### 5.1 Limpeza/migração intencional (✅ correto, MANTER)

- `packages/cli/src/lib/legacy-bridge.ts` (todo o arquivo) — bridge `~/.devprofile/` → `~/.beheld/`.
- `packages/cli/src/commands/bootstrap.ts:76-101` — wire da bridge.
- `packages/cli/src/commands/delete.ts:141-208,377-397` — limpeza de plist `com.devprofile.daemon.plist` (macOS) e `devprofile.service` (Linux).
- `packages/cli/src/index.ts:22` — texto de help mencionando a migração.
- `packages/cli/tests/{legacy-bridge,bootstrap,delete}.test.ts` — testes da bridge.
- `scripts/install.sh:97,116`, `scripts/reinstall.sh:14` — comentários sobre bridge.
- `README.md:60,109` — descrição da bridge.
- `CHANGELOG.md:77-78,117` — histórico de releases.
- `beheld-refundacao-status.md` — análise interna da bridge.
- `docs/releases/v0.4.0.md:59-65,164` — release notes.

### 5.2 Resíduos REAIS a remover (Etapa B)

| onde | linha | conteúdo atual | proposto |
|---|---|---|---|
| `web/deploy/development/.env` | 19 | `DB_NAME=devprofile_backend_development` | `DB_NAME=beheld_backend_development` |
| `web/deploy/development/.env` | 20 | `DB_NAME_TEST=devprofile_backend_test` | `DB_NAME_TEST=beheld_backend_test` |
| `web/deploy/development/Dockerfile.dev` | 2 | comentário `devprofile-backend Rails API` | `beheld-backend Rails API` |
| `web/deploy/development/Dockerfile.frontend.dev` | 2 | comentário `devprofile-frontend React SPA` | `beheld-frontend React SPA` |
| `web/deploy/production/.env.example` | 24 | comentário `"DevProfile Attestation"` (nome do OAuth app) | atualizar para "Beheld Attestation" se o app foi renomeado no GitHub, ou manter referenciando o nome real do app no `github.com/settings/developers` |
| `web/deploy/development/.env.example` | 31 (`devprofile.app/dev` etc.) | comentários ainda referenciando `DevProfile Attestation` como nome do OAuth app | mesmo |
| `web/deploy/development/generate-dev-platform-key.sh` | (não lido — confirmar conteúdo) | possíveis refs a `devprofile-platform-...` | a confirmar |

### 5.3 Docs com resíduo extensivo (cosmético — decidir prioridade)

`docs/beheld-master.md` (≈40 linhas), `docs/beheld-fase5-extensions-prompts.md` (≈25 linhas), `docs/beheld-fase7-prompts.md` (≈40 linhas), `docs/beheld-session-fases.md` (3 linhas), `docs/beheld-session-features.md` (~10 linhas) — referem o CLI como `devprofile <comando>`. Não afeta runtime; afeta consulta humana à doc. Decisão na Etapa B: fazer find-replace agora ou em iteração separada.

### 5.4 Sem resíduo no código de produto ativo

`grep -rn 'devprofile' packages/{cli,mcp-server,engine}/src/` retorna **apenas** os pontos da §5.1 (limpeza intencional). Nenhum env var, path runtime ou identificador ativo carrega o nome antigo. ✅

---

## 6. Datastores

- **CLI / engine:** `~/.beheld/profile.db` (SQLite local + WAL + SHM), sempre.
- **Backend Rails:** **Postgres em todos os ambientes** (`adapter: postgresql` em `database.yml` para dev/test/prod). Paridade já existe — NÃO há que migrar de SQLite para Postgres.
- **Redis:** dev → host (default `redis://localhost:6379/1` para cache + `/0` para OAuth state); prod → host via `network_mode: host`.
- **Compose conflitante:** `web/source/docker-compose.yml` (Postgres em container, credencial `beheld:beheld`, DB `beheld_development`) coexiste com `web/deploy/development/docker-compose.yml` (Postgres na host, env-driven, DB `beheld_backend_development`). Ver §7.

---

## 7. Pontos de atenção

1. **Defaults divergentes de `BEHELD_API_URL`.** O mesmo nome de env retorna URLs diferentes em comandos diferentes. Recomendação Etapa B: módulo central resolve por `BEHELD_ENV` (default `production`), e cada arquivo lê desse módulo em vez de fazer `process.env.BEHELD_API_URL ?? "..."`.
2. **Hardcoded sem override em `update.ts:8` e `notifications.ts:143`.** Impossível redirecionar `beheld update` ou as notificações de versão para um backend de staging sem patch. Ajustar na Etapa B.
3. **`PORTAL_PUBLIC_URL` com fallback `https://beheld.dev` em código Rails.** Em dev, se a env não estiver setada, emails e dashboards apontam para produção. Risco baixo (dev raramente envia email real) mas merece exigir a env ou cair em `http://localhost:5173` em dev.
4. **Compose duplicado `web/source/docker-compose.yml`.** Aparenta ser legacy do tempo `devprofile` (não tem env_file, credenciais hardcoded, DB name diferente). Decisão: deletar (preferido — `web/deploy/development/docker-compose.yml` é canônico) ou parametrizar.
5. **Segredos populados em `web/deploy/development/.env` no working tree.** Não rastreado pelo git (`git ls-files` confirmou), mas existe em disco. Risco: cópia do diretório → vazamento. Verificar se algum desses segredos já foi commitado no histórico do subrepo `web/`:
   ```bash
   cd web && git log --all -p -S 'BEHELD_PLATFORM_PRIVATE_KEY=' | head -30
   cd web && git log --all -p -S 'GITHUB_OAUTH_CLIENT_SECRET=' | head -30
   ```
   **Stop-and-ask:** se houver hit, NÃO reescrever histórico sem autorização.
6. **`web/deploy/keys/`.** Contém `beheld_deploy`, `beheld_deploy.pub`, `vps-bootstrap.pem`. `web/.gitignore` não menciona `deploy/keys/` explicitamente — confirmar se está rastreado:
   ```bash
   cd web && git ls-files deploy/keys/
   ```
   Se rastreado, mover para fora do repo e adicionar ao gitignore.
7. **Default `BEHELD_ENV=production` proposto.** A CLI é distribuída a devs externos via `curl | sh`. Default produção é correto. **Mas:** quando você (o autor) faz desenvolvimento local, precisa setar `BEHELD_ENV=local` em todo terminal — risco baixo de "rodei um snapshot real apontando para staging porque esqueci de exportar". Mitigação: validar em `beheld doctor`.
8. **`BEHELD_ENV=production` em conflito com testes que assumem localhost.** Vários testes setam `BEHELD_API_URL=http://localhost:3000` ou `BEHELD_ENGINE_URL=http://127.0.0.1:XXXX` explicitamente — esses funcionam independente de `BEHELD_ENV` porque setam o override individual. ✅ baixo risco. Confirmar nada quebra.
9. **Caddyfile com GitHub raw URL contendo username `eduardovrocha`.** Funciona, mas qualquer mudança de owner/repo do GitHub exige editar Caddyfile + redeploy. Parametrizar via env Caddy (`{$BEHELD_INSTALL_SCRIPT_URL}`) é trivial — incluir na Etapa B.
10. **`docker-compose.yml` em `web/deploy/development/` referencia `host.docker.internal:host-gateway`.** Funciona no macOS por padrão, no Linux requer Docker 20.10+. Já documentado; ok.
11. **Dashboard usa Cloudflare Workers (`wrangler`).** Provavelmente exige `wrangler.toml`/`wrangler.jsonc` com env vars próprias por ambiente — esquemas separados (`development`, `production`) no wrangler. Não tem env reads diretos no código fonte; precisa confirmar como o build do dashboard pega API URL.
12. **Frontend usa `VITE_API_URL` (sem `_BASE`).** A spec recomendou `VITE_API_BASE_URL`; manter `VITE_API_URL` evita um rename de baixo valor. Decisão na Etapa B.

---

## 8. Perguntas em aberto

1. **Default `BEHELD_ENV` — confirmar `production`?** A CLI é distribuída via `curl | sh` e usuários sem setar nada precisam ir para `beheld.dev`. Sugestão: sim, default `production`; staging só com export explícito.
2. **Variáveis legadas `DEVPROFILE_*` — fallback ou deletar?** Memória/docs mencionam `DEVPROFILE_PLATFORM_PRIVATE_KEY` / `DEVPROFILE_PLATFORM_KEY_ID` mas o grep no código vivo NÃO achou — só está em docs. Confirmar: ainda existem usuários ou ambientes setando essas variáveis? Se não, podemos pular o fallback e ir direto para `BEHELD_*`.
3. **`web/source/docker-compose.yml` — deletar ou manter?** É um compose alternativo (Postgres em container). Não está referenciado em nenhum script. Suspeita: legacy do tempo `devprofile`.
4. **`web/deploy/keys/` — está no .gitignore do subrepo `web/`?** Confirmar antes da Etapa B (já listei o comando em §7).
5. **Segredos já no histórico git do `web/`?** Comandos em §7. Se sim, definir política antes de tocar.
6. **Dashboard (TanStack Start + Cloudflare Workers) — onde é hospedado e como recebe a API base?** Sem env reads diretas no fonte (auto-injeção pelo preset Lovable). Precisa confirmar para parametrizar.
7. **Postgres em dev — manter container do compose ou rodar nativo no host?** Hoje `web/deploy/development/docker-compose.yml` assume host. Documentar a decisão na Etapa B (a spec recomenda paridade com prod, e prod é host — coerente).
8. **`PORTAL_PUBLIC_URL` — exigir env em dev ou usar fallback dev sensato?** Hoje o fallback é `https://beheld.dev` mesmo em dev. Pode atrapalhar quem testa email/dashboard.
9. **Renomear `VITE_API_URL` → `VITE_API_BASE_URL`?** Manter o nome atual é uma mudança a menos.
10. **`PORTAL_PUBLIC_URL` → renomear para `BEHELD_PORTAL_PUBLIC_URL`?** Padronização total do prefixo `BEHELD_` ou aceitar exceções para nomes do ecossistema Rails?
11. **Find-replace de docs (`devprofile <cmd>` → `beheld <cmd>`):** rodar agora junto com a Etapa B ou agendar separado?

---

## 9. Changelog

| data | autor | mudança |
|---|---|---|
| 2026-06-06 | claude (etapa A) | Documento criado. Inventário read-only completo. Aguardando aprovação para Etapa B. |
| 2026-06-06 | claude (etapa B) | Etapa B executada em 7 commits (B1+B2 / B3 / B4 / B5 / B6 / B7 / B8). Modelo final em `beheld-master.md#configuração-e-ambientes`. Confirmações: `BEHELD_ENV` com aliases `production`/`development`. `DEVPROFILE_*` envs deletadas sem fallback (zero hits em código vivo). `web/source/docker-compose.yml` legacy removido. `web/deploy/keys/` mantido com `.gitignore` próprio (`*` + whitelist `.gitignore`/`README.md`). Stop-and-ask de segredos no histórico git do `web/`: zero hits — segredos reais nunca foram commitados. Dashboard (TanStack Start + CF Workers) ficou de fora — investigação adicional necessária. |

---

## Anexo — recomendação opinativa de arquitetura

(Para discussão antes da Etapa B — não é decisão final.)

**Face 1 (CLI / daemon):**
- Adotar `BEHELD_ENV ∈ {production, local}` com default `production`.
- Criar módulo central `packages/cli/src/config/env.ts` (e equivalente Python `packages/engine/src/config.py`) que resolve, a partir de `BEHELD_ENV`:
  - `API_BASE_URL` → `https://beheld.dev` | `http://localhost:3000`
  - `PORTAL_URL` → mesmo (ou alias)
  - `REKOR_URL` → `https://rekor.sigstore.dev` | `https://rekor.sigstage.dev`
- Cada arquivo que hoje faz `process.env.BEHELD_API_URL ?? "..."` passa a importar do módulo central.
- Mantém `BEHELD_API_URL`, `BEHELD_PORTAL_URL`, `BEHELD_REKOR_URL` como overrides individuais (precedência: env individual > `BEHELD_ENV` > default).
- Portas locais 7337/7338/11434/51823 permanecem literais — são **CONST-LOCAL**.
- Fallback de `DEVPROFILE_*` apenas se §8.2 confirmar que existem usuários afetados; caso contrário, pular.

**Face 2 (web layer):**
- Já usa `RAILS_ENV`/`NODE_ENV` corretamente. Manter.
- Substituir os 4 fallbacks `https://beheld.dev` em código Rails por uma constante única (`Beheld::PortalUrl.default_for(Rails.env)`) ou exigir `PORTAL_PUBLIC_URL` setada.
- Vite: criar `.env.development` e `.env.production` no `web/source/frontend/` (e dashboard), gitignored, com `.env.example` versionado.
- `web/source/docker-compose.yml` (legacy): deletar ou marcar `deprecated:` no topo.
- Renomear DB names em `web/deploy/development/.env` (resíduo `devprofile_backend_*`).
- Caddyfile: parametrizar `BEHELD_INSTALL_SCRIPT_URL` via env Caddy.

**Transversal:**
- Padronizar prefixo `BEHELD_` para envs proprietárias do projeto. Aceitar exceções para envs Rails-padrão (`RAILS_*`, `DATABASE_URL`, `REDIS_URL`, `SECRET_KEY_BASE`) e Vite-padrão (`VITE_*`).
- `.env.example` em cada app (CLI, engine, backend, frontend, dashboard); `.env` real sempre gitignored.
- `web/deploy/keys/` para gitignore explícito (se não estiver).
- Documentação: seção "configuração e ambientes" no `beheld-master.md` (Etapa B7) — matriz `BEHELD_ENV` × valores resolvidos.

---

**FIM DA ETAPA A.** Documento pronto para aprovação. Etapa B não inicia até autorização explícita, e qualquer item de §7 (riscos / `stop-and-ask`) é revisado primeiro.

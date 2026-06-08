# MAPA-PRODUTO — beheld

> Índice transversal do monorepo. **Não duplica conteúdo** — só lista, atalha e marca cross-cutting concerns. Cada item linka para o documento ou path de origem.
>
> Atualização: 2026-06-06 (criação inicial pela Etapa A da análise de ambientes).

---

## Documentos vivos

| documento | propósito |
|---|---|
| [beheld-master.md](beheld-master.md) | spec mestre por fases, decisões de design, status de implementação |
| [beheld-estado-atual.md](beheld-estado-atual.md) | snapshot do estado do produto |
| [beheld-analise-mercado.md](beheld-analise-mercado.md) | análise de mercado |
| [beheld-portal-spec.md](beheld-portal-spec.md) | spec do portal web (`beheld.dev`) |
| [beheld-jobposting-spec.md](beheld-jobposting-spec.md) | spec do recurso de job posting |
| [beheld-position-form-spec.md](beheld-position-form-spec.md) | spec do form de posição |
| [beheld-fase5-extensions-prompts.md](beheld-fase5-extensions-prompts.md) | prompts da fase 5 (attestation + identity) |
| [beheld-fase7-prompts.md](beheld-fase7-prompts.md) | prompts da fase 7 (claims) |
| [beheld-session-fases.md](beheld-session-fases.md) · [beheld-session-features.md](beheld-session-features.md) | notas de sessão / features |
| [beheld-resiliencia-engine-futuro.md](beheld-resiliencia-engine-futuro.md) | direções de resiliência |
| [r3-windsurf-spike.md](r3-windsurf-spike.md) | spike Windsurf |
| **[analise-ambientes.md](analise-ambientes.md)** | **🆕 inventário de valores ambiente-dependentes (CLI + web) — base da Etapa B de separação de ambientes** |
| [produto/docs/cli-reference.md](../produto/docs/cli-reference.md) | referência completa do CLI levantada do código-fonte (commit d7badd8) — assinatura, efeitos, output e exit codes por comando |

## Releases

| versão | doc |
|---|---|
| v0.4.0 | [releases/v0.4.0.md](releases/v0.4.0.md) · [verification](releases/v0.4.0-post-launch-verification.md) |

## Topologia (resumo)

| componente | path | porta | runtime |
|---|---|---|---|
| CLI `beheld` | [packages/cli/](../packages/cli/) | — | Bun TS compilado |
| MCP server | [packages/mcp-server/](../packages/mcp-server/) | 7337 | Bun TS |
| Scoring engine | [packages/engine/](../packages/engine/) | 7338 | Python FastAPI (PyInstaller) |
| Backend Rails | [web/source/backend/](../web/source/backend/) | 3000 | Rails 7.2 + Puma |
| Frontend SPA | [web/source/frontend/](../web/source/frontend/) | 5173 (dev) / static (prod) | React + Vite |
| Dashboard | [web/source/dashboard/](../web/source/dashboard/) | wrangler dev | TanStack Start + Cloudflare Workers |
| Caddy (prod) | [web/deploy/production/Caddyfile](../web/deploy/production/Caddyfile) | 80/443 | `caddy:2-alpine` |

Topologia detalhada (tabela completa com datastores): ver §2 de [analise-ambientes.md](analise-ambientes.md).

---

## Cross-cutting concerns

### Configuração e ambientes

**Estado atual** (pós-Etapa B — 2026-06-06):

- `BEHELD_ENV ∈ {production, development}` (default `production`) resolve API/portal/Rekor URLs via módulo central. Overrides individuais (`BEHELD_API_URL`, `BEHELD_PORTAL_URL`, `BEHELD_REKOR_URL`) mantidos com precedência.
- Módulos centrais: [packages/cli/src/config/env.ts](../packages/cli/src/config/env.ts) · [packages/mcp-server/src/config/env.ts](../packages/mcp-server/src/config/env.ts) · [packages/engine/src/config.py](../packages/engine/src/config.py).
- Rails: `RAILS_ENV` (padrão) + `PORTAL_PUBLIC_URL` **obrigatória** (sem fallback) + `BEHELD_PLATFORM_*` + `GITHUB_OAUTH_*`.
- Vite: `VITE_API_URL` via `.env.development` / `.env.production` (versionados, não-segredo).
- Caddyfile prod: `BEHELD_INSTALL_SCRIPT_URL` parametriza redirect de install.
- Postgres em todos os ambientes do Rails (dev/test/prod). SQLite exclusivo do CLI/engine.
- Zero `devprofile` em código de produto fora dos pontos intencionais (legacy-bridge, cleanup de plist/systemd, testes).

**Detalhamento completo:** [analise-ambientes.md](analise-ambientes.md) (inventário inicial) + seção "Configuração e ambientes" em [beheld-master.md](beheld-master.md) (modelo final aplicado).

### Segredos

Inventário, localização e gitignore — ver §4 de [analise-ambientes.md](analise-ambientes.md).

Política em uma linha: **segredos vivem em `/etc/beheld/*.env` em prod e em `.env` gitignored em dev — nunca commitados**.

### Deploy

- Dev: `web/deploy/development/docker-compose.yml` (Postgres + Redis na host).
- Prod: `web/deploy/production/docker-compose.yml` + `Caddyfile` no VPS `45.225.129.168` (Altatech — NÃO Hostinger). Postgres + Redis nativos no host.
- CLI/daemon: binário standalone via `curl https://beheld.dev/install | sh`.

---

## Changelog do mapa

- **2026-06-08** — adicionada `produto/docs/cli-reference.md` (referência do CLI varrida do código-fonte no commit `d7badd8`).
- **2026-06-06** — criação inicial pela Etapa A da análise de ambientes. Adicionado link para `analise-ambientes.md` e seção transversal "Configuração e ambientes".
- **2026-06-06** — Etapa B aplicada. Seção "Configuração e ambientes" atualizada para refletir o estado final pós-implementação (módulos centrais, `BEHELD_ENV`, Vite envs, Caddyfile parametrizado).

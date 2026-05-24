# Beheld — Sessão atual: fases discutidas

**Data:** 2026-05-24
**Sessão:** Continuação pós-F5.7 · Identidade visual · Deploy · Uninstall

---

## Fases concluídas nesta sessão

### F5.7 — Reproducible builds + engine_version_hash + first_seen_at ✅
Reportado como concluído no início da sessão.
- `scripts/verify-reproducible.sh` → exit 0
- SHA-256 reproduzível: `e55d88ffa791686293ace4027b2ef24fc372ccf7cef33b5cbcc4d0a21e983cd9`
- Engine: 456/456 · Bun: 442/442 (438 + 4 identity)

### F5.6 — Identity binding GitHub OAuth ✅
Código completo. Prompt escrito e executado nesta sessão.
- `beheld identity link` — fluxo OAuth completo
- `~/.beheld/attestation.json` armazenado
- Bundle com `identity_verified: true`
- Infra pendente resolvida: DNS + Caddyfile + GitHub App callback

### F5.8 — Sigstore Rekor inclusion ✅
Descrito e executado nesta sessão. Validado end-to-end com mock Rekor.
- Bundle com `rekor.logIndex`, `rekor.integratedTime`
- Tier `fully_verifiable` confirmado
- `beheld snapshot --rekor-submit` para re-submissão offline

---

## Fases em andamento

### F5 Infra — Deploy em beheld.dev 🔄
DNS propagado e confirmado. Arquivos gerados. Deploy pendente no servidor.
- `A @ → 45.225.129.168` ✅ propagado
- `CNAME www → beheld.dev` ✅ propagado
- Caddyfile atualizado (`:80` → `beheld.dev`, TLS automático) → gerado
- docker-compose.yml renomeado (devprofile → beheld) → gerado
- Sequência de deploy documentada
- GitHub App OAuth callback: `https://beheld.dev/api/auth/github/callback` → pendente

### F8 — Web: Landing + Profile 🔄 (planejamento)
Mapeamento completo realizado. Prompt não escrito ainda.

Stack identificada:
- Frontend: `web/source/frontend/` — React + Vite + Tailwind + TypeScript (porta 5173)
- Backend: `web/source/backend/` — Rails (porta 3000)
- Dashboard: `web/source/dashboard/` — React + Lovable + shadcn/ui

Rotas existentes confirmadas:
- `routes/Home.tsx` → landing (`/`)
- `routes/VerifyPublic.tsx` → profile (`/v/:id`)
- `GET /v/:id` → Rails `v#show` ✅
- `POST /bundles` → Rails `bundles#create` ✅

Decisões arquiteturais tomadas:
- **Dark mode:** ThemeToggle seta `class="dark"` (Tailwind) + `data-theme="dark"` (CSS vars mockup) — coexistência sem refactor
- **i18n:** manter client-side JS por agora, extender `dict.ts` existente
- **Fonte:** adicionar Switzer ao Tailwind config ao lado do Inter existente
- **CSS:** `beheld.css` global importado em `main.tsx` com todos os tokens
- **Profile data:** server-side injection via ERB (bundle imutável, cache agressivo)

Sequência de implementação definida:
1. Sprint 1 — Fundação (beheld.css, ThemeContext, LangContext, Canon, Controls)
2. Sprint 2 — Landing (todos os componentes, i18n, CTAs conectados)
3. Sprint 3 — Profile (rota /v/:id, dados reais do bundle, error states)

### F_UNINSTALL — beheld delete estendido 🔄 (prompt escrito)
Prompt completo escrito. Implementação não iniciada.
- `beheld delete --all` → sequência completa de 6 passos
- `beheld delete --remote` → só revoga attestation no servidor
- Limpeza de resíduos devprofile (plist macOS, service Linux)
- Rails: `POST /api/attestation/revoke` + migração `revoked_at`
- 9 testes CLI + 5 testes Rails

---

## Revisão de status geral (realizada nesta sessão)

| Fase | Nome | Status |
|------|------|--------|
| F0 | Build & Release Pipeline | ✅ |
| F1 | MCP Server TypeScript | ✅ |
| F2 | Scoring Engine Python | ✅ |
| F3 | CLI + Instalação | ✅ |
| F4 | Integração VS Code via MCP | ✅ |
| F5 | Signed Snapshot + Verification Chain | ✅ |
| F5.6 | Identity binding GitHub OAuth | ✅ código · 🔄 infra |
| F5.7 | Reproducible build + engine_hash + first_seen_at | ✅ |
| F5.8 | Sigstore Rekor inclusion | ✅ |
| F6 | Git Bootstrap — L1 | ⬜ não iniciado |
| F7 | Claimed vs Demonstrated | ⬜ prompts prontos |
| F8 | Web — Landing + Profile | 🔄 planejamento |
| F_UNINSTALL | beheld delete --all/--remote | 🔄 prompt pronto |

---

## Identidade visual (trabalho desta sessão)

### Landing page — ajustes realizados
- Remoção do `<h1>Beheld</h1>` do doc-head
- Seção 02 (Claimed vs Demonstrated): título fora do bloco (padrão correto)
- Theme toggle corrigido: `data-theme="dark"` inicial no `<html>` (landing é dark-primary)
- `--card-bg` token adicionado (resolve `background: white` em dark mode)
- `section.contrast` removida → bloco 02 segue o tema da página
- `sd-val` com `data-i18n-html` (resíduos hardcoded corrigidos)
- Ícone SVG de copy no botão do install command
- B3H31D assina a letter: `— B3H31D · sobre o produto`
- Actions movidas para dentro do `canon-wrap` (logo após tagline)

### Profile page — ajustes realizados
- B3H31D assina a letter: `— B3H31D · Observação`

### B3H31D mascot
- v1: SVG geométrico flat (dark body, cream lens, bronze accents)
- v2: SVG mais detalhado estilo LEGO Technic (volumétrico com flat tones)
- Referência de imagem: LEGO/K-2SO style — SVG não atinge esse nível; próximo passo recomendado: prompt Midjourney/DALL-E 3 (escrito e entregue)

---

## Arquivos gerados nesta sessão

| Arquivo | Descrição |
|---------|-----------|
| `beheld-landing-v3.html` | Landing page final com todos os ajustes |
| `beheld-dev-profile-page.html` | Profile page com B3H31D |
| `b3h31d-mascot.html` | Mascote v1 (3 variantes: dark, light, icon) |
| `b3h31d-mascot-v2.html` | Mascote v2 (LEGO-style volumétrico) |
| `Caddyfile` | Produção — beheld.dev com TLS automático |
| `docker-compose.yml` | Produção — devprofile → beheld renomeado |

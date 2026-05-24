# Beheld — Features definidas na sessão atual

**Data:** 2026-05-24

---

## F5.6 — Identity binding GitHub OAuth

**Arquivo de prompt:** disponível na sessão  
**Status:** ✅ implementado · 🔄 infra pendente

### Fluxo
1. `beheld identity link` → gera state token → abre browser → `https://beheld.dev/auth/github`
2. Servidor Rails: OAuth GitHub → obtém username/id → cria attestation
3. Attestation assinada com `BEHELD_PLATFORM_PRIVATE_KEY` (Ed25519)
4. CLI recebe attestation → verifica assinatura da plataforma → salva `~/.beheld/attestation.json`
5. Próximo `beheld snapshot` → bundle com `identity_verified: true`

### Schema da attestation
```json
{
  "schema": "beheld-identity-attestation/v1",
  "github_username": "octocat",
  "github_user_id": 1234567,
  "public_key": "<hex Ed25519 pública do dev>",
  "issued_at": "2026-05-21T00:00:00Z",
  "platform_key_id": "beheld-platform-2026-q2",
  "platform_signature": "<hex Ed25519>"
}
```

### Rails endpoints
- `GET /api/auth/github/start` — inicia OAuth
- `GET /api/auth/github/callback` — troca code → attestation
- `POST /api/attestation/claim` — CLI troca claim_code por attestation
- `POST /api/attestation/verify` — verificação criptográfica

### Pendências de infra
- GitHub App OAuth callback URL: `https://beheld.dev/api/auth/github/callback`
- DNS + Caddyfile: `beheld.dev` (resolvido nesta sessão)

---

## F5.8 — Sigstore Rekor inclusion

**Status:** ✅ implementado e validado end-to-end

### Fluxo
1. `beheld snapshot` gera payload → assina Ed25519
2. CLI submete `(hash, signature, publicKey)` ao Rekor: `https://rekor.sigstore.dev/api/v1/log/entries`
3. Rekor retorna `logIndex`, `uuid`, `integratedTime`, `signedEntryTimestamp`
4. Bundle salvo com campos `rekor.*` no envelope (fora do payload assinado)
5. Tier promovido para `fully_verifiable`

### Estrutura do bundle
```json
{
  "payload": { "...dados assinados..." },
  "signature": "<hex>",
  "public_key": "<hex>",
  "attestation": { "...F5.6..." },
  "rekor": {
    "log_index": 1779336686,
    "uuid": "...",
    "integrated_time": "2026-05-21T04:12:14.000Z",
    "signed_entry_timestamp": "<base64>"
  }
}
```

### Trust tier logic
| Campos presentes | Tier |
|---|---|
| `signature` | `signature_only` |
| + chain | `chain_intact` |
| + `identity_verified: true` | `identity_verified` |
| + `engine_version_hash` | `engine_verified` |
| + `rekor.log_index` | `fully_verifiable` |

### Flags CLI
- `beheld snapshot` → submete ao Rekor automaticamente
- `beheld snapshot --rekor-submit <bundle>` → re-submete bundle existente
- `beheld verify --verify-rekor` → confirma entry no log público

### Regra crítica
Falha no Rekor nunca impede geração do bundle. Se offline → bundle salvo, tier `engine_verified`, aviso exibido.

---

## F5 Infra — Deploy beheld.dev

**Status:** 🔄 DNS propagado · deploy pendente

### DNS records criados
| Tipo | Nome | Valor |
|------|------|-------|
| A | `@` | `45.225.129.168` |
| CNAME | `www` | `beheld.dev` |

### Caddyfile (produção)
- `auto_https off` removido
- `:80` → `beheld.dev` (TLS Let's Encrypt automático)
- `www.beheld.dev` → redirect permanente para `beheld.dev`
- Routing: `/api/*` + `/bundles` + `/up` → Rails `:3000`
- `/v/:id` com `Accept: application/json` → Rails
- Tudo o mais → SPA React em `/srv/frontend`

### docker-compose.yml (produção)
- `name: beheld` (era `devprofile`)
- `container_name: beheld-backend` (era `devprofile-backend`)
- `container_name: beheld-caddy` (era `devprofile-caddy`)
- `image: beheld-backend:prod`
- `env_file: /etc/beheld/` (era `/etc/devprofile/`)
- Volumes: `beheld-caddy-data`, `beheld-caddy-config`

### Sequência de deploy no servidor
```bash
ssh deploy@45.225.129.168
sudo mkdir -p /etc/beheld
sudo cp /etc/devprofile/app.env /etc/beheld/app.env
sudo cp /etc/devprofile/postgres.env /etc/beheld/postgres.env
sudo chmod 600 /etc/beheld/*.env
cd /path/to/beheld/web/deploy/production
docker compose down
docker compose build backend
docker compose up -d
docker compose logs caddy -f   # aguardar: "certificate obtained successfully"
curl -I https://beheld.dev/up  # → HTTP/2 200
```

---

## F_UNINSTALL — beheld delete estendido

**Status:** 🔄 prompt pronto · implementação pendente

### Flags

**`beheld delete --all`** — uninstall completo:
1. Para daemon (`beheld stop`)
2. Revoga attestation no servidor (`POST /api/attestation/revoke`)
3. Remove `~/.beheld/`
4. Remove hooks de `~/.claude/settings.json` + project scopes
5. Remove entrada de `~/.continue/config.json`
6. Remove resíduos devprofile (LaunchAgent macOS / systemd Linux)

**`beheld delete --remote`** — só revogação remota:
- Revoga attestation no servidor
- Mantém dados locais intactos

### Output esperado
```
Iniciando remoção completa do Beheld...

✓ Daemon parado
✓ Attestation revogada no servidor
✓ ~/.beheld/ removido (847 sessões · 4 repositórios)
✓ Hooks removidos de ~/.claude/settings.json
✓ Entrada removida de ~/.continue/config.json
✓ LaunchAgent devprofile removido (resíduo do rename)

Beheld removido com sucesso.

Para remover o binário:
  rm $(which beheld)
```

### Rails: POST /api/attestation/revoke (novo endpoint)
```
Body: { "public_key": "<hex>", "signed_revocation": "<hex Ed25519>" }
Payload assinado: { "action": "revoke", "issued_at": "<original>", "timestamp": "<now>" }
Resposta 200: { "revoked": true }
Erros: 404 (não encontrada) · 422 (assinatura inválida) · 422 (timestamp expirado)
```

Migração: coluna `revoked_at datetime nullable` em `attestations`.

### Comportamento resiliente
- Servidor offline → avisa mas continua limpeza local
- Sem `~/.beheld/attestation.json` → pula passo de revogação silenciosamente
- Binário (`~/.local/bin/beheld`) NUNCA removido automaticamente

### Testes
- 9 testes CLI (Bun): daemon stop order, rm -rf, hooks removal, continue.dev, devprofile residues (macOS + Linux), --remote, servidor offline, sem attestation
- 5 testes Rails (RSpec): revoke válido, assinatura inválida, 404, timestamp expirado, `revoked_at` preenchido

---

## F8 — Web: Landing + Profile (planejamento)

**Status:** 🔄 planejamento completo · prompts não escritos

### Stack confirmada
- Frontend: `web/source/frontend/` — React + Vite + Tailwind (`darkMode: "class"`) + TypeScript + Bun
- Backend: `web/source/backend/` — Rails (porta 3000)
- Porta frontend: 5173

### Componentes existentes (reaproveitados)
| Componente | Uso |
|---|---|
| `I18nProvider.tsx` + `dict.ts` | i18n — extender com strings Beheld |
| `ThemeToggle.tsx` | tema — adicionar `data-theme` ao lado do `class` |
| `LocaleToggle.tsx` | locale — manter |
| `routes/Home.tsx` | landing — redesign |
| `routes/VerifyPublic.tsx` | profile — dados reais |
| `lib/verify.ts` + `attestationVerify.ts` | verificação — manter |

### Decisões arquiteturais
1. **Dark mode:** `ThemeToggle` seta `class="dark"` (Tailwind) E `data-theme="dark"` (Beheld CSS) em simultâneo
2. **i18n:** client-side JS via `dict.ts` existente — extender, não reescrever
3. **Fonte:** Switzer adicionada ao `tailwind.config.js` como `font-display` (ao lado do Inter existente)
4. **CSS:** `beheld.css` global com tokens + componentes, importado em `main.tsx`
5. **Profile data:** fetch `GET /api/v/:id.json` no componente → Rails retorna bundle verificado

### Conflito resolvido
Tailwind `darkMode: "class"` vs mockup `html[data-theme="dark"]` → coexistência:
```tsx
// ThemeToggle.tsx — modificação necessária
document.documentElement.classList.toggle('dark', isDark)
document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
```

### Componentes novos a criar
```
src/
  components/
    Canon/          → lente SVG + wordmark + tagline
    SectionHead/    → num + h2 + right label
    ChainTable/     → chain-row × N
    SignalCard/     → sc-head + signal-row × N
    DocFoot/        → lens mini + foot-text
  styles/
    beheld.css      → tokens + reset + componentes globais
```

### Sprints definidos
```
Sprint 1 — Fundação
  beheld.css · ThemeContext ajustado · Canon · Controls · SectionHead · DocFoot

Sprint 2 — Landing (Home.tsx)
  Todas as seções · i18n via dict.ts · install command · CTAs conectados

Sprint 3 — Profile (VerifyPublic.tsx)
  /v/:id · fetch bundle · dados reais · error states · cache HTTP
```

---

## Find-replace devprofile → beheld (docs)

**Status:** ✅ executado

### Arquivos atualizados (~130 arquivos)
Padrões substituídos:
- `DEVPROFILE_PLATFORM_PRIVATE_KEY` → `BEHELD_PLATFORM_PRIVATE_KEY`
- `DEVPROFILE_PLATFORM_KEY_ID` → `BEHELD_PLATFORM_KEY_ID`
- `DEVPROFILE` → `BEHELD`
- `DevProfileEvent` → `BeheldEvent`
- `DevProfile` → `Beheld`
- `devprofile.app` → `beheld.dev`
- `devprofile.service` → `beheld.service`
- `devprofile.daemon.plist` → `beheld.daemon.plist`
- `devprofile` → `beheld`

### Arquivos renomeados (~24)
- `devprofile-estrategia.md` → `beheld-estrategia.md`
- `devprofile-backlog.md` → `beheld-backlog.md`
- `devprofile-fase6-prompts.md` → `beheld-fase6-prompts.md`
- `devprofile-fase5-extensions-prompts.md` → `beheld-fase5-extensions-prompts.md`
- `devprofile-fase7-prompts.md` → `beheld-fase7-prompts.md`

---

## Identidade visual — ajustes finais

### B3H31D — nome do daemon/mascote
- Leet speak: B=B · 3=E · H=H · 3=E · 1=L · D=D → BEHELD
- Assina a letter em ambas as páginas: `— B3H31D · sobre o produto` / `— B3H31D · observação`
- North-star: "Nosso R2D2 é o B3H31D"

### Design tokens finais (locked)
```css
/* Dark (primary — landing) */
--bg: #0d1117; --surface: #11161e; --rule: #252b35;
--text: #e6e1d8; --muted: #8b8278; --accent: #c9a96e;
--card-bg: var(--surface);

/* Light (primary — profile) */
--bg: #f5f1e8; --surface: #ebe6d6; --rule: #cec5b1;
--text: #1a1f29; --muted: #6e6555; --accent: #8a6f3e;
--card-bg: white;
```

### Correções landing page aplicadas
- Actions após tagline (dentro do `canon-wrap`)
- Bloco 02 título fora do bloco de conteúdo
- `data-theme="dark"` inicial no `<html>` (dark é primary)
- `--card-bg` token (resolve cards brancos em dark mode)
- `sd-val` com `data-i18n-html` (resíduos hardcoded)
- `q3-v` com `data-i18n-html` (span `.ok` renderizava como texto)
- Botão copy: ícone SVG em vez de texto "copiar"
- Border do install command removida

# DevProfile — Prompts de Execução: Fase 5 estendida (Bundle Integrity Hardening)

> Execute um prompt por sessão no Claude Code.
> Cada prompt é autossuficiente — contém contexto, objetivo, critérios e o que NÃO fazer.
> Ordem obrigatória: F5.6.1 → F5.6.2 → F5.6.3 → F5.7.1 → F5.7.2 → F5.8.1 → F5.8.2

---

## Contexto global (cole no início de cada sessão)

```
Você está trabalhando no DevProfile — daemon local que constrói o perfil
técnico de um desenvolvedor a partir do uso do Claude Code e do Continue.dev.

Stack:
- TypeScript compilado com Bun (MCP server + CLI) — sem Node.js no host
- Python compilado com PyInstaller (scoring engine) — sem Python no host
- SQLite local em ~/.devprofile/profile.db
- Monorepo com Bun workspaces

Estrutura do repositório:
  devprofile/
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

---

## Princípios da Fase 5 estendida (cole junto do contexto global)

```
A Fase 5 original entregou bundle assinado com Ed25519 + chain hash. Isso
resolve o problema de "não-alterado" (post-hoc tampering). A Fase 5 estendida
ataca o problema de "não-inflado": como o consumidor do bundle pode confiar
que os dados de origem são honestos, não só que a assinatura é válida.

Três camadas de defesa, cada uma necessária e nenhuma suficiente sozinha:

F5.6 — Identity binding via OAuth (GitHub)
  Vincula a chave Ed25519 do dev a uma identidade verificável (GitHub user).
  A plataforma DevProfile, com chave dedicada, assina uma attestation que
  diz "essa public key pertence a esse usuário GitHub, atestada em X".
  OPCIONAL: bundles sem attestation ainda funcionam, mas saem tagged como
  identity_unverified — empresas filtram pelo tag se quiserem só attested.

F5.7 — Âncoras externas verificáveis
  Engine version hash (reproducible builds) + first_seen_at por repo +
  cross-check OPT-IN de root_commit_hashes contra GitHub API. Permite que
  o verifier confirme que o bundle foi produzido por engine oficial e que
  os repos citados existem mesmo.

F5.8 — Append-only log público (Sigstore Rekor)
  Toda geração de snapshot publica o hash do bundle no Rekor. Bundle só
  conta como "fully_verifiable" se tem entrada no log. Impede o dev de
  gerar múltiplos bundles privadamente e publicar só o melhor — todo
  bundle que existe está cronologicamente registrado em público.

Princípios não-negociáveis:

1. Toda defesa é honesta sobre seu próprio limite. Identity binding prova
   identidade, não honestidade dos dados. Rekor prova existência cronológica,
   não veracidade da fonte. O verifier mostra cada nível separadamente,
   nunca afirma "bundle confiável" — só lista o que verificou.

2. Tier de confiança transparente. Bundle com todas as camadas = "fully_verifiable".
   Bundle sem attestation = "identity_unverified". Bundle sem Rekor =
   "offline_only". Verifier exibe o tier ao final do report. Nunca rejeita
   um bundle por falta de uma camada — sinaliza.

3. Verifier offline-first. Ed25519 + chain hash + engine_version_hash + root
   hashes ainda dão garantia parcial sem rede. Camadas online (attestation
   verify, Rekor inclusion, GitHub cross-check) são opt-in via flags ou
   automáticas quando há rede — mas nunca obrigatórias pro verifier rodar.

Decisões já fechadas:
- GitHub é o primeiro OAuth provider
- Attestation é assinada por chave dedicada da plataforma (não pelo dev)
- Sigstore Rekor é o log público (não construir log próprio)
- Reproducible builds entram agora (não parquear pra v0.5)
- Rekor é mandatório pro tier "fully_verifiable"; bundles offline-only existem mas em tier separado
```

---

## F5.6.1 — Backend: OAuth GitHub + chave da plataforma + attestation API

```
Implemente o backend que suporta identity binding via GitHub OAuth e
geração de attestations assinadas pela chave da plataforma.

### Contexto

A plataforma DevProfile tem uma chave Ed25519 dedicada (separada das chaves
dos devs) usada exclusivamente pra assinar attestations. Quando um dev faz
OAuth com GitHub via CLI, o backend recebe o código de autorização, troca
por token, obtém o username, e responde com uma attestation assinada.

O dev nunca vê o token GitHub — fica só no backend pelo tempo da request.
O que persiste no backend é apenas o mapping {github_username, dev_public_key,
attested_at} mais a attestation assinada.

### O que implementar

**1. Chave da plataforma em packages/backend/src/keys.py**

  - Ed25519 keypair carregado de variável de ambiente:
    DEVPROFILE_PLATFORM_PRIVATE_KEY (base64-encoded raw bytes)
    DEVPROFILE_PLATFORM_KEY_ID (string ex: "devprofile-platform-2026-q2")
  - Public key derivada na inicialização
  - Função sign_canonical(message: dict) -> bytes
  - Função verify_canonical(message: dict, signature: bytes) -> bool
  - Para canonicalização: usar canonicaljson lib (RFC 8785)
  - Em desenvolvimento, gerar keypair se vars não setadas (com warning loud)

**2. OAuth GitHub flow em packages/backend/src/auth/github.py**

  - GitHub OAuth App credentials em env:
    GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET
  - Função exchange_code_for_user(code: str, redirect_uri: str) -> str
    - POST https://github.com/login/oauth/access_token
    - GET https://api.github.com/user → retorna login (username)
    - Retorna username
    - Raise GitHubAuthError em qualquer falha
  - Token GitHub NUNCA é persistido — descartado após uso

**3. Endpoint POST /attestation/issue em packages/backend/src/main.py**

  Body:
    {
      "oauth_provider": "github",
      "oauth_code": "abc123...",
      "redirect_uri": "http://localhost:51823/callback",
      "dev_public_key": "ed25519-pub:base64..."
    }

  Resposta 201:
    {
      "attestation": {
        "github_username": "octocat",
        "attested_at": "2026-05-20T14:00:00Z",
        "public_key_fingerprint": "ed25519:sha256:fp_...",
        "platform_key_id": "devprofile-platform-2026-q2",
        "platform_signature": "ed25519:base64_signature..."
      }
    }

  Lógica:
    1. Exchange code → github_username
    2. Calcular fingerprint do dev_public_key (SHA-256 da chave base64)
    3. Montar canonical message:
       {github_username, attested_at, public_key_fingerprint, platform_key_id}
    4. Assinar com a chave da plataforma
    5. Persistir em tabela `attestations` (ver schema abaixo)
    6. Retornar attestation completa

  Tabela `attestations` em backend SQLite (ou PG em produção):
    - id UUID PRIMARY KEY
    - github_username TEXT NOT NULL
    - public_key_fingerprint TEXT NOT NULL
    - attested_at TIMESTAMP NOT NULL
    - platform_key_id TEXT NOT NULL
    - platform_signature TEXT NOT NULL
    - revoked_at TIMESTAMP (nullable)

**4. Endpoint POST /attestation/verify**

  Body:
    {
      "attestation": { ... a attestation completa ... }
    }

  Resposta 200:
    {
      "valid": true | false,
      "revoked": true | false,
      "reason": "..." (apenas se invalid)
    }

  Lógica:
    1. Buscar platform_key_id na lista de chaves conhecidas (atual + rotacionadas)
    2. Reconstruir canonical message dos campos da attestation
    3. Verificar platform_signature contra a public key correspondente
    4. Checar se há registro em `attestations` com mesmo
       (github_username, fingerprint, attested_at) — opcional, mas detecta
       attestation forjada com chave correta mas conteúdo falso
    5. Verificar se attestation está revoked_at

**5. Endpoint GET /attestation/platform-keys**

  Resposta:
    {
      "keys": [
        {
          "key_id": "devprofile-platform-2026-q2",
          "public_key": "ed25519-pub:base64...",
          "active": true,
          "rotated_at": null
        },
        ...
      ]
    }

  Permite verifiers obter chave pública pra cada platform_key_id histórico.

### O que NÃO implementar

- Sessão / cookies — endpoints são stateless, autenticação é só OAuth code
- UI HTML de OAuth — CLI gerencia o flow (próximo prompt F5.6.2)
- Rotação de attestations de devs cuja chave foi comprometida — endpoint
  de revoke vem em fase futura, por agora `revoked_at` é coluna sem UI
- Múltiplos provedores além de GitHub — GitLab/Bitbucket são fase futura

### Testes em packages/backend/tests/test_attestation.py

- test_issue_with_valid_code_returns_signed_attestation
- test_issue_with_invalid_code_returns_401
- test_issue_persists_attestation_record
- test_issue_canonical_message_is_deterministic
- test_verify_valid_attestation_returns_valid_true
- test_verify_tampered_signature_returns_valid_false
- test_verify_unknown_platform_key_id_returns_valid_false
- test_verify_revoked_attestation_returns_revoked_true
- test_platform_keys_endpoint_lists_all_keys

Mockar GitHub API com responses fixtures.

### Critério de conclusão

pytest packages/backend/tests/test_attestation.py → todos passando
Endpoints respondem em < 200ms (p95) em ambiente local
GitHub OAuth flow real (manual): registrar OAuth App, fazer flow ponta-a-ponta,
  obter attestation válida
Canonical message bate byte-a-byte entre issue e verify (teste de roundtrip)
```

---

## F5.6.2 — CLI: comando devprofile identity link + armazenamento

```
Implemente o comando CLI que executa o OAuth flow com GitHub e armazena
a attestation localmente em ~/.devprofile/profile.db.

### Contexto

`devprofile identity link --provider github` abre o navegador do dev pra
autorizar a app DevProfile no GitHub, recebe o callback via servidor HTTP
local efêmero, envia o code pro backend `/attestation/issue`, e armazena a
attestation resultante junto da chave do dev em profile.db.

Comando é opcional — bundles funcionam sem identity link, só saem como
identity_unverified.

### O que implementar

**1. Migration em packages/engine/src/storage/sqlite.py**

Tabela `identity_attestations`:
  - id INTEGER PRIMARY KEY AUTOINCREMENT
  - oauth_provider TEXT NOT NULL CHECK (oauth_provider IN ('github'))
  - oauth_username TEXT NOT NULL
  - public_key_fingerprint TEXT NOT NULL
  - attested_at TEXT NOT NULL
  - platform_key_id TEXT NOT NULL
  - platform_signature TEXT NOT NULL
  - linked_at TEXT NOT NULL                  (ISO-8601, quando linkou localmente)
  - is_active INTEGER NOT NULL DEFAULT 1

Index: CREATE UNIQUE INDEX idx_identity_active_provider
       ON identity_attestations(oauth_provider) WHERE is_active = 1
  (apenas uma attestation ativa por provider)

**2. Comando devprofile identity link em packages/cli/src/commands/identity.ts**

Subcomandos:
  - link --provider github  → executa OAuth flow + persiste
  - show                    → mostra attestation ativa (se houver)
  - unlink                  → desativa attestation ativa (sem deletar)

Flow do link:
  1. Carregar dev_public_key do storage local
  2. Iniciar servidor HTTP local efêmero em porta aleatória (40000-50000)
  3. Construir URL OAuth:
     https://github.com/login/oauth/authorize?client_id=...&redirect_uri=http://localhost:PORT/callback&scope=read:user
  4. Abrir navegador (use `open` npm pkg cross-platform)
  5. Aguardar callback em /callback (timeout 5min, exit 1 se vencer)
  6. Receber ?code=... ou ?error=...
     - error → exit 1 com mensagem clara
     - code → seguir
  7. POST backend /attestation/issue com {oauth_provider, oauth_code,
     redirect_uri, dev_public_key}
  8. Receber attestation
  9. Persistir em identity_attestations (desativar anteriores do mesmo provider)
  10. Fechar servidor HTTP
  11. Output:

     ┌─ Identidade vinculada ────────────────────────────────┐
     │                                                       │
     │  Provider:    GitHub                                  │
     │  Usuário:     octocat                                 │
     │  Atestada em: 2026-05-20T14:00:00Z                    │
     │                                                       │
     │  A partir do próximo snapshot, seus bundles incluirão │
     │  essa attestation. Bundles anteriores não mudam.      │
     │                                                       │
     └───────────────────────────────────────────────────────┘

Show:
  - Sem attestation ativa: "Nenhuma identidade vinculada. Use
    `devprofile identity link --provider github` pra vincular."
  - Com: exibe os campos da attestation ativa em layout compacto

Unlink:
  - Confirma: "Desvincular GitHub @octocat? Bundles futuros sairão como
    identity_unverified. [y/N]"
  - Se y, set is_active = 0
  - Bundles passados não são afetados (já estão assinados)

### O que NÃO implementar

- Refresh automático de attestation — uma attestation vale "pra sempre"
  até unlink ou revoke
- Múltiplos accounts GitHub simultâneos — uma attestation ativa por
  provider
- Suporte a GitHub Enterprise — fase futura
- UI alternativa pra ambientes sem browser (SSH, headless) — esse fluxo
  via device code grant vem em fase futura

### Testes em packages/cli/tests/commands/test_identity.ts

- test_link_happy_path_persists_attestation
- test_link_user_denies_returns_error
- test_link_callback_timeout_returns_error
- test_link_replaces_existing_active_attestation
- test_show_with_active_renders_layout
- test_show_without_active_prints_help_message
- test_unlink_with_confirmation_deactivates
- test_unlink_without_confirmation_aborts

Mockar:
- Servidor HTTP de callback (simular GitHub redirect com code/error)
- Endpoint POST /attestation/issue do backend

### Critério de conclusão

bun test packages/cli/tests/commands/test_identity.ts → todos passando
Manual: rodar devprofile identity link --provider github real, ver
  fluxo abrir browser, autorizar, retornar com attestation persistida
devprofile identity show exibe attestation ativa corretamente
devprofile identity unlink desativa sem deletar (verificar no DB)
```

---

## F5.6.3 — Bundle: seção identity + verifier attestation check

```
Atualize o payload do snapshot e o devprofile verify pra incluir a seção
identity com attestation, e checar essa attestation no verifier.

### Contexto

Bundle v2 ganha seção `identity` no payload. Se há attestation ativa, a
seção contém os dados completos. Se não, contém `{"verified": false}` apenas.

Verifier ganha um step adicional: validar a attestation contra o endpoint
de verify do backend. Falha de attestation NÃO invalida o bundle — apenas
muda o tier de confiança exibido.

### O que implementar

**1. Endpoint POST /snapshot/payload (atualização)**

Adicionar ao payload:

  "identity": {
    "verified": true,
    "github_username": "octocat",
    "attestation": {
      "attested_at": "2026-05-20T14:00:00Z",
      "public_key_fingerprint": "ed25519:sha256:fp_...",
      "platform_key_id": "devprofile-platform-2026-q2",
      "platform_signature": "ed25519:base64_signature..."
    }
  }

OU, sem identity link:

  "identity": {
    "verified": false
  }

Lógica:
- Engine consulta `SELECT * FROM identity_attestations WHERE is_active=1`
- Se há attestation, embute campos
- Se não, "verified": false

**2. devprofile verify — checagem de attestation**

Após validar assinatura Ed25519 + chain hash, executar:

  Se payload.identity.verified == false:
    Display: "✓ Identidade: não vinculada (anônimo)"
    Continuar.

  Se payload.identity.verified == true:
    1. Calcular fingerprint do payload.public_key (do bundle)
    2. Comparar com payload.identity.attestation.public_key_fingerprint
       - Mismatch → "✗ Attestation referencia chave diferente da que
                       assinou o bundle"
                  → marcar bundle como tampered_identity, continuar
    3. POST devprofile.app/api/attestation/verify com a attestation
       - Online: rede disponível
         - 200 valid=true && revoked=false → "✓ Identidade: @octocat (GitHub, verificada)"
         - 200 valid=true && revoked=true  → "⚠ Identidade: @octocat (GitHub, revogada em DATA)"
         - 200 valid=false                 → "✗ Identidade: attestation inválida"
       - Offline (timeout 3s, --offline flag, sem rede):
         - "ℹ Identidade: @octocat (GitHub, assinatura presente, não verificada online)"

**3. Tier de confiança**

Ao final do verify, exibir tier consolidado:

  ┌─ Tier de confiança ──────────────────────────────────────┐
  │                                                           │
  │  ✓ Assinatura Ed25519 válida                             │
  │  ✓ Chain hash íntegro                                    │
  │  ✓ Identidade GitHub verificada (online)                 │
  │  ⧖ Engine version: pendente (F5.7)                       │
  │  ⧖ Rekor inclusion: pendente (F5.8)                      │
  │                                                           │
  │  Tier: identity_verified                                  │
  │                                                           │
  └───────────────────────────────────────────────────────────┘

Tiers possíveis (ordem crescente de confiança):
  - corrupt              — assinatura ou chain hash inválido
  - signature_only       — Ed25519 ok, sem outras camadas
  - identity_verified    — Ed25519 + attestation verificada online
  - engine_verified      — + engine_version_hash bate (F5.7)
  - fully_verifiable     — + Rekor inclusion verificada (F5.8)

Ainda nesta fase (F5.6), bundles vão no máximo até identity_verified.

### O que NÃO implementar

- Cache de resultados de attestation/verify — sempre consultar online se
  tem rede (cache pode esconder revogação recente)
- Fallback offline com lista de attestations conhecidas — verifier offline
  apenas confirma presença da assinatura, não validade

### Testes

Em packages/engine/tests/test_snapshot_identity.py:
- test_payload_includes_identity_when_active_attestation
- test_payload_identity_verified_false_when_no_attestation
- test_payload_identity_picks_active_provider

Em packages/cli/tests/commands/test_verify_identity.ts:
- test_verify_renders_anonymous_identity_when_unverified
- test_verify_renders_verified_identity_when_online_valid
- test_verify_renders_revoked_when_attestation_revoked
- test_verify_renders_offline_warning_when_no_network
- test_verify_detects_fingerprint_mismatch
- test_verify_tier_signature_only_without_identity
- test_verify_tier_identity_verified_with_valid_attestation

### Critério de conclusão

Bundle gerado com identity link inclui seção identity completa
Bundle gerado sem identity link inclui identity.verified=false
devprofile verify identifica corretamente cada caso
Tier exibido bate com as camadas presentes
```

---

## F5.7.1 — Reproducible builds + engine_version_hash no bundle

```
Configure o pipeline de build do engine pra produzir binários
reproduzíveis e embuta o hash do binário no payload do snapshot.

### Contexto

Reproducible builds significa que o mesmo código-fonte + mesmo ambiente de
build produzem byte-a-byte o mesmo binário. Sem isso, o engine_version_hash
no payload não tem significado — qualquer build local geraria um hash
diferente.

PyInstaller não é reproducible-by-default. Requer ajustes: timestamps
fixados, ordem de arquivos determinística, sem ./build cache contaminando.

### O que implementar

**1. Build script reproducível em scripts/build-engine.sh**

  - Setar SOURCE_DATE_EPOCH (variável padrão pra builds reprodutíveis,
    usar timestamp do último commit do repo)
  - Limpar __pycache__, .pyc, build/, dist/ antes
  - PyInstaller com flags:
    - --noupx (UPX adiciona não-determinismo)
    - --strip (remove debug symbols)
    - --hidden-import seguro (sem detecção dinâmica)
  - Setar PYTHONHASHSEED=0 (determinismo do dict ordering)
  - Setar TZ=UTC
  - Ordenar arquivos de input lexicograficamente

  Validação: rodar o script 2x no mesmo commit, sha256 dos outputs deve
  ser idêntico.

**2. Pipeline GitHub Actions em .github/workflows/release.yml**

  - Job de build em ubuntu-22.04 (fixar versão exata, não latest)
  - Cache de dependências determinístico (lock files apenas, sem timestamps)
  - Após build, calcular SHA-256 do binário final
  - Salvar como artifact engine-{version}-linux-x64.bin
  - Salvar engine-{version}-hash.txt com o SHA-256
  - Comparar hash com o gerado em build anterior (se mesma tag) — fail
    se diferente

**3. Embedding do hash em packages/engine/src/version.py**

  Constante ENGINE_VERSION_HASH preenchida no build:
  - Build script lê SOURCE_DATE_EPOCH e gera arquivo version.py com:
    - ENGINE_VERSION = "0.4.0"
    - ENGINE_VERSION_HASH = "sha256:abc123..."  (calculado após build)
  - Para builds locais (dev), ENGINE_VERSION_HASH = "sha256:dev-{timestamp}"
    (não confunde com build oficial)

**4. Atualização do payload em packages/engine/src/main.py**

  Adicionar ao payload do snapshot:

    "engine_version": "0.4.0",
    "engine_version_hash": "sha256:abc123..."

  Vindo de version.py.

**5. Endpoint público GET /api/engine-versions em backend**

  Lista todas as versões oficiais conhecidas:

    {
      "versions": [
        {
          "version": "0.4.0",
          "hash": "sha256:abc123...",
          "released_at": "2026-05-25T...",
          "platform": "linux-x64"
        },
        ...
      ]
    }

  Backend mantém essa lista atualizada via release workflow (job que
  publica hash após release).

### O que NÃO implementar

- Cross-platform reproducibility — focar em linux-x64 nesta fase (macOS
  e Windows em fase futura, com builds separados)
- Verifier consultando GitHub Releases — verifier usa o endpoint do
  próprio DevProfile pra evitar dependência GitHub e poder rotacionar
  hashes em caso de bug crítico
- Comparação retroativa de hashes em builds antigos — confiar nos artifacts
  do CI

### Testes

Em scripts/tests/test_reproducible_build.sh:
- Rodar build 2x, comparar sha256 dos outputs

Em packages/engine/tests/test_payload_engine_version.py:
- test_payload_includes_engine_version_hash
- test_engine_version_hash_format_is_sha256_prefixed

Em packages/backend/tests/test_engine_versions_endpoint.py:
- test_engine_versions_endpoint_returns_list
- test_engine_versions_endpoint_supports_platform_filter

### Critério de conclusão

scripts/build-engine.sh executado 2x produz outputs com sha256 idêntico
CI verifica reproducibility em cada push
payload do snapshot inclui engine_version_hash correto
GET /api/engine-versions retorna o build atual após release
```

---

## F5.7.2 — Repo first_seen_at + cross-check opt-in vs GitHub

```
Adicione first_seen_at por repo no bundle e implemente cross-check
opt-in de root_commit_hashes contra GitHub API no verifier.

### Contexto

first_seen_at é o timestamp em que o DevProfile primeiro processou um
repositório. É uma âncora externa fraca (autoreportada), mas combinada
com o cross-check de root_commit_hashes contra GitHub público, dá uma
âncora forte: "esse repo existe no GitHub, esse hash de root commit
está lá, e o DevProfile vê esse repo desde X."

Cross-check é OPT-IN no verifier (--check-github) porque introduz
dependência de rede e potencial rate limit do GitHub.

### O que implementar

**1. Migration em packages/engine/src/storage/sqlite.py**

Adicionar coluna em `l1_repositories`:
  - first_seen_at TEXT NOT NULL DEFAULT (datetime('now'))

Backfill: para repos existentes sem first_seen_at, usar imported_at.

**2. Atualização do payload em packages/engine/src/main.py**

Mudar `l1.root_commit_hashes` de lista plana pra lista de objetos:

  Antes:
    "root_commit_hashes": ["a3f8c1d2...", "b7e2a9f1..."]

  Agora:
    "repos": [
      {
        "root_hash": "a3f8c1d2...",
        "first_seen_at": "2026-04-15T...",
        "commit_count": 421,
        "earliest_commit": "2024-03-04T..."
      },
      ...
    ]

  Manter `root_commit_hashes` como campo derivado (lista de só hashes)
  pra retrocompatibilidade — ou marcar deprecated se versão bumpar.

**3. Verifier --check-github em packages/cli/src/commands/verify.ts**

  Flag opt-in: devprofile verify <bundle> --check-github

  Para cada repo em payload.l1.repos:
    1. GET https://api.github.com/search/commits?q=hash:{root_hash}
       (precisa de Accept header pra essa API)
    2. Match cases:
       - Encontrou ao menos um repo público com esse root commit → ✓
       - Não encontrou → ⚠ "root_hash não encontrado em repos públicos"
       - Erro de API (rate limit, network) → ℹ "verificação não pôde
         ser feita"

  Output adicional após o check:

    ┌─ Cross-check de repositórios (GitHub) ────────────────┐
    │                                                       │
    │  ✓ 8 root commits confirmados em repos públicos       │
    │  ⚠ 1 root commit não encontrado:                      │
    │     a3f8c1d2...                                       │
    │     (pode ser repo privado, fork não público, ou      │
    │      hash inválido)                                   │
    │  ℹ 3 não verificados (rate limit do GitHub API)       │
    │                                                       │
    └───────────────────────────────────────────────────────┘

  Importante: ⚠ NÃO invalida o bundle. Repos privados são legítimos.
  Apenas eleva confiança quando confirmado.

  Performance: paralelizar até 10 requests simultâneos com rate limit
  awareness (GitHub: 60/hora unauth, 5000/hora com token via
  GITHUB_TOKEN env).

### O que NÃO implementar

- Verificação automática em CI ou diretório (servidor) — apenas opt-in
  do verifier
- Suporte a GitLab/Bitbucket no cross-check — fase futura
- Cache local de resultados — sempre consultar em tempo real

### Testes

Em packages/engine/tests/test_l1_repos_payload.py:
- test_payload_repos_includes_first_seen_at
- test_payload_repos_includes_commit_count
- test_payload_root_commit_hashes_remains_for_compat

Em packages/cli/tests/commands/test_verify_github_check.ts:
- test_check_github_confirms_existing_repos
- test_check_github_flags_not_found
- test_check_github_handles_rate_limit_gracefully
- test_check_github_respects_offline_mode
- test_check_github_uses_github_token_when_available

Mockar GitHub API.

### Critério de conclusão

Migration aplica sem erro, repos existentes ganham first_seen_at backfilled
Payload novo inclui l1.repos[] com estrutura completa
devprofile verify --check-github funciona em bundle real, identifica
  repos públicos corretamente
Comportamento sob rate limit é gracioso (não falha verify)
```

---

## F5.8.1 — Sigstore Rekor: integração no snapshot + retry

```
Integre Sigstore Rekor como log público append-only — toda geração de
snapshot publica o hash do bundle no Rekor e embute a inclusion proof
no próprio bundle.

### Contexto

Rekor é a infraestrutura pública de transparency log do projeto Sigstore
(OpenSSF). Recebe entries que são apenas hashes + assinaturas + metadata,
mantém um Merkle tree append-only, e dá inclusion proofs verificáveis.

URL: https://rekor.sigstore.dev (produção)
URL dev/teste: https://rekor.sigstage.dev (staging com mesmas APIs)

Cada `devprofile snapshot` POSTa o bundle no Rekor depois de assinar.
A resposta inclui inclusion proof que é embutido no payload do próximo
bundle (não no atual — chain hash protege isso).

Na verdade, esquema mais simples: o `log_inclusion` fica em campo top-level
do bundle, FORA do payload (porque é adicionado APÓS o payload ser assinado).
Bundle assinado → POST Rekor → response embutido em `log_inclusion`.
Verifier checa que `log_inclusion.body.kind=hashedrekord` contém o mesmo
`payload.hash` do bundle.

### O que implementar

**1. Cliente Rekor em packages/engine/src/rekor/client.py**

  Função submit_bundle_to_rekor(
      payload_hash: bytes,
      signature: bytes,
      public_key: bytes,
  ) -> RekorEntry

  Constrói o entry no formato Rekor v0.0.1 hashedrekord:
    {
      "apiVersion": "0.0.1",
      "kind": "hashedrekord",
      "spec": {
        "data": {
          "hash": {"algorithm": "sha256", "value": "<hex>"}
        },
        "signature": {
          "content": "<base64>",
          "publicKey": {"content": "<base64-pem>"}
        }
      }
    }

  POST https://rekor.sigstore.dev/api/v1/log/entries
  Headers: Accept: application/json, Content-Type: application/json

  Response 201:
    {
      "<entry_uuid>": {
        "logIndex": 12345678,
        "integratedTime": 1716210000,
        "logID": "c0d23d6ad406973f9559f3ba2d1ca01f84147d8ffc5b8445c224f98b9591801d",
        "verification": {
          "signedEntryTimestamp": "...",
          "inclusionProof": {
            "logIndex": 12345678,
            "rootHash": "...",
            "treeSize": 12345679,
            "hashes": [...]
          }
        }
      }
    }

  Retorna RekorEntry dataclass com todos os campos relevantes.

  Timeout: 10s. Em outage, lançar RekorUnavailableError.

**2. Atualização de packages/engine/src/main.py /snapshot/finalize**

  Após assinar o bundle:
    1. Calcular payload_hash (já existe)
    2. Submit ao Rekor
    3. Se sucesso, embutir em bundle.log_inclusion (top-level, FORA do payload):

       "log_inclusion": {
         "log_id": "rekor.sigstore.dev",
         "entry_uuid": "24296fb24b8ad77a...",
         "log_index": 12345678,
         "integrated_time": "2026-05-20T14:00:02Z",
         "tree_size": 12345679,
         "inclusion_proof": {
           "log_index": 12345678,
           "root_hash": "...",
           "hashes": [...]
         },
         "signed_entry_timestamp": "..."
       }

    4. Se RekorUnavailableError, embutir:

       "log_inclusion": {
         "status": "pending",
         "attempted_at": "2026-05-20T14:00:00Z",
         "retry_scheduled": true
       }

       E enfileirar retry assíncrono (próximo prompt).

  Bundle é gravado com log_inclusion populado (ou pending).

**3. Retry assíncrono de Rekor pending**

  Em packages/engine/src/rekor/retry.py:

  Background task (rodar via FastAPI BackgroundTasks ou um scheduler
  simples):
  - A cada 5 min, busca bundles com log_inclusion.status == "pending"
    (lista mantida em ~/.devprofile/rekor-pending.jsonl)
  - Tenta submit novamente
  - Sucesso → reescreve o bundle (mesmo path) com log_inclusion completo
    e remove da pending list
    NOTA: reescrever bundle é OK porque a assinatura cobre só o payload,
    não o log_inclusion. Hash do payload e signature permanecem idênticos.
  - Falha → permanece na pending list

  Bundle pode permanecer "pending" indefinidamente sem invalidar nada;
  apenas fica num tier inferior de confiança no verifier.

### O que NÃO implementar

- Rekor self-hosted — usar instância pública (custo zero)
- Notificação ao usuário sobre retry sucesso — log silencioso
- Garbage collection de entries antigas — Rekor é append-only, não
  deletamos nada
- Suporte a outras transparency logs (CT logs, etc) — Rekor only

### Testes em packages/engine/tests/test_rekor_integration.py

- test_submit_bundle_returns_entry_with_inclusion_proof
- test_submit_bundle_constructs_correct_hashedrekord_format
- test_submit_bundle_timeout_raises_unavailable_error
- test_snapshot_embeds_log_inclusion_on_success
- test_snapshot_embeds_pending_status_on_rekor_outage
- test_retry_reattempts_pending_bundles
- test_retry_rewrites_bundle_with_log_inclusion_on_success
- test_retry_preserves_payload_hash_and_signature

Mockar Rekor com responses fixtures + simular timeout.

### Critério de conclusão

Bundle real submetido a rekor.sigstage.dev (staging) é aceito
log_inclusion embutido no bundle válido
Outage simulado (timeout) gera bundle com status pending
Retry após outage reescreve bundle com log_inclusion completo,
  payload_hash e signature permanecem idênticos
```

---

## F5.8.2 — Verifier: Rekor inclusion check + integrated_time + transparency page

```
Atualize devprofile verify pra checar inclusion proof do Rekor, validar
integrated_time, e exibir o tier de confiança final. Adicione página
pública de transparência no backend.

### Contexto

Com Rekor integrado na geração (F5.8.1), o verifier precisa validar a
inclusion proof e fazer sanity check entre integrated_time (do Rekor) e
created_at (do payload). Esses checks são opt-in via flag (---check-rekor)
ou padrão se há rede — verifier offline ainda funciona pros checks locais.

Backend ganha uma página /transparency lista as entries recentes da
plataforma no Rekor, pra dar visibilidade pública (build trust through
visibility).

### O que implementar

**1. Verificação de inclusion proof em packages/cli/src/commands/verify.ts**

  Fluxo do verify, após checks locais e identity:

  Se bundle.log_inclusion ausente:
    Display: "⚠ Rekor inclusion: ausente (bundle não publicado no log público)"
    Tier máximo: identity_verified

  Se bundle.log_inclusion.status == "pending":
    Display: "ℹ Rekor inclusion: pendente (geração offline ou Rekor indisponível
                no momento da criação)"
    Tier máximo: identity_verified

  Se bundle.log_inclusion completo:
    1. Verificar inclusion proof localmente:
       - Reconstruir o hash da entry usando os hashes da Merkle path
       - Comparar com bundle.log_inclusion.inclusion_proof.root_hash
       - Match → proof estruturalmente válida
       - Mismatch → "✗ Rekor inclusion proof inválida (provavelmente forjada)"
                    Bundle marcado tampered_log_inclusion, tier rebaixa pra
                    corrupt
    2. (Online) Buscar entry no Rekor pra confirmar root_hash atual:
       - GET https://rekor.sigstore.dev/api/v1/log/entries/{entry_uuid}
       - Comparar entry retornada com o que está no bundle
       - Match → online verified
       - Mismatch → "✗ Entry no Rekor não bate com inclusion no bundle"

    3. Sanity check integrated_time:
       - rekor_time = bundle.log_inclusion.integrated_time
       - bundle_time = bundle.payload.created_at
       - Se rekor_time < bundle_time: "✗ Backdating detectado
         (Rekor registrou bundle ANTES de sua data de criação declarada)"
         Bundle marcado backdated, tier rebaixa.
       - Se rekor_time - bundle_time > 1 hora: "⚠ Atraso suspeito entre
         criação e publicação no Rekor (X horas)"
         Não rebaixa tier, mas sinaliza.

  Display final:

    ┌─ Rekor (log público append-only) ─────────────────────┐
    │                                                       │
    │  ✓ Inclusion proof válida                             │
    │  ✓ Entry confirmada no log público                    │
    │  ✓ Timestamps consistentes                            │
    │                                                       │
    │  Entry: rekor.sigstore.dev/api/v1/log/entries/        │
    │         24296fb24b8ad77a...                           │
    │  Log index: 12345678                                  │
    │  Registrado em: 2026-05-20T14:00:02Z                  │
    │                                                       │
    └───────────────────────────────────────────────────────┘

**2. Tier de confiança final (consolidação dos prompts anteriores)**

  Lógica de cálculo do tier final no verify:

  if corrupt_signature or corrupt_chain or corrupt_log_inclusion or backdated:
      tier = "corrupt"
  elif rekor_verified_online and engine_verified and identity_verified:
      tier = "fully_verifiable"
  elif engine_verified and identity_verified:
      tier = "engine_verified"
  elif identity_verified:
      tier = "identity_verified"
  else:
      tier = "signature_only"

  Display final do verify (depois de todas as seções):

    ┌─ Tier de confiança ───────────────────────────────────┐
    │                                                       │
    │  Resultado: fully_verifiable                          │
    │                                                       │
    │  Camadas verificadas:                                 │
    │  ✓ Assinatura Ed25519                                 │
    │  ✓ Chain hash dos snapshots                           │
    │  ✓ Identidade GitHub (@octocat)                       │
    │  ✓ Engine version (build oficial 0.4.0)               │
    │  ✓ Rekor inclusion (log público)                      │
    │                                                       │
    │  Este bundle representa o estado mais alto de         │
    │  verificação que o DevProfile oferece. Significa que  │
    │  o bundle não foi alterado, foi assinado por uma      │
    │  identidade real, produzido por engine oficial, e     │
    │  publicado em log público append-only no momento de   │
    │  geração.                                             │
    │                                                       │
    │  O DevProfile NÃO afirma que os dados do bundle são   │
    │  honestos — apenas que cada camada técnica de prova   │
    │  está válida. Veja signal_quality no payload para     │
    │  flags de qualidade de sinal.                         │
    │                                                       │
    └───────────────────────────────────────────────────────┘

  IMPORTANTE: o texto explicativo no tier "fully_verifiable" precisa
  manter a postura testemunha-não-juiz. Nunca dizer "este dev é
  confiável". Sempre dizer "estas camadas técnicas estão válidas".

**3. Página de transparência em packages/backend/src/main.py**

  GET /transparency

  Response (HTML ou JSON via Accept header):

  HTML render com lista das últimas 200 entries da plataforma no Rekor:
    - Entry UUID (truncated + link)
    - Log index
    - Integrated time
    - Public key fingerprint (não nome, não github username)

  Backend mantém esse cache via background job que polla o Rekor
  procurando entries que usam o padrão de assinatura DevProfile (ed25519
  com fingerprint registrado).

  No corpo da página, texto explicativo:

  > Este log é uma cópia parcial de entries no Rekor pública relacionadas
  > a bundles do DevProfile. Você pode verificar qualquer entry diretamente
  > em rekor.sigstore.dev. O DevProfile não controla o Rekor — é
  > infraestrutura pública mantida pelo projeto Sigstore (OpenSSF).

### O que NÃO implementar

- Notificações de inclusion confirmada — assíncrono, silencioso
- Detalhes individuais por entry na página /transparency — apenas lista
- Filtros / busca na página de transparência — fase futura se houver demanda

### Testes

Em packages/cli/tests/commands/test_verify_rekor.ts:
- test_verify_inclusion_proof_locally_validates
- test_verify_inclusion_proof_invalid_marks_corrupt
- test_verify_online_check_confirms_entry
- test_verify_backdating_detected_when_integrated_before_created
- test_verify_delay_suspicious_warned_when_more_than_1h
- test_verify_pending_status_shows_neutral_message
- test_verify_offline_skips_online_rekor_check_gracefully
- test_tier_fully_verifiable_with_all_layers
- test_tier_corrupt_when_backdated
- test_tier_signature_only_without_identity_or_rekor

Em packages/backend/tests/test_transparency_page.py:
- test_transparency_returns_html_by_default
- test_transparency_returns_json_when_accept_json
- test_transparency_lists_recent_entries
- test_transparency_redacts_personal_info

### Critério de conclusão

Bundle real (full pipeline) com todas as camadas chega ao tier
  fully_verifiable no verifier
Bundle com backdating simulado é detectado e marcado corrupt
Bundle gerado offline (sem Rekor) atinge no máximo identity_verified
Página /transparency lista entries reais do Rekor da plataforma
Texto do tier fully_verifiable passa pelo filtro R2D2 (não afirma
  honestidade dos dados, só validade técnica das camadas)
```

---

## Checklist final da Fase 5 estendida

Antes de marcar o pacote como release-ready:

```
[ ] F5.6.1 — Backend OAuth GitHub funcional, chave da plataforma carregada,
              endpoints /attestation/issue e /verify operacionais
[ ] F5.6.2 — devprofile identity link com GitHub funciona ponta-a-ponta,
              attestation persistida em profile.db
[ ] F5.6.3 — Bundle inclui seção identity, verifier valida attestation
              online e mostra tier identity_verified
[ ] F5.7.1 — Build script produz binário reproducível (sha256 idêntico
              em 2 builds), engine_version_hash no payload
[ ] F5.7.2 — Payload tem l1.repos[] com first_seen_at, verifier
              --check-github valida root hashes
[ ] F5.8.1 — Rekor integration funcional, bundles publicados, retry
              assíncrono trata outages
[ ] F5.8.2 — Verifier valida inclusion proof e integrated_time, tier
              fully_verifiable atingível com todas as camadas
[ ] Smoke test ponta-a-ponta: dev faz init + identity link + snapshot,
     bundle gerado tem todas as 5 camadas, verify externo (de outra máquina)
     atinge tier fully_verifiable
[ ] Verifier offline ainda funciona (degradação graciosa)
[ ] Página /transparency lista entries reais
[ ] Todas as copies dos tiers passam pelo filtro R2D2 — nenhuma afirma
     "esse dev é bom", só relatam camadas técnicas
[ ] Versão bumped: v0.5.0
```

Pronto pra tag v0.5.0 quando todos os 11 itens marcados.

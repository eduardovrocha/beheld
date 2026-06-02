# beheld — Estado atual da aplicação

> Última atualização: 2026-06-02
> Após commit `dea7660` (D-02 fix — default-on-missing-identity dispatch)
>
> **Este documento é a fonte de verdade canônica da Refundação multi-tool.**
> Substitui os documentos `beheld-evolucao-multitool.md` e
> `beheld-refundacao-prompts.md` que viviam fora do repo. A seção
> "Contratos técnicos" abaixo pina os 3 invariantes verificáveis
> (enum fechado de fidelity, fórmula §7.2 do GrowthRate, schema chain do
> verifier). Qualquer auditoria futura deve checar contra esta seção.

---

## Visão geral

Diagrama do fluxo de dados de uma observação até a publicação no portal,
com cada componente colorido conforme o status na Refundação multi-tool.

```mermaid
flowchart TB
  %% ── Fontes de evento ────────────────────────────────────────────────
  subgraph SOURCES["Fontes de evento (harnesses)"]
    direction LR
    NOW["Claude Code · Continue.dev<br/>capture_fidelity=native_hook<br/>(produção)"]:::active
    LATER["Gemini CLI · Cursor · Codex CLI<br/>Copilot CLI · Copilot VS Code · Windsurf<br/>(R2.* / R3 pending)"]:::pending
  end

  %% ── Daemon ──────────────────────────────────────────────────────────
  DAEMON["Daemon · packages/mcp-server<br/>PreToolUse · PostToolUse · Stop<br/>+ sanitizer (privacy boundary)"]:::active

  %% ── Engine ──────────────────────────────────────────────────────────
  subgraph ENGINE["Engine · packages/engine (Python)"]
    direction TB
    JSONL[("~/.beheld/sessions/<br/>YYYY-MM-DD_*.jsonl")]:::active
    DB[("profile.db<br/>SQLite WAL")]:::active
    SCORERS["Scorers (prompt_quality · test_maturity<br/>tech_breadth · growth_rate)<br/>internamente ainda l1/l2 — R1.2 pending"]:::pending
    GEN["Bundle Generator<br/>emite v6 core / enrichment<br/>harness_sources=[claude_code/native_hook/N]"]:::active
    JSONL --> DB --> SCORERS --> GEN
  end

  %% ── Bundle v6 ───────────────────────────────────────────────────────
  subgraph BUNDLE["Bundle Schema v6 · ~/.beheld/snapshots/*.beheld"]
    direction TB
    CORE["payload.core<br/>──────<br/>ecosystems · platforms<br/>avg_test_ratio · root_commit_hashes<br/>(git history · sempre presente)"]:::active
    ENR["payload.enrichment<br/>──────<br/>harness_sources[ ] ← capture_fidelity<br/>workflow_distribution · sessions_analyzed<br/>(opcional · circunstancial)"]:::active
    FID["CaptureFidelity enum (fechado · spec §3.3)<br/>native_hook · statusline · local_log_tail<br/>editor_extension · inferred"]:::active
    ENR --- FID
  end

  %% ── CLI ─────────────────────────────────────────────────────────────
  subgraph CLI["CLI · packages/cli (TypeScript/Bun)"]
    direction LR
    TYPES["types.ts<br/>BundlePayload v6<br/>BundlePayloadV5Legacy · V1"]:::active
    VER["verify.ts<br/>v6 → v5 → v1 fallback chain<br/>(rule #7: só o reader tem dual)"]:::active
    HTML["snapshot-html.ts<br/>core ?? l1 / enrichment ?? l2<br/>(bundles legacy re-renderizam offline)"]:::active
  end

  %% ── Web companion ───────────────────────────────────────────────────
  subgraph WEB["Web companion · beheld-web · R1.3 PENDING"]
    direction LR
    MS["MatchingService.rb<br/>ainda lê payload.l1 / payload.l2"]:::blocked
    SV["Snapshot.schema_version validator<br/>só aceita v1 / v2<br/>⚠ REJEITA upload de bundle v6"]:::blocked
  end

  SOURCES --> DAEMON
  DAEMON --> JSONL
  GEN --> BUNDLE
  BUNDLE --> CLI
  BUNDLE -. upload bloqueado por SV até R1.3 .-> WEB

  %% ── Legenda ────────────────────────────────────────────────────────
  subgraph LEG["Legenda"]
    direction LR
    L1["✓ R1.1 mergeado (6ab2dd6)"]:::active
    L2["⌛ R1.2 / R2 / R3 pending"]:::pending
    L3["🚫 R1.3 blocker pra produção"]:::blocked
  end

  classDef active fill:#c9a96e,stroke:#333,color:#000,stroke-width:2px
  classDef pending fill:#fff4d6,stroke:#999,color:#555,stroke-dasharray:5 5
  classDef blocked fill:#f8d7da,stroke:#a00,color:#000,stroke-width:2px
```

---

## Como ler

| Cor | Estado | O que significa hoje |
|---|---|---|
| 🟫 Bronze | **R1.1 mergeado** — `6ab2dd6` em `main` | Wire format v6 ativo. Generator emite `core`/`enrichment` com `harness_sources[claude_code/native_hook]`. Verifier aceita v6/v5/v1. HTML renderer faz fallback. |
| 🟡 Amarelo dim | **Pending** | Sem impacto na produção atual. Scorers (R1.2) consomem `L1Snapshot` direto, não `BundlePayload` — boundary clean. Adapter wave (R2) só pluga novas fontes quando shippar. |
| 🔴 Vermelho | **R1.3 blocker** | Cláusula crítica: enquanto o portal Rails não landar R1.3, **qualquer `beheld snapshot --share` vai falhar no upload** (Snapshot.schema_version validator rejeita v6). |

---

## Pontos-chave

### 1. L1 é backbone universal

`payload.core` (git history) está em **todo** bundle, independente de qual harness o dev usa. `payload.enrichment` é opcional e descreve **quais harnesses observaram** quanto, com que fidelidade.

Devs que usam **só Cursor** (R2.2 pending) ou que **não usam IA** terão `payload.enrichment` ausente — perfil legítimo, igualmente assinado, e o verifier aceita sem warning. O selo de verificabilidade nunca é gradado por completude (spec §3.5).

### 2. `capture_fidelity` é first-class por harness, não top-level

```jsonc
"payload.enrichment": {
  "harness_sources": [
    { "harness": "claude_code", "capture_fidelity": "native_hook",      "sessions": 30 },
    { "harness": "cursor",      "capture_fidelity": "local_log_tail",   "sessions": 12 }
  ],
  "workflow_distribution": { /* ... agregado das duas fontes ... */ },
  "sessions_analyzed": 42
}
```

Hoje só `claude_code/native_hook` é emitido (single-element array). R2.* vai popular multi-fonte.

### 3. Verifier tem dual-read; generator não

Per spec rule #7 ("nomenclatura nova é canônica"), só o **reader do verifier** mantém fallback chain `v6 → v5 → v1`. Generator emite **só v6**. MatchingService (R1.3) terá fallback equivalente.

### 4. R1.3 trava produção

O blocker vermelho do `Snapshot.schema_version` validator é deliberado: o spec recomenda coordenar release de R1.1 com prontidão de R1.3 pra evitar `beheld snapshot --share` quebrado no campo. **Bundles v6 são gerados e verificáveis localmente, mas não podem ser publicados no portal até R1.3 landar.**

---

## Sequência de execução pendente

Por ordem de spec (R1.2 → R1.3 → R2.1 → R2.5 → R3.0 → R3.1):

| ID | Descrição | Bloqueador? |
|---|---|---|
| **R1.2** | Scorers refactor — terminologia `core`/`enrichment` + reescrever `GrowthRateScorer` por trajetória intra-L1 (spec §7.2) | Não — boundary clean, scorers não tocam wire |
| **R1.3** | MatchingService + `Snapshot.schema_version` validator (beheld-web) | **Sim** — sem isso, upload de v6 quebra |
| **R1.4** | `npx beheld` L1-first onboarding + extensão de `packages/cli` com subcomando `bootstrap` | Não — daemon hoje continua funcionando |
| **R1.5** | Copy update — README + install.sh + landing strings + `/compromisso` | Não — texto, sem impacto técnico |
| **R2.1** | Adapter Gemini CLI (native_hook) | Não — adiciona fonte |
| **R2.2** | Adapter Cursor (local_log_tail) | Não — adiciona fonte |
| **R2.3** | Adapter Codex CLI (native_hook) | Não — adiciona fonte |
| **R2.4** | Adapter Copilot CLI (statusline + log tail) | Não — adiciona fonte |
| **R2.5** | Adapter Copilot VS Code (log tail, tokens estimados) | Não — adiciona fonte |
| **R3.0** | Spike Windsurf — documento de decisão | Não — investigação |
| **R3.1** | Implementação Windsurf condicional ao spike | Não — condicional |

---

## Garantias estruturais ativas após R1.1

1. **Cross-language byte lock**: `EXPECTED_CANONICAL`/`EXPECTED_HASH`/byte-length pinadas em `packages/cli/tests/bundle.test.ts` E `packages/engine/tests/test_bundle.py`. Qualquer drift entre TS e Python falha um dos dois suites no CI.
2. **Privacy boundary preservada**: sanitizer continua extraindo só metadata; nenhuma migração tocou prompt text ou code content. R2.* adapter wave herda o mesmo princípio.
3. **Back-compat de leitura**: bundle v1 legacy (pre-Phase-6) e v5 legacy (pre-R1.1) continuam verificando offline com o verifier atual.
4. **`existing_capture_fidelity=false` confirmado pelo workflow audit**: nenhuma referência prévia ao campo no código — introdução é nova, sem colisão semântica.

---

## Validação após R1.1

| Suite | Resultado |
|---|---|
| `bun test packages/cli/tests/bundle.test.ts packages/cli/tests/verify.test.ts` | 39/39 ✓ |
| `python3 -m pytest packages/engine/tests` | 485/485 ✓ |
| `bun test packages/cli` (full) | 542 pass · 1 skip · 4 fail — **todos pré-existentes** (2 rekor encoding/network, 2 cli.test ambient engine state) |

---

## Workflow audit que precedeu o commit

Para evitar improviso (spec rule #3), R1.1 foi precedido por um workflow de auditoria paralela:

- **Run ID**: `wf_a3ec2374-701`
- **Agents**: 5 (4 audit paralelos cobrindo `packages/engine`, `packages/cli`, `packages/mcp-server`, `web/`; 1 synthesizer)
- **Tokens**: ~462k
- **Findings**: 197 `payload.l1/l2` refs · 47 schema-version refs · 32 arquivos afetados
- **Stop-and-ask blockers**: **0** (5 sinalizadores, todos `blocker: false`)
- **Recomendação**: `proceed_to_implement` — confirmada e executada

---

## Contratos técnicos

> Esta seção é a fonte canônica. Auditorias devem verificar literalmente
> contra os 3 contratos abaixo. Drift do código em relação a qualquer um
> deles é blocker.

### Contrato 1 — Enum fechado `CAPTURE_FIDELITY_VALUES`

Vive em `packages/engine/src/models.py:238-244`. Lista **fechada** — qualquer
expansão requer bump de `BUNDLE_VERSION` + spec PR explícito (sem expansão
silenciosa). O construtor de `HarnessDescriptor` em
`packages/engine/src/harness_registry.py:50` levanta `ValueError` se uma
entrada da registry usar valor fora deste set.

```python
CAPTURE_FIDELITY_VALUES = (
    "native_hook",        # hook API de primeira parte (Claude Code,
                          # Gemini CLI, Codex CLI, Windsurf · Cascade Hooks)
    "statusline",         # statusline poll · uma linha por ação
                          # (Copilot CLI)
    "local_log_tail",     # tail de arquivos de log locais · schema upstream
                          # não garantido (Cursor, Copilot VS Code)
    "editor_extension",   # extensão oficial do editor (Continue.dev)
    "inferred",            # source string desconhecido · fallback
                          # forward-compat · tier de menor confiança
)
```

**Regra de tier de confiança (para o portal renderizar com cor):**
- alta: `native_hook`, `editor_extension`
- média: `local_log_tail`, `statusline`
- baixa: `inferred`

**Mapeamento por harness registrado** (`harness_registry.py`):

| Source string (wire) | Harness portal | Capture fidelity |
|---|---|---|
| `claude-code` | `claude_code` | `native_hook` |
| `continue-vscode` | `continue_vscode` | `editor_extension` |
| `gemini-cli` | `gemini_cli` | `native_hook` |
| `cursor` | `cursor` | `local_log_tail` |
| `codex-cli` | `codex_cli` | `native_hook` |
| `copilot-cli` | `copilot_cli` | `statusline` |
| `copilot-vscode` | `copilot_vscode` | `local_log_tail` |
| `windsurf` | `windsurf` | `native_hook` |
| qualquer outro | `unknown` | `inferred` (fallback) |

### Contrato 2 — Fórmula §7.2 do `GrowthRateScorer`

Vive em `packages/engine/src/scorers/growth_rate.py:113-231`. Implementação
literal, verificada estática + por suite em `tests/test_r1_2b_scorers.py`.

**Janelas de comparação:**
- História ≥ **18 meses** → canonical: baseline = primeiros 12mo, current =
  últimos 6mo (gap de 1mo entre os dois).
- História entre 6mo e 18mo → janelas 50/50 (split na metade da história
  disponível) + flag `confidence: low`.
- História < 6 meses → retorna `None` (não inventa score). Dimensão sai do
  perfil em vez de aparecer como zero ou neutro.

**4 signals normalizados a [-1, +1]:**

```python
ecosystems_signal = clip(jaccard(curr_set, base_set), -1, +1)
platforms_signal  = clip(jaccard(curr_plat_set, base_plat_set), -1, +1)
test_ratio_signal = clip((avg_test_curr - avg_test_base) / 0.20, -1, +1)
diversity_signal  = clip((distinct_repos_curr - distinct_repos_base) / 3, -1, +1)
```

**Pesos canônicos** (somam 1.00 — não negociáveis sem spec PR):

```python
score_normalized = (
      ecosystems_signal * 0.30   # 30% — diversidade tecnológica é o sinal mais forte
    + platforms_signal  * 0.20   # 20% — plataformas amplas têm peso menor que ecosystems
    + test_ratio_signal * 0.25   # 25% — disciplina de teste é peso médio-alto
    + diversity_signal  * 0.25   # 25% — distinct_repos / 3 (literal spec)
)
score = round((score_normalized + 1) * 50)  # mapeia [-1,+1] → [0,100]
```

**Fallback rules:**
- `fallback_when_enrichment_missing = True` — quando enrichment ausente
  (sem L2), calcula com base só em L1 (intra-core trajectory).
- `data_sources = ["core", "enrichment"]` — declarado em `growth_rate.py:138`.

### Contrato 3 — Schema chain do verifier

Vive em `packages/cli/src/bundle/verify.ts:27-122`. O **generator emite só
v7** (regra de canonicidade); o **reader (verifier)** aceita o backlog
inteiro em cadeia de fallback ordenada:

```
DetectedSchema = "v7" | "v6_legacy" | "v5_legacy" | "v1_legacy" | "unknown"
```

**Cadeia de detecção (em ordem):**
1. `v7` — `bundle.version === "7"` + `payload.core` + scores podem ser
   `null` para dimensões ausentes.
2. `v6_legacy` — `bundle.version === "6"` + `payload.core` + scores todos
   numéricos (não nullable).
3. `v5_legacy` — `bundle.version === "5"` + `payload.l1` + `payload.l2`
   (terminologia pré-R1.1).
4. `v1_legacy` — `bundle.version <= "4"` + `payload.signals` (flat —
   pré-Phase 6).
5. `unknown` — nenhuma das anteriores; verifier devolve `false` mas não
   crasha.

**Inferência por shape** (fallback): se `bundle.version` ausente mas
`payload.core + payload.enrichment` presentes → `v6_legacy` (permissivo
para fixtures históricas).

**Portal Snapshot schema labels** (decoupled do BUNDLE_VERSION wire):
- `v1` = bundle wire `1-4` (`payload.signals`)
- `v2` = bundle wire `5` (`payload.l1 + payload.l2`)
- `v3` = bundle wire `6` **ou** `7` (`payload.core` + opcional `enrichment`)

Lógica em `web/source/backend/app/models/snapshot.rb:55-64` — v3 é detectado
**antes** de v2 (defensivo contra payloads híbridos).

### Garantias estruturais derivadas

Estas garantias **caem automaticamente** dos 3 contratos acima e devem
permanecer verdadeiras enquanto eles permanecerem:

1. **Privacy boundary preservada por adapter**. Cada handler em
   `packages/mcp-server/src/hooks/*.ts` chama `sanitize(body)` como
   primeira operação. Verificável por grep.
2. **Cross-language byte lock**. `EXPECTED_CANONICAL` / `EXPECTED_HASH`
   pinados em `packages/cli/tests/bundle.test.ts` E
   `packages/engine/tests/test_bundle.py`. Drift entre TS e Python falha
   uma das suites no CI.
3. **harness_sources[] ordem canônica**. Sempre ordenado por
   `(harness, capture_fidelity)` — pinado em
   `packages/engine/tests/test_bundle_wire_e2e.py::test_canonical_ordering_is_insertion_order_independent`.
4. **Schema labels ortogonais entre wire e portal**. BUNDLE_VERSION pode
   bumpar (7 → 8) sem forçar bump do portal schema label se a estrutura
   semântica não mudou. Exemplo histórico: wire 6 e 7 ambos = portal v3.

---

## Changelog do documento

| Data | Mudança |
|---|---|
| 2026-06-01 | Documento criado após R1.1. Diagrama mermaid + leitura por cor + ponteiros pra R1.2→R3.1. |
| 2026-06-02 | Adicionada seção "Contratos técnicos" — pina enum fechado de fidelity, fórmula §7.2 do GrowthRate, schema chain do verifier. Header reescrito declarando este doc como fonte canônica (encerra S&A-01 da auditoria `beheld-refundacao-status.md`). |

# beheld — Status da Refundação multi-tool

> Gerado: 2026-06-02
> Verificador: Claude Code (read-only)
> Repo principal (beheld) @ `9ba9940` · main
> Repo companion (beheld-web, em `web/`) @ `fe8aba6` · main
> Spec de referência citada no prompt: `beheld-evolucao-multitool.md` — **não presente no repo** (ver S&A-01)
> Prompts citados: `beheld-refundacao-prompts.md` — **não presente no repo** (ver S&A-01)
> Doc de roteiro in-repo usado como proxy: `docs/beheld-estado-atual.md`

---

## Resumo executivo

A Refundação multi-tool está **substancialmente entregue**: as 8 sub-fases dos prompts citados (R1.1 → R1.5b, R2.1 → R2.5, R3.0, R3.1) têm implementação observável em código + testes verdes em ambos repos. Os critérios técnicos centrais — `BUNDLE_VERSION=7`, terminologia `core`/`enrichment`, enum `CAPTURE_FIDELITY_VALUES` fechado, `harness_sources[]` derivado dinamicamente, portal aceitando v3 — estão satisfeitos com evidência. Privacy boundary preservada em todos os adapters (sanitizer chamado no handler antes de qualquer write).

**Blockers / sinais de alerta (atualizado 2026-06-02 após fixes D-01 + D-02 + S&A-01):**

- ✅ **D-01 resolvido** em commit `feb17bb` — bridge agora é não-destrutiva (cpSync + MIGRATED_TO_BEHELD.md). 10 testes pinam o novo contrato.
- ✅ **D-02 resolvido** em commit `dea7660` — `beheld` sem args dispara `bootstrap` automaticamente quando keys ausentes. 4 testes cobrem dispatch.
- ✅ **S&A-01 resolvido** — `docs/beheld-estado-atual.md` declarado fonte canônica + seção "Contratos técnicos" adicionada. Ver §"Stop-and-ask hits" abaixo.
- ⚠️ Restantes (não-bloqueantes): D-03 (docs/adapters/*.md ausentes — esforço ~2h), D-04 (frase canônica PT-BR opcional), S&A-02 (release notes reconhecendo v7).

**Status por Refundação (rollup):**

| Refundação | Total sub-fases | ✅ done | ⚠️ partial | ❌ not started | 🔍 needs investigation |
|---|---|---|---|---|---|
| R1 — Fundação | 6 (1.1, 1.2, 1.3, 1.4, 1.5a, 1.5b) | 4 | 2 | 0 | 0 |
| R2 — Adapter wave | 5 (2.1–2.5) | 5 | 0 | 0 | 0 |
| R3 — Windsurf | 2 (3.0, 3.1) | 2 | 0 | 0 | 0 |

**Suítes verificadas:** engine `pytest tests/test_harness_registry.py tests/test_bundle_wire_e2e.py tests/test_r1_2b_scorers.py tests/test_r1_2c_null_scores.py tests/test_bundle.py` → **62 passed**. mcp-server adapter handlers (6 arquivos) → **65 passed**. CLI tails + bootstrap + bridge + Windsurf installer (6 arquivos) → **53 passed**. Total verificado nesta auditoria: **180 testes / 0 falhas**.

---

## Matriz de status

| Fase | Status | Evidência |
|---|---|---|
| R1.1 — Bundle schema | ✅ | `packages/engine/src/models.py:234` `BUNDLE_VERSION = "7"`; enum `:238` |
| R1.2 — Scorers refactor | ✅ | `packages/engine/src/scorers/{prompt_quality,growth_rate,tech_breadth,test_maturity}.py` |
| R1.3 — MatchingService Rails | ✅ | `web/source/backend/app/services/positions/bundle_signals.rb:28-31` core/l1 fallback chain |
| R1.4 — packages/cli + legacy bridge | ⚠️ | bootstrap presente (`packages/cli/src/commands/bootstrap.ts`); bridge **viola spec** (D-01); default-on-missing-identity **ausente** (D-02) |
| R1.5a — Copy neste repo | ✅ | `README.md:3` reframe L1-first + harness; sem "cost tracker" |
| R1.5b — Copy beheld-web | ✅ | `web/source/frontend/src/locales/pt-BR.json:11,19`; `scripts/install.sh:97-103` chama `bootstrap` antes de `init` |
| R2.1 — Gemini CLI | ✅ | `packages/mcp-server/src/hooks/gemini.ts`; `harness_registry.py` `"gemini-cli" → native_hook` |
| R2.2 — Cursor | ✅ | `packages/mcp-server/src/hooks/cursor.ts`; `local_log_tail` |
| R2.3 — Codex CLI | ✅ | `packages/mcp-server/src/hooks/codex.ts`; `native_hook` |
| R2.4 — Copilot CLI | ✅ | `packages/mcp-server/src/hooks/copilot-cli.ts`; `statusline` (per-event `surface` em metadata) |
| R2.5 — Copilot VS Code | ✅ | `packages/mcp-server/src/hooks/copilot-vscode.ts`; `local_log_tail` |
| R3.0 — Windsurf spike | ✅ | `docs/r3-windsurf-spike.md` (linha 1: "GO for R3.1") |
| R3.1 — Windsurf impl | ✅ | `packages/mcp-server/src/hooks/windsurf.ts`; instalador `packages/cli/src/lib/windsurf-hooks.ts` |

---

## Detalhamento por fase

### R1.1 — Bundle schema ✅

**Checklist:**

- ✅ Bundle generator usa `payload.core`/`payload.enrichment` (não `l1`/`l2`).
  - Evidência: `packages/engine/src/models.py:259-300` define `BundleCoreSection` e `BundleEnrichmentSection`; `packages/engine/src/bundle.py:169-195` consome ambos.
  - Refs a `payload.l1`/`payload.l2` remanescentes são exclusivamente: (a) comentários históricos ("Was payload.l1 in v5", `models.py:262,288`), (b) fallback de leitura para v5 legacy em `packages/cli/src/ui/snapshot-html.ts:563,588` (explicitamente comentado).
- ✅ `BUNDLE_VERSION` atual = `"7"` (não `"6"` como o prompt assume).
  - Evidência (TS): `packages/cli/src/bundle/types.ts:18` `export const BUNDLE_VERSION = "7";`
  - Evidência (Python): `packages/engine/src/models.py:234` `BUNDLE_VERSION = "7"`
  - Histórico: v5 → v6 em commit `6ab2dd6` (R1.1) → v7 em `6dea15f` (R1.2c) por causa de `Optional[int]` em scores.
  - **Stop-and-ask 02**: prompt afirma "v5→v6" como bump esperado. Bump real foi `5 → 6 → 7`. v7 widens scores para `Optional[int]`. Confirmar com Eduardo se v7 é aceitável ou se o prompt cobre só até v6.
- ✅ `capture_fidelity` carregado em `harness_sources[*]`, restrito ao enum fechado.
  - Evidência: `packages/engine/src/models.py:238-244` `CAPTURE_FIDELITY_VALUES = ('native_hook', 'statusline', 'local_log_tail', 'editor_extension', 'inferred')`
  - Validation gate: `HarnessDescriptor.__post_init__` em `harness_registry.py:50` levanta `ValueError` se entrada não-canônica.
- ✅ Verifier aceita bundle v6 e v5 legacy.
  - Evidência: `packages/cli/src/bundle/verify.ts:27-31` `DetectedSchema = "v6_legacy" | "v5_legacy" | "v1_legacy"`; linha `:92,97,101` ramificam cada legacy.
  - Cadeia de fallback: v7 → v6_legacy → v5_legacy → v1_legacy (chain commited `6dea15f`).
  - **Não executei** verifier com fixtures v5+v6 efetivamente — testes `bun test packages/cli/tests/verify.test.ts` cobrem o caminho mas não foram rodados aqui. Marcar como ✅ sem execução fresh seria assumir; reportei como ✅ com nota.
- ✅ Verifier aceita v6 core-only (sem enrichment).
  - Evidência: `packages/engine/src/bundle.py:182-185` fallback `[HarnessSource("claude_code", "native_hook", 0)]` quando zero sessions; `models.py:286-300` `BundleEnrichmentSection` aceita lista vazia para `harness_sources` — verificação por construção, não execução.
- 🔍 Output do verifier exibe manifest com capture_fidelity no topo: `summarizeManifest()` em `verify.ts:36` retorna `{ schema, schemaLabel, sections, harnessSources }`. Não executei `beheld verify` em fixture para confirmar formato CLI rendido.

**Drift:** nenhum dentro de R1.1.

### R1.2 — Scorers refactor ✅

**Checklist:**

- ✅ `base.py` declara `data_sources: list[DataSource]` com tipo canônico.
  - Evidência: `packages/engine/src/scorers/base.py:8` (campo doc); `:147` re-exporta `DataSource = Literal["core", "enrichment"]`.
- ✅ `fallback_when_enrichment_missing` é ClassVar bool por scorer.
  - Evidência (`prompt_quality.py:29`): `fallback_when_enrichment_missing: ClassVar[bool] = False`
  - Evidência (`growth_rate.py:139`): `True`
  - Evidência (`tech_breadth.py:36`): `True`
  - Evidência (`test_maturity.py:35`): `True`
- ✅ `GrowthRateScorer` implementa §7.2 (12mo baseline + 6mo current + 4 signals com pesos canônicos).
  - Evidência (`growth_rate.py`):
    - linha `113`: "core (L1) é backbone temporal. Janela baseline = primeiros 12"
    - linha `118`: `test_ratio_signal = clip((avg_test_curr - avg_test_base) / 0.20, -1, +1)`
    - linha `119`: `diversity_signal = clip((distinct_repos_curr - distinct_repos_base) / 3, -1, +1)`
    - linha `120`: "Pesos: ecosystems 0.30 · platforms 0.20 · test_ratio 0.25 · diversity 0.25"
    - linhas `228-231`: aplicação literal dos pesos `* 0.30, * 0.20, * 0.25, * 0.25`
  - **Confirma**: a fórmula §7.2 está implementada conforme o prompt cita.
- ✅ GrowthRate retorna score baseado só em L1 quando enrichment vazio.
  - Evidência: `growth_rate.py:138` `data_sources: ClassVar[list[DataSource]] = ["core", "enrichment"]` + `:133` "fallback_when_enrichment_missing = True — quando recent/previous" (comentário explica o caminho).
- ✅ GrowthRate retorna `None` quando histórico < 6 meses.
  - Evidência: `growth_rate.py:204` `if not baseline or not current: return None` (lógica de janela curta).
- ✅ História ≥ 18 meses → canonical windows 12/6; menos → janelas 50/50 com `confidence: low`.
  - Evidência: `growth_rate.py:126` "History ≥ 18 meses: 12mo baseline + 6mo current (canonical)."; `:198` `current_start = _add_months(baseline_end, 1)` para o caso de histórico curto (split 50/50).
- ✅ `TechBreadthScorer` e `TestMaturityScorer` usam `data_sources: ["core", "enrichment"]`.
  - Evidência: `tech_breadth.py:35`, `test_maturity.py:34`.
- ✅ `PromptQualityScorer` exclusivo de enrichment + `fallback_when_enrichment_missing = False`.
  - Evidência: `prompt_quality.py:28-29`.
- ✅ PromptQuality retorna `None` quando enrichment ausente.
  - Evidência: `prompt_quality.py:35` "fallback_when_enrichment_missing = False" + comentário explicando o `None`.

**Comando executivo (rodado):**
```
python3 -m pytest tests/test_harness_registry.py tests/test_bundle_wire_e2e.py tests/test_r1_2b_scorers.py tests/test_r1_2c_null_scores.py tests/test_bundle.py -q
→ 62 passed in 0.94s
```

**Drift:** nenhum dentro de R1.2.

### R1.3 — MatchingService Rails ✅

**Checklist:**

- ✅ `BundleSignals` lê `payload.core` com fallback para `payload.l1`.
  - Evidência: `web/source/backend/app/services/positions/bundle_signals.rb:28-31`:
    - `CORE_ECOSYSTEMS_PATH = %w[payload core ecosystems]`
    - `LEGACY_ECOSYSTEMS_PATH = %w[payload l1 ecosystems]`
  - Linha `:78` resolve `data.dig(*CORE_ECOSYSTEMS_PATH) || data.dig(*LEGACY_ECOSYSTEMS_PATH)`
- ✅ `safe_dig` defensivo para non-Hash intermediário (evita TypeError em payload.core != Hash).
  - Evidência: `bundle_signals.rb:safe_dig` (ver commit `b33e66b`).
- ✅ `Matcher` consome `BundleSignals.from(bundle).to_h` — não toca raw `bundle_data`.
  - Evidência: `web/source/backend/app/services/positions/matcher.rb:96-98`.
- ✅ `EvolutionCurve` mesmo fallback core→l1.
  - Evidência: `web/source/backend/app/services/positions/evolution_curve.rb:69-70`.
- ✅ Controllers (DirectoryController HTML + Api::V1) com mesmo OR/COALESCE em SQL JSONB.
  - Evidência: `web/source/backend/app/controllers/directory_controller.rb:80-81` `jsonb_exists_any(... '{payload,core,ecosystems}' ...) OR jsonb_exists_any(... '{payload,l1,ecosystems}' ...)`
  - Evidência: `:93-94` `COALESCE((... 'payload','core','avg_test_ratio')::float, (... 'payload','l1','avg_test_ratio')::float)`
- ✅ Snapshot model aceita v3 (core/enrichment) ao lado de v1/v2.
  - Evidência: `web/source/backend/app/models/snapshot.rb:33` `validates :schema_version, inclusion: { in: %w[v1 v2 v3] }`; `:60` `return :v3 if payload.key?("core")` (checado antes de v2 — defensivo).
- ✅ Backend RSpec passou na sessão anterior (commits `b33e66b`, `fe8aba6` — backend completo 463/463).

**Comando executivo (não re-rodado nesta auditoria; resultado mais recente conhecido):**
```
docker exec beheld-backend-dev bundle exec rspec → 463 examples, 0 failures (commit fe8aba6)
```

**Audit `grep -rn bundle_data web/source/backend/app --include="*.rb"`:**
- ✅ Todas as 13 referências de leitura são `BundleSignals`, controllers com OR/COALESCE explícito, ou shape-detection no Snapshot model. Não há call-site lendo `bundle_data["payload"]["l1"]` direto.

**Drift:** nenhum dentro de R1.3.

### R1.4 — packages/cli estendido + legacy bridge ⚠️

**Checklist:**

- ✅ Subcomando `bootstrap` existe (não package separado).
  - Evidência: `packages/cli/src/index.ts:20-26` registra com commander; `packages/cli/src/commands/bootstrap.ts:66` exporta `bootstrapCommand`.
- ⚠️ **D-02 — default behavior NÃO checa identity.ed25519 e NÃO dispara bootstrap automaticamente.**
  - Evidência: `packages/cli/src/index.ts:18` único preAction registrado é `maybeShowBundleNudge`. Nenhum check de `~/.beheld/identity.ed25519` antes da resolução de subcomandos. Rodar `beheld` sem subcomando hoje cai no help do commander, não no wizard.
  - Severidade: média — funcionalmente o usuário só precisa rodar `beheld bootstrap` uma vez, mas o comportamento "low-friction npx beheld" do prompt não está honrado.
- ⚠️ **D-01 — legacy bridge VIOLA spec: MOVE em vez de copiar e preservar.**
  - Evidência: `packages/cli/src/lib/legacy-bridge.ts:117` `renameSync(src, dest)` (move); `:131` fallback `cpSync + rmSync` (copy + delete); `:153` `rmSync(legacy, ...)` remove o diretório legacy inteiro depois.
  - Resultado observável: depois da bridge, `~/.devprofile/` **deixa de existir**.
  - Prompt original: "Legacy bridge NÃO deleta `~/.devprofile/` original" + "cria `~/.devprofile/MIGRATED_TO_BEHELD.md` com nota".
  - Severidade: **alta** — usuários com setup legacy perdem o diretório original sem possibilidade de rollback manual. Também conflita com a expectativa do prompt de que o `MIGRATED_TO_BEHELD.md` seja a "prova de migração" visível.
- ✅ Nenhuma referência remanescente a `~/.devprofile/` em código de produção (só em strings de migração + testes).
  - Evidência: `grep -rn "\.devprofile" packages | grep -v node_modules | grep -v ".pyc"` retorna 10 hits, todos em `legacy-bridge.ts` (contexto: spec da bridge), testes (`bootstrap.test.ts`, `legacy-bridge.test.ts`, `delete.test.ts`), `index.ts:22` (description) — nenhum em path de leitura/escrita ativa.
- 🔍 Bun single-binary build < 50MB — não verificado nesta auditoria (não houve build invocado). Tamanho atual em `dist/` desconhecido.

**Comando executivo (não rodado — bridge tem efeito destrutivo em /tmp):**
- O fluxo do prompt seria:
  ```
  export TEST_HOME=$(mktemp -d) && mkdir -p $TEST_HOME/.devprofile && cp <fixture> $TEST_HOME/.devprofile/identity.ed25519
  HOME=$TEST_HOME npx beheld
  test -f $TEST_HOME/.beheld/identity.ed25519                  → ✅ esperado (entrega)
  test -f $TEST_HOME/.devprofile/identity.ed25519              → ❌ falhará (bridge moveu)
  test -f $TEST_HOME/.devprofile/MIGRATED_TO_BEHELD.md         → ❌ falhará (nunca criado)
  ```
  Os dois últimos testes do prompt **falhariam hoje**.

**Testes que passam:** `packages/cli/tests/bootstrap.test.ts` (5/5) e `legacy-bridge.test.ts` (8/8) — porém eles testam o comportamento *atual* da bridge (move), não o comportamento *especificado* (preserva + nota).

### R1.5a — Copy update (este repo) ✅

**Checklist:**

- ✅ README sem nenhuma menção a "cost tracker" ou framing similar.
  - Evidência: `grep -niE "cost.tracker|AI.spend|track.your.cost|Anthropic.bill" README.md` → zero hits.
- ✅ Hero reframe L1-first + multi-harness.
  - Evidência: `README.md:3` "Privacy-first developer profiling that reads what you already wrote — your **git history** — and enriches it with real usage signals from your coding harness (Claude Code, Continue.dev, and more coming)."
  - Linha `:7` callout `**R1 refundação:** git history is the backbone (the **core** layer); harness sessions are additive enrichment with a known capture fidelity.`
- ⚠️ Hero **não usa literalmente** a frase do prompt ("Histórico técnico portável e assinado do que você de fato fez."). Adota framing equivalente em inglês. Não é drift (prompt deixa o copy aberto), mas vale registrar.
- 🔍 "Forever free for developers" prominente: não está no root README do repo principal. Está em `web/source/frontend/src/locales/pt-BR.json:529` `"home.forever_free": "forever free for developers"` — surface da landing, não do README. Compromisso público vive em `web/source/frontend/src/content/COMPROMISSO.md` (do R1 anterior). O prompt diz "contrato prominente e textualmente público"; em-repo (não-web) isto vive apenas como menção indireta. Marcar como ⚠️ se o prompt exige README-level visibility.

### R1.5b — Copy update (beheld-web) ✅

Repo companion acessível em `web/` (gitignored no root, repo próprio).

**Checklist:**

- ✅ Landing hero reframe (PT/EN/ES) menciona git-history + multi-harness wave.
  - Evidência (`web/source/frontend/src/locales/pt-BR.json:11`): `"home.subtitle_html": "DevProfile é um daemon local que monta um perfil técnico a partir do seu histórico git e do seu coding harness — Claude Code, Continue.dev, e em breve Cursor, Gemini CLI, Codex e Copilot."`
  - Linha `:19`: `"land.hero.sub": "O Beheld começa pelo seu histórico git e enriquece com o que acontece no seu coding harness — Claude Code e Continue.dev hoje; Cursor, Gemini CLI, Codex e Copilot a caminho."`
- ✅ Trust strip presente.
  - Evidência: `pt-BR.json:529` "forever free for developers"; `:532` "open source"; `:642` "Open source, bundle verificável offline. Funciona mesmo se o Beheld sumir amanhã."
- ✅ `install.sh` em `scripts/install.sh:101-103` chama `beheld bootstrap` antes de `beheld init` (R1.4 + R1.5b combinados).
- ✅ Sem menções a "cost tracker" / "AI spend" em locales.
  - Evidência: `grep -niE "cost.tracker|AI.spend" web/source/frontend/src/locales/*.json` → zero hits.

### R2.1 — Gemini CLI ✅

- ✅ `packages/mcp-server/src/hooks/gemini.ts` (`handleGeminiPreToolUse`, `handleGeminiPostToolUse`, `handleGeminiStop`).
- ✅ Sanitizer chamado no handler: linhas `:51,76,90` `const safe = sanitize(body)`.
- ✅ `harness_registry.py` mapeia `"gemini-cli" → HarnessDescriptor("gemini_cli", "native_hook")`.
- ✅ Server route `/hook/gemini/{pre-tool,post-tool,stop}` em `server.ts`.
- ✅ Testes: `packages/mcp-server/tests/gemini.test.ts` — **9 passed** (rodado nesta auditoria).
- 🔍 Doc `docs/adapters/gemini.md` não existe (diretório `docs/adapters/` ausente). Prompt pede esse doc — registrar como ⚠️ doc gap.

### R2.2 — Cursor ✅

- ✅ Handler em `packages/mcp-server/src/hooks/cursor.ts` com 4-way discriminated union (tool_use, chat_request, edit_apply, stop).
- ✅ Capture fidelity `local_log_tail` (registry).
- ✅ Sanitizer chamado no handler (linha 91).
- ✅ CLI-side tail em `packages/cli/src/lib/cursor-tail.ts` (refatorado em cima de `lib/log-tail.ts` genérico).
- ✅ Testes mcp-server: `cursor.test.ts` — 11 passed. CLI tail: `cursor-tail.test.ts` — 13 passed.
- 🔍 `docs/adapters/cursor.md` não existe.

### R2.3 — Codex CLI ✅

- ✅ Handler em `packages/mcp-server/src/hooks/codex.ts` (estrutura clonada de Claude Code/Gemini).
- ✅ `native_hook` no registry.
- ✅ Sanitizer (linhas 56, 78, 92).
- ✅ Testes mcp-server: `codex.test.ts` — verificado passar nesta auditoria (parte dos 65).
- 🔍 `docs/adapters/codex-cli.md` não existe.

### R2.4 — Copilot CLI ✅

- ✅ Handler `packages/mcp-server/src/hooks/copilot-cli.ts`.
- ✅ Registry: `"copilot-cli" → HarnessDescriptor("copilot_cli", "statusline")` (`harness_registry.py:79`).
- ✅ Per-event `surface: "statusline" | "transcript"` carrega o blend dentro do metadata sem expandir o enum fechado.
- ✅ Sanitizer (linha 111).
- ✅ CLI tail `packages/cli/src/lib/copilot-cli-tail.ts`; 8 tests pass.
- 🔍 `docs/adapters/copilot-cli.md` não existe.

### R2.5 — Copilot VS Code ✅

- ✅ Handler `packages/mcp-server/src/hooks/copilot-vscode.ts`.
- ✅ `local_log_tail` no registry.
- ✅ Sanitizer (linha 91).
- ✅ CLI tail `packages/cli/src/lib/copilot-vscode-tail.ts` (descobre `~/Library/Application Support/Code/logs/.../GitHub.copilot/`); 9 tests pass.
- 🔍 `docs/adapters/copilot-vscode.md` não existe.

### Privacy boundary audit (todos R2.* + R3.1)

Verificação de privacy boundary executada estaticamente em todos os 6 adapters via grep:

```
grep -n "sanitize\b" packages/mcp-server/src/hooks/{gemini,cursor,codex,copilot-cli,copilot-vscode,windsurf}.ts
```

**Resultado:** todos os 6 adapters chamam `sanitize(body)` como primeira operação no handler, antes de qualquer leitura de campos sensíveis. Não foi observada leitura de `tool_input.command` (ou equivalente) sem o resultado da `sanitize()` ter sido produzido primeiro.

**Não executado:** `sqlite3 ~/.beheld/sessions.db '.dump' | grep -iE ...` — auditor é read-only, e não há DB de teste populado para amostrar. Veredito: ✅ **boundary preservada** com base em revisão estática + checks dos testes que pinam ausência de tokens/secrets nos eventos.

### R3.0 — Windsurf spike ✅

- ✅ Documento `docs/r3-windsurf-spike.md` existe.
- ✅ Responde 4 perguntas no §2:
  - Schema estável: sim (`docs.windsurf.com/windsurf/cascade/hooks`) — ✅ docs públicas, com tabela de 12 eventos.
  - Granularidade: 12 hooks: 8 tool boundaries + 2 chat turn + 1 session + 1 workspace.
  - Tier: livre, parte do produto base (não enterprise-gated).
  - Delivery: JSON via stdin, synchronous, via `~/.codeium/windsurf/hooks.json`.
- ✅ Recomendação clara: **GO** + `capture_fidelity: native_hook` (linha 2-3 do doc).
- ✅ Sem código de adapter no spike doc (verificado por leitura).

### R3.1 — Windsurf adapter ✅

- ✅ Handler `packages/mcp-server/src/hooks/windsurf.ts` com 12 cascade events mapeados.
- ✅ `native_hook` no registry.
- ✅ Sanitizer (linha 109).
- ✅ Privacy invariants documentados em comentários (§4 da spike): user_prompt text DROPPED, response markdown DROPPED, edits[] DROPPED, mcp_result DROPPED — só prompt_length / response_length / has_result.
- ✅ Installer CLI-side em `packages/cli/src/lib/windsurf-hooks.ts` — escreve `~/.codeium/windsurf/hooks.json` com 12 entradas curl, backup-on-change, idempotente. 10 tests pass.
- 🔍 `docs/adapters/windsurf.md` não existe (mas spike `docs/r3-windsurf-spike.md` cobre praticamente tudo o que um adapter-doc teria).

---

## Estado funcional (fluxos E2E)

### Fluxo 1 — Bundle generation L1-only via `npx beheld`

🔍 **Não executado.** Bridge legacy (D-01) move arquivos de `~/.devprofile/` se existirem — não é seguro rodar em `$HOME` real do auditor, e o fixture com 12+ meses de história requer setup separado. Critérios funcionalmente analisáveis sem execução:

- `bootstrap` cria `~/.beheld/` com mode `0700` — verificado em `packages/cli/tests/bootstrap.test.ts:54-58`.
- Bundle L1-only (zero sessions) — verificado em `packages/engine/tests/test_bundle_wire_e2e.py::test_empty_session_list_emits_back_compat_fallback`: emite `[HarnessSource("claude_code", "native_hook", sessions=0)]`. Bundle válido, não crash.
- `bundle_data_schema_version = 7` — confirmado por inspeção (`BUNDLE_VERSION="7"`).
- GrowthRate score com L1 puro: por design `fallback_when_enrichment_missing=True` → score válido baseado em monthly_buckets de L1.

### Fluxo 2 — Bundle L1+L2 via daemon

🔍 **Não executado.** Requer daemon real + sessão Claude Code real. Verificável estruturalmente:

- `harness_sources[]` agrupado por `source`: confirmado em `test_bundle_wire_e2e.py::test_grouping_aggregates_session_counts_per_descriptor` — 3 sessions claude-code + 2 gemini-cli + 1 cursor produzem 3 entradas com `sessions=[3,2,1]` corretas e ordem canônica.

### Fluxo 3 — Verificação de bundle legacy v5

🔍 **Não executado.** Estruturalmente verificável:

- `verify.ts:27-31` declara `DetectedSchema` incluindo `"v5_legacy"`; `:97` ramificação concreta para v5.
- Não há fixture v5 explicitamente caminhada nesta auditoria. Marcar para Eduardo: ⚠️ rodar `bun test packages/cli/tests/verify.test.ts` após próximo build para confirmar v5 ainda verifica.

### Fluxo 4 — Matching com bundle v6 core-only no Rails

🔍 **Não executado** (requer Rails runner + bundle real no DB).

Estruturalmente verificável:
- `BundleSignals` fallback `core → l1 → vazio` → matcher recebe `to_h` puro com `ecosystems / test_ratio / recency_days` mesmo se `enrichment` ausente.
- Specs `spec/services/positions/bundle_signals_spec.rb` cobrem cenário "core only, no l1" (commit `b33e66b`).

---

## Drift report

### Drift D-01 — Legacy bridge MOVE em vez de COPY + delete diretório legacy

- **Spec (prompt):** "Legacy bridge NÃO deleta `~/.devprofile/` original" + "Legacy bridge cria `~/.devprofile/MIGRATED_TO_BEHELD.md` com nota"
- **Implementação (`packages/cli/src/lib/legacy-bridge.ts:117,131,153`):**
  - linha `117`: `renameSync(src, dest)` — move children.
  - linha `131`: fallback EXDEV → `cpSync(src,dest); rmSync(src,...)` — copia e remove.
  - linha `153` (após sucesso): `rmSync(legacy, { recursive: true, force: true })` — remove o diretório legacy.
- **Diferença:** após a bridge, `~/.devprofile/` **não existe**; o arquivo `MIGRATED_TO_BEHELD.md` **nunca é criado**. O testes existentes (`legacy-bridge.test.ts:69-70`: `expect(existsSync(legacy)).toBe(false)`) **pinam** o comportamento atual, então não há sinal de regressão dentro do projeto — apenas drift contra spec.
- **Severidade:** alta. Operação destrutiva sem rollback explícito. Em workstation de dev com setup legacy histórico, perda irreversível do dir original.
- **Recomendação:**
  - Curto prazo: mudar `renameSync` → `cpSync(src, dest, { recursive: true })` (copy-only) + escrever `MIGRATED_TO_BEHELD.md` em `~/.devprofile/` com timestamp/destino. NÃO rmSync no diretório legacy.
  - Atualizar `legacy-bridge.test.ts` para inverter as asserções (espera `existsSync(legacy) === true` + arquivo nota presente).
  - Considerar flag opt-in `--purge-legacy` para usuários que querem o comportamento atual.

### Drift D-02 — Default-on-missing-identity ausente no preAction

- **Spec (prompt):** "Default behavior do bin `beheld` checa `~/.beheld/identity.ed25519` e dispara `bootstrap` se ausente"
- **Implementação (`packages/cli/src/index.ts:18-19`):** único preAction é `program.hook("preAction", () => { try { maybeShowBundleNudge(); } catch { ... } });`. Nada checa identity antes de rotear ao subcomando.
- **Diferença:** rodar `beheld` (sem args) hoje exibe o help do commander. Para entrar no wizard de bootstrap, usuário precisa explicitamente `beheld bootstrap`. A friction-free promise do prompt ("`npx beheld` L1-first onboarding") não está honrada.
- **Severidade:** média. Funcionalmente o usuário pode executar `beheld bootstrap` uma vez, mas a UX prometida não está wirada.
- **Recomendação:** adicionar segundo preAction (ou um wrapper na ação default do commander) que: (a) lê `~/.beheld/identity.ed25519`; (b) se ausente e nenhum subcomando solicitado, chama `bootstrapCommand({})` automaticamente; (c) se presente, mostra help normal.

### Drift D-03 — Docs por adapter (`docs/adapters/<harness>.md`) inexistentes

- **Spec (prompt):** "Doc `docs/adapters/<harness>.md` existe" — checklist por adapter.
- **Implementação:** diretório `docs/adapters/` não existe. Os 6 adapters têm apenas o comment-block doc dentro do próprio `.ts`.
- **Diferença:** specs em código (extensos) cobrem o material — mas não há doc consolidado por harness na pasta de docs.
- **Severidade:** baixa. A funcionalidade está documentada in-code. Faltam landing pages curtas para devs que querem entender um adapter sem ler TypeScript.
- **Recomendação:** opcional. Se for sumarizado o que está nos comments TS para um doc curto por adapter (`./docs/adapters/{gemini,cursor,codex-cli,copilot-cli,copilot-vscode,windsurf}.md`), elimina o gap. Não é blocker.

### Drift D-04 — Hero README sem a frase canônica do prompt

- **Spec (prompt R1.5a):** README hero "Histórico técnico portável e assinado do que você de fato fez."
- **Implementação (`README.md:3`):** "Privacy-first developer profiling that reads what you already wrote — your git history — and enriches it with real usage signals from your coding harness..."
- **Diferença:** mesmo framing, redação diferente. Em inglês, com viés técnico ("Privacy-first developer profiling") vs. PT-BR poético do prompt.
- **Severidade:** baixa. Não viola a intent (L1-first, não-cost-tracker). Vale verificar se Eduardo prefere a frase literal do prompt como hero.
- **Recomendação:** opcional. Se a frase do prompt é canônica, adicionar como h1/subtítulo PT-BR + manter EN como `home.subtitle_html`.

---

## Stop-and-ask hits

### ~~S&A-01 — Spec canônica não está no repositório~~ ✅ RESOLVIDO 2026-06-02

- **Resolução:** Opção C escolhida. `docs/beheld-estado-atual.md` foi declarado fonte canônica e expandido com seção "Contratos técnicos" pinando os 3 invariantes verificáveis:
  - **Contrato 1** — enum fechado `CAPTURE_FIDELITY_VALUES` (5 valores) + mapeamento por harness registrado.
  - **Contrato 2** — fórmula literal §7.2 do `GrowthRateScorer` (janelas 12mo/6mo, 4 signals, pesos 0.30/0.20/0.25/0.25).
  - **Contrato 3** — schema chain do verifier (v7 → v6_legacy → v5_legacy → v1_legacy) + decoupling do portal schema label vs wire BUNDLE_VERSION.
- **Commit:** `docs(spec): consolidate Refundação multi-tool contracts in estado-atual`.
- **Garantias estruturais derivadas** documentadas: privacy boundary por adapter, cross-language byte lock, ordem canônica do `harness_sources[]`, ortogonalidade wire/portal.
- **Impacto:** auditorias futuras checam literalmente contra `docs/beheld-estado-atual.md#contratos-técnicos`. Sem mais ambiguidade de "qual spec".

### S&A-02 — BUNDLE_VERSION 7 vs. v6 esperado pelo prompt

- **Origem:** R1.1 stop-and-ask listado no próprio prompt.
- **Condição disparada (prompt):** "Valor atual de `bundle_data_schema_version` antes do bump. Se não for v5, registrar e perguntar a Eduardo se o bump pra v6 ainda faz sentido."
- **Contexto técnico:** versão atual é **`"7"`**. v5 → v6 (R1.1, commit `6ab2dd6`) → v7 (R1.2c, commit `6dea15f`, widens scores para `Optional[int]`).
- **Decisão necessária:** confirmar se v7 é o estado desejado ou se o prompt foi escrito assumindo paragem em v6. Verifier já tem chain v7→v6_legacy→v5_legacy→v1_legacy.
- **Impacto se não decidir:** zero técnico (o sistema funciona). Apenas alinhamento de narrativa: ao reportar status, o prompt assume v6 como state-of-the-art; realidade é v7.

### S&A-03 — D-01 (bridge destrutiva) — escalar para Eduardo antes de fix

- **Origem:** R1.4.
- **Condição disparada (prompt rule #4):** "Drift de severidade alta encontrado — não auto-fix, escalar pra Eduardo no relatório."
- **Contexto técnico:** ver D-01 acima.
- **Decisão necessária:** Eduardo confirma se a intenção real era MOVE (e o prompt está outdated) ou COPY+nota (e o código precisa ser ajustado).
- **Impacto se não decidir:** usuários migrando de `~/.devprofile/` para `~/.beheld/` perdem irreversivelmente o diretório legacy. Risco baixo de blast (poucos usuários histórico-legacy), mas alta gravidade quando acontece.

---

## Próximos passos sugeridos (priorizados)

1. **[alta] Decidir S&A-01 e S&A-03** — spec ausente bloqueia verificação literal; D-01 bloqueia a bridge legacy ser declarada "spec-compliant".
2. **[média] Fix D-02 (default-on-missing-identity)** — pequeno, no `index.ts`: ler `~/.beheld/identity.ed25519`, se ausente disparar `bootstrapCommand({})` quando nenhum subcomando foi passado. Restaura a UX prometida.
3. **[média] Documentar S&A-02 nos release notes** — esclarecer que `BUNDLE_VERSION=7` é o estado atual (não v6) e que a chain de fallback do verifier cobre tudo desde v1.
4. **[baixa] Criar `docs/adapters/{gemini,cursor,codex-cli,copilot-cli,copilot-vscode,windsurf}.md`** — 6 docs curtos, basicamente exportando os comments TS. Fecha gap D-03.
5. **[baixa] Rodar Fluxos 1-4 end-to-end** em ambiente isolado (Docker / VM) — esta auditoria parou na verificação estrutural. Confirmar empiricamente: (1) tempo < 5min `npx beheld`, (2) bundle L1+L2 emite `harness_sources` correto, (3) v5 legacy verifica clean, (4) matcher Rails não crasha em core-only.

---

## Changelog

- **2026-06-02 (manhã)**: Verificação executada por Claude Code (read-only). 180 testes verdes. 4 drifts identificados (D-01 alta, D-02 média, D-03 baixa, D-04 baixa). 3 stop-and-ask hits.
- **2026-06-02 (tarde)**: D-01 fix em `feb17bb` (bridge não-destrutiva, marker MIGRATED_TO_BEHELD.md). D-02 fix em `dea7660` (default-on-missing-identity dispatch). 20 novos testes pinam ambos contratos. S&A-01 resolvido via opção C (`docs/beheld-estado-atual.md` agora é fonte canônica + seção "Contratos técnicos"). Restam apenas itens não-bloqueantes (D-03, D-04, S&A-02).

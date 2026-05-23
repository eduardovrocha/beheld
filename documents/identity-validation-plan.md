# Beheld — Plano de Validação End-to-End da Frase de Identidade

> **Spec de implementação** · v1.0 · 2026-05-15
> Como validar — com fixtures reais e revisão humana — que o pipeline
> `classify_signals_payload → IdentityGenerator → bundle` produz frases
> honestas, distintivas e seguras para casos representativos.

---

## Visão geral

O sistema tem três camadas de validação, com escopo crescente:

| Camada | Cobertura | Mecanismo | Cadência |
|--------|-----------|-----------|----------|
| **Unit tests** | Cada subclassificador, cada validador, cada path | pytest determinístico | Toda PR (CI) |
| **Integration E2E** | Fixtures de repos públicos clonados sob demanda | pytest com tag `e2e`, opt-in | Manual + semanal em CI agendado |
| **Revisão humana** | Frases finais geradas em sample real | Checklist + 2 revisores | Antes de cada release |

Esta spec cobre as duas últimas. Unit tests já existem em
`packages/engine/tests/identity/` (92 testes, ver
[identity-phrase-generator.md §13](identity-phrase-generator.md#13-critérios-de-pronto-para-produção)).

### Princípio guia

**Não confiar em métricas agregadas para validar frase pública.** Word
count e ausência de blacklist são condições necessárias mas não
suficientes — uma frase pode passar todas as validações automáticas e
ainda assim ser **vazia, errada ou condescendente**. Revisão humana é o
filtro final.

---

## 1. Fixtures de repos públicos

### Critérios de seleção

Cada fixture precisa atender:

1. **Público e estável.** Repositório acessível via `git clone` sem
   auth, com histórico de pelo menos 6 meses.
2. **Identidade técnica clara.** Não ambíguo qual stack representa.
3. **Volume suficiente.** Mínimo 200 commits do autor escolhido para
   produzir sinais robustos.
4. **Autor público.** Email do commit deve ser conhecidamente público
   (mantenedor visível, perfil GitHub aberto). **Nunca usar autores
   privados sem consentimento.**
5. **Diversidade de cenários.** A suíte cobre tipos diferentes de dev.

### Repos curados

Lista inicial (revisar URLs e author emails antes de cada release —
projetos open-source mudam).

| ID | Repo | Author email canonical | Stack esperado | Caso testado |
|----|------|------------------------|----------------|--------------|
| `rails-mainline` | rails/rails | (mantenedor ativo, e.g. dhh@... ou rafaelfranca@...) | Rails + Ruby | dominant=rails, evolution=none |
| `fastapi-core` | tiangolo/fastapi | tiangolo@... | Python + FastAPI | dominant=python+fastapi |
| `rust-tokio` | tokio-rs/tokio | (mantenedor) | Rust sistemas | dominant=rust, TDD forte |
| `flutter-samples` | flutter/samples | (mantenedor) | Flutter mobile | dominant=flutter |
| `next-js` | vercel/next.js | (mantenedor) | React + Next | dominant=react/next |
| `kubernetes-go` | kubernetes/kubernetes | (sub-area maintainer) | Go + DevOps | dominant=go, plataformas=k8s/docker |
| `beheld-self` | (este repo) | eduardo.vinicius.rocha@gmail.com | Python+Bun, generalist | meta-teste |
| `polyglot-archetype` | (selecionar dev open-source com perfil generalista visível) | — | Node + Python | dominant generalista |

### Estrutura de fixture no projeto

```
packages/engine/tests/e2e/
├── __init__.py
├── conftest.py
├── fixtures/
│   ├── repos.yaml          # metadata declarativa
│   └── expected/           # 1 YAML por fixture com expected signals + identity
│       ├── rails-mainline.yaml
│       ├── fastapi-core.yaml
│       └── ...
├── test_l1_extraction.py   # roda l1.importer contra cada repo
├── test_classification.py  # signals esperados por fixture
└── test_identity_phrase.py # identity esperada (com tolerância)
```

### `fixtures/repos.yaml`

```yaml
- id: rails-mainline
  repo_url: https://github.com/rails/rails.git
  author_email: rafaelfranca@example.com   # ajustar — autor público real
  description: "Mantenedor de longa data do Rails core"
  min_commits: 200
  skip_if_unreachable: true

- id: fastapi-core
  repo_url: https://github.com/tiangolo/fastapi.git
  author_email: tiangolo@example.com
  description: "Autor principal do FastAPI"
  min_commits: 500
  skip_if_unreachable: true

# ... (demais fixtures)
```

### `fixtures/expected/rails-mainline.yaml`

```yaml
fixture_id: rails-mainline

# Sinais que devem estar presentes (assertions com tolerância)
signals:
  ecosystems:
    dominant_must_include: [rails]      # at least rails
    dominant_must_not_include: [flutter, dotnet]
    secondary_max_size: 3
    emerging_allowed: [react, python]
    declining_allowed: []

  test_pattern:
    discipline_in: [strong, moderate]   # qualquer um aceitável
    approach_in: [tdd_partial, test_after, tdd_dominant]

  workflow:
    primary_in: [test_after, refactor_heavy, review_before_commit, tdd]

  evolution:
    has_evolution: true
    timeframe_in: [couple_years, many_years]
    # trajectory pode variar — não fixar

  tooling:
    platforms_must_include: [github]
    platforms_max_size: 5

  sample_size:
    confidence_band_in: [high, medium]

# Identidade esperada (assertions semânticas, não literais)
identity:
  identity_short:
    must_contain_any: [Backend, Rails, Generalista]
    must_not_contain: [Mobile, Frontend, Sistemas]

  identity_long:
    must_mention_any: [Rails, backend, Ruby]
    must_not_mention: [mobile, blockchain, talentoso, experiente]
    expected_confidence_in: [high, medium]
    generation_path_in: [llm, fallback]
```

Princípio dos expected: **tolerância > literalismo**. A frase do LLM tem
variabilidade (temperature 0.7). Não comparamos string-equality;
comparamos **regiões semânticas** com `must_contain_any` /
`must_not_contain`.

---

## 2. Pipeline E2E

### Setup do teste

```python
# packages/engine/tests/e2e/conftest.py

import pytest
import yaml
from pathlib import Path

E2E_ROOT = Path(__file__).parent / "fixtures"

def pytest_addoption(parser):
    parser.addoption(
        "--e2e", action="store_true", default=False,
        help="Run E2E tests against public repos (requires network)",
    )

def pytest_collection_modifyitems(config, items):
    if config.getoption("--e2e"):
        return
    skip = pytest.mark.skip(reason="--e2e flag not provided")
    for item in items:
        if "e2e" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(scope="session")
def repos_manifest() -> list[dict]:
    with open(E2E_ROOT / "repos.yaml") as f:
        return yaml.safe_load(f)


@pytest.fixture(scope="session")
def expected_loader():
    def _load(fixture_id: str) -> dict:
        with open(E2E_ROOT / "expected" / f"{fixture_id}.yaml") as f:
            return yaml.safe_load(f)
    return _load
```

### Execução

```bash
# Todos os E2E (lento, ~10–30 min)
pytest tests/e2e/ --e2e

# Um fixture específico
pytest tests/e2e/ --e2e -k rails-mainline

# Sem --e2e: todos os testes E2E são pulados em CI normal
pytest
```

### Test cases

#### `test_l1_extraction.py`

Para cada repo no manifest, executa `l1.importer.import_repository`,
assert que extração não levantou erro, e que `commit_count >=
min_commits`.

```python
@pytest.mark.e2e
@pytest.mark.parametrize("fixture_id,manifest", _params())
def test_l1_extracts_for_repo(fixture_id, manifest, tmp_path, monkeypatch):
    db = BeheldDB(tmp_path / "p.db")
    db.init_schema()
    importer = L1Importer(db)

    try:
        importer.import_repository(
            manifest["repo_url"],
            manifest["author_email"],
        )
    except CloneError:
        if manifest.get("skip_if_unreachable"):
            pytest.skip("repo unreachable — network or auth issue")
        raise

    summary = db.get_l1_summary()
    assert summary["total_commits"] >= manifest["min_commits"], (
        f"{fixture_id}: extracted only {summary['total_commits']} commits"
    )
```

#### `test_classification.py`

Após L1 extraído, roda `classify_signals_payload` e verifica que o
payload bate com os expected do YAML (com tolerâncias).

```python
@pytest.mark.e2e
@pytest.mark.parametrize("fixture_id,manifest", _params())
def test_classifier_produces_expected_signals(
    fixture_id, manifest, expected_loader, db_with_repo,
):
    expected = expected_loader(fixture_id)
    db = db_with_repo(manifest)  # fixture que pré-importa o repo

    payload = classify_signals_payload(db)
    _assert_signals_match(payload, expected["signals"])
```

Função `_assert_signals_match` faz comparação semântica:

```python
def _assert_signals_match(actual: dict, expected: dict) -> None:
    eco = expected.get("ecosystems", {})
    if "dominant_must_include" in eco:
        for required in eco["dominant_must_include"]:
            assert required in actual["ecosystems"]["dominant"], (
                f"expected {required} in dominant, got {actual['ecosystems']['dominant']}"
            )
    if "dominant_must_not_include" in eco:
        for forbidden in eco["dominant_must_not_include"]:
            assert forbidden not in actual["ecosystems"]["dominant"]
    # ... outros campos
```

#### `test_identity_phrase.py`

Roda o pipeline completo (classifier → identity) com **LLM real**, valida
contra os expected semânticos.

```python
@pytest.mark.e2e
@pytest.mark.parametrize("fixture_id,manifest", _params())
def test_identity_phrase_meets_expectations(
    fixture_id, manifest, expected_loader, db_with_repo,
):
    expected = expected_loader(fixture_id)
    db = db_with_repo(manifest)
    db.init_schema()

    payload = classify_signals_payload(db)
    gen = IdentityGenerator(db=db)  # usa o cliente Anthropic real
    result = gen.generate(payload, persist=False)

    _assert_identity_matches(result, expected["identity"])
```

Comparação semântica em `_assert_identity_matches`:

```python
def _assert_identity_matches(result, expected) -> None:
    short = result.identity_short.lower()
    long_text = result.identity_long.lower()

    if "must_contain_any" in expected["identity_short"]:
        candidates = [c.lower() for c in expected["identity_short"]["must_contain_any"]]
        assert any(c in short for c in candidates), (
            f"identity_short {result.identity_short!r} must contain one of {candidates}"
        )

    if "must_not_contain" in expected["identity_short"]:
        forbidden = [f.lower() for f in expected["identity_short"]["must_not_contain"]]
        for f in forbidden:
            assert f not in short, f"identity_short contains forbidden {f!r}"

    # idem para identity_long...

    if expected.get("identity_long", {}).get("expected_confidence_in"):
        assert result.confidence in expected["identity_long"]["expected_confidence_in"]
```

### Custo de cada run E2E

Estimativa: 8 fixtures × ~1 chamada Haiku × ~$0.0008 = **~$0.007 por
run completo**. Aceitável para CI semanal e revisão pré-release.

---

## 3. Revisão humana — checklist

Cada release que toca o gerador de identidade requer revisão humana de
**5 frases sample** em pelo menos **2 cenários diferentes**.

### Checklist por frase

#### Bloco 1 — Validações de segurança (deve ser **automática**, revisor confirma)

- [ ] Frase não contém nenhuma palavra da blacklist (`talentoso`,
      `experiente`, `versátil`, etc.)
- [ ] `identity_long` não começa com "Você é um desenvolvedor"
- [ ] `identity_short` não termina com `.`, `!` ou `?`
- [ ] Word counts dentro da faixa do path
- [ ] JSON parseável, campos esperados presentes

Se qualquer um falhar: **bug — não passar adiante até corrigir**.

#### Bloco 2 — Validações de tom (manual)

- [ ] **Não vende.** Frase descreve, não elogia. Lê como observação,
      não pitch.
- [ ] **Não condescende.** Frase respeita o dev. Mesmo no fallback de
      sinais minimais, não soa pejorativa.
- [ ] **Não inflaciona.** Frase não exagera importância dos sinais.
      "Migrou para Python" só se realmente migrou, não se experimentou
      uma vez.
- [ ] **Soa natural** se lida em voz alta. Não tropeça em estrutura
      forçada, não tem palavras desnecessárias.
- [ ] **Em PT-BR idiomático**, sem traduções tortas do inglês.
- [ ] **Não confunde "Generalista" com "indeciso"**. Generalista por
      design ≠ "está procurando o que fazer".

#### Bloco 3 — Validações de conteúdo (manual)

- [ ] **Fatos batem com os sinais.** Frase menciona Rails só se
      `dominant = rails`. Não inventa ecosystems.
- [ ] **Evolução só quando real.** Frase usa "últimos anos" /
      "tem feito" só quando `evolution.has_evolution = true`.
- [ ] **Quando `confidence = "low"`**, frase comunica incerteza sem
      ser depreciativa ("primeiros sinais", "em fase inicial").
- [ ] **Identidade distintiva.** Frase serviria para diferenciar este
      dev de outro dev "qualquer" com sinais distintos? Se duas frases
      de devs distintos ficam idênticas, **falhou**.
- [ ] **Identity_short é embeddable.** Cabe num badge SVG sem
      truncar feio. Caracteres especiais (·, →) renderizam.

#### Bloco 4 — Validações de privacidade (manual)

- [ ] Nenhum **nome próprio** ("Eduardo", "Rafael", etc.) aparece.
- [ ] Nenhum **path local** ("/Users/...") aparece — sanity check, isso
      deveria ser impossível dado o schema, mas revisor confirma.
- [ ] Nenhum **número absoluto** ("847 commits", "63%") aparece.
- [ ] Nenhuma **empresa, cliente ou produto** aparece. "Backend" sim;
      "Backend na Acme Corp" não.
- [ ] Nenhum **link, email, handle** aparece.

#### Bloco 5 — Quando algo está errado

Se uma frase falha em qualquer bloco 2–4:

1. Capturar o `signals_json` e a frase em
   `documents/review-log/YYYY-MM-DD-<fixture-id>.md`.
2. Identificar a causa:
   - Classificador produziu sinais errados? → fix em `classifiers/signals/`
   - LLM tropeçou apesar de sinais corretos? → ajustar prompt em
     `identity/llm.py` (atualizar exemplos few-shot, reforçar restrições)
   - Fallback inadequado? → ajustar template ou hierarquia
3. Adicionar regression test em
   `packages/engine/tests/identity/` que reproduz o caso e travaria
   regressão futura.

---

## 4. Sample reduzido para revisão pré-release

Não precisa rodar todas as 8 fixtures a cada release. Sample
**representativo mínimo**:

| Fixture | Caso testado | Path esperado |
|---------|--------------|---------------|
| `rails-mainline` | dominante claro, sem evolução | llm |
| `rust-tokio` | TDD forte, sistemas | llm |
| `fastapi-core` | combinação Python+FastAPI | llm |
| `polyglot-archetype` | dominante duplo | llm (com "Generalista") |
| **synthetic-minimal** | dev novo, dados escassos | fallback |

O `synthetic-minimal` é gerado em código (não vem de repo público):
DB vazio com 5 sessões fictícias. Garante cobertura do fallback path.

---

## 5. Cadência

| Atividade | Frequência | Responsável |
|-----------|------------|-------------|
| Unit tests (pytest) | Cada commit | CI |
| `--e2e` integration | Semanal (agendado em CI) | Automático |
| Revisão humana mini-sample | Cada release | Dev + um revisor |
| Atualização da curadoria de fixtures | Trimestral | Dev |
| Recalibração de thresholds de classifier | Trimestral, com dados de produção | Dev |
| Auditoria de privacidade em sample de produção | Mensal | Dev |

---

## 6. Smoke tests pós-deploy

Após cada deploy em produção, smoke automatizado:

```bash
# packages/engine/scripts/smoke-bundle.sh

set -euo pipefail

curl -sf -X POST http://localhost:7338/health | grep -q '"ok":true'

# Beheld contra si mesmo — fixture interna
curl -sf -X POST http://localhost:7338/bundles \
  -H 'Content-Type: application/json' \
  -d '{}' \
  | jq -e '
      .identity.identity_long
      and .identity.identity_short
      and (.identity.confidence | IN("high","medium","low"))
      and (.identity.generation_path | IN("llm","fallback","minimal_template"))
      and (.bundle.hash | startswith("sha256:"))
      and (.bundle.canonical_json | length > 0)
    '

echo "smoke OK"
```

Disparado:

- Após cada `beheld-engine` boot (lifespan hook após `init_schema`).
- Cron diário em produção (se/quando o engine for daemonizado em
  servidor compartilhado).

---

## 7. Logging para revisão

Em produção, **toda** geração loga estruturadamente (ver
[post-bundles-endpoint.md §9](post-bundles-endpoint.md#9-observabilidade)).
Mas a revisão humana precisa de mais: capturar
**signals_json + identity** em sample.

### Estratégia: sampling 1%

```python
import random

SAMPLE_RATE = 0.01

def _maybe_log_for_review(signals: dict, identity: IdentityResult) -> None:
    if random.random() >= SAMPLE_RATE:
        return
    log_path = Path.home() / ".beheld" / "review-samples"
    log_path.mkdir(exist_ok=True)
    fname = log_path / f"{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.json"
    fname.write_text(json.dumps({
        "signals": signals,
        "identity": identity.to_dict(),
        "version": VERSION,
    }, indent=2))
```

Arquivos são **locais ao engine** (privacidade-first — nada sai do
device). Dev faz review semanal manualmente abrindo o diretório.

### Quando o sample fica grande (>1000 arquivos)

Rotação por idade: deletar > 30 dias.

---

## 8. Critérios go/no-go para release

### Go

- [ ] Todos os 92 unit tests passando
- [ ] 5 fixtures do sample reduzido geram identity passing nos blocos 1–4 do checklist
- [ ] Pelo menos 2 fixtures usam path `llm`, pelo menos 1 usa `fallback`
- [ ] Nenhum bug bloqueador aberto no review-log dos últimos 14 dias
- [ ] Latência p99 do `/bundles` < 5s em fixtures locais
- [ ] Smoke pós-deploy passa em ambiente de staging

### No-go (bloqueia release)

- [ ] Qualquer falha de **segurança** (blacklist, opening proibido) detectada
- [ ] **`minimal_template`** disparou em > 0.5% dos retratos sample
- [ ] Frase em qualquer fixture do sample reduzido falha o bloco 4 (privacidade)
- [ ] Classificador produz payload que `validate_payload` rejeita
- [ ] Hash do bundle não bate entre Python e TypeScript (twin desincronizado)

---

## 9. Runbook — quando dá ruim em produção

### Alerta: `minimal_template` > 0.5% em 1h

1. Olhar logs estruturados, filtrar `identity_path=minimal_template`.
2. Para cada amostra, recuperar o `signals_json` correspondente.
3. Rodar `validate_payload(signals)` localmente — se falhar, é bug no
   classificador (recente regression?).
4. Se passa: rodar `IdentityGenerator(db=None).generate(signals)` em
   modo dev. Capturar `last_reason` do LLM (logging interno).
5. Patch direcionado, hotfix release.

### Alerta: `fallback` > 40% em 24h

Provavelmente classifier ficou conservador demais (thresholds muito
altos), não bug catastrófico.

1. Inspecionar `select_generation_path` decisions — quantos por causa
   de `minimal`, quantos por `low + no evolution + no emerging`,
   quantos por `len(dominant)==0`?
2. Verificar se algum threshold foi alterado recentemente.
3. Considerar relaxar `DOMINANT_MIN_SHARE` ou `emerging` deltas se
   classifier está "vetando" payloads que humanamente seriam
   narráveis.
4. **Não tocar no prompt do LLM** — esse alerta é sobre o classifier.

### Alerta: latência p99 > 8s

1. Olhar logs `stages.identity_generate`. Se > 5s, é a API Anthropic.
2. Confirmar via `https://status.anthropic.com`. Aguardar.
3. Considerar fallback temporário forçado:
   ```python
   if os.environ.get("BEHELD_FORCE_FALLBACK") == "1":
       return "fallback"
   ```
4. Reverter quando latência normalizar.

### Alerta: revisor humano flagou frase ruim

1. Capturar o caso em `documents/review-log/<date>-<fixture>.md`:
   - signals_json completo
   - frase gerada
   - razão da rejeição (qual bloco do checklist falhou)
   - hipótese da causa
2. Reproduzir em teste unitário com signals_json congelado.
3. Patch:
   - Sinais errados? → ajuste em classifier + regression test
   - Frase ruim apesar de sinais OK? → adicionar exemplo negativo no
     prompt do LLM, atualizar BLACKLIST se for palavra nova
4. Push com test verde + revisor reaprova a frase nova.

---

## 10. Casos especiais

### Dev sem nenhum repo importado (só L2)

E2E não cobre — fixture seria sintética. Cobertura via unit test em
`tests/identity/test_orchestrator.py::test_orchestrator_fallback_for_low_band_no_evolution`.

### Dev com 1 repo gigante (single-project life)

Caso real comum. Adicionar fixture `single-project-deep` quando aparecer
dev representativo open-source.

### Dev em transição de carreira aguda (stack_migration evidente)

`fastapi-core` cobre parcialmente (deve detectar migração inicial pra
TypeScript em alguns projetos). Adicionar caso explícito se passar a
ser frequente em produção.

### Dev poliglota com 5+ stacks balanceadas

`polyglot-archetype` cobre. Verificar especificamente que
identity_short usa "Generalista" e não força "Backend".

---

## 11. Versionamento desta spec

Quando o classifier ou o prompt do LLM mudam, esta spec **não** muda
automaticamente — ela define o protocolo de validação, não o conteúdo.

Mudanças que **exigem** atualização aqui:

- Adicionar nova fixture na curadoria
- Mudar o sample reduzido para revisão pré-release
- Adicionar nova categoria de bloco no checklist humano
- Mudar SAMPLE_RATE ou retenção dos review-samples
- Adicionar/remover métrica de observabilidade

Bumpar `v1.0 → v1.1` no header quando isso acontecer.

---

## 12. Itens fora de escopo

- **Avaliação automatizada de qualidade narrativa** (LLM-as-judge para
  pontuar tom/precisão). Possível futuro, mas LLM-as-judge tem viéses
  conhecidos que merecem mais cuidado antes de adotar como gate.
- **A/B test de versões de prompt**. Suportado pela arquitetura, mas
  fora desta spec.
- **Validação contra detecção de re-identificação** (proving que duas
  frases nunca convergem para identidade reversível). Privacy review
  separada, fora deste escopo.
- **User feedback loop** (dev marca a frase como "errada" e isso
  alimenta tuning). Fora do MVP.

---

## 13. Referências

- [identity-phrase-generator.md](identity-phrase-generator.md) — gerador
- [classifier-signals-payload.md](classifier-signals-payload.md) — classifier
- [post-bundles-endpoint.md](post-bundles-endpoint.md) — endpoint
- [packages/engine/tests/identity/](../packages/engine/tests/identity/) — unit tests existentes
- [packages/engine/src/l1/importer.py](../packages/engine/src/l1/importer.py) — usado nos E2E

# Beheld — Classificador de Sinais (`signals_json`)

> **Spec de implementação** · v1.0 · 2026-05-15
> Documento de referência única para o componente que destila o estado
> do SQLite (L1 git + L2 sessões) no payload v1 consumido pelo
> [IdentityGenerator](identity-phrase-generator.md).

---

## Visão geral

O classificador é a ponte entre os **dados brutos** que o engine acumula
(file extensions, peak hours, test ratios, ecosystems detectados por
manifesto, etc.) e o **payload categórico** que alimenta a geração de
frase pública.

```
SQLite local
  ├── l1_signals (1 row / repo importado)
  ├── sessions (1 row / sessão Claude Code ou Continue)
  ├── technical_signals (signal_type, signal_value, occurrences)
  ├── workflow_metrics (snapshot agregado de 30d)
  └── scores (1 row / dia)
        ↓
  ┌────────────────────────────────────────┐
  │ classify_signals_payload(db) → dict    │
  │  ├── classify_ecosystems()             │
  │  ├── classify_test_pattern()           │
  │  ├── classify_workflow()               │
  │  ├── classify_timing()                 │
  │  ├── detect_evolution()                │
  │  ├── classify_tooling()                │
  │  ├── classify_ai_usage()  (optional)   │
  │  └── classify_sample_size()            │
  └────────────────────────────────────────┘
        ↓
  signals_json (schema v1)
        ↓
  IdentityGenerator.generate(payload)
```

Cada subclassificador é **puro** — recebe estado lido do banco, devolve
campo categórico do schema. Nenhum efeito colateral. Isso torna cada um
testável isoladamente e permite que o orquestrador de payload combine
sob diferentes janelas temporais.

---

## 1. Localização e contrato

### Diretório

```
packages/engine/src/classifiers/
├── __init__.py
├── platform.py           (já existe — kept)
├── project_type.py       (já existe — kept)
├── workflow.py           (já existe — kept)
└── signals/              (novo — esta spec)
    ├── __init__.py
    ├── ecosystems.py     (classify_ecosystems)
    ├── test_pattern.py
    ├── workflow.py       (classify_workflow — não confundir com classifiers/workflow.py legado)
    ├── timing.py
    ├── evolution.py      (detect_evolution)
    ├── tooling.py
    ├── ai_usage.py
    ├── sample_size.py
    └── orchestrator.py   (classify_signals_payload)
```

### Função pública principal

```python
def classify_signals_payload(
    db: BeheldDB,
    *,
    window_days: int = 180,
    emerging_window_days: int = 90,
) -> dict:
    """Build the signals_json payload (schema v1) from current DB state.

    Parameters
    ----------
    window_days
        Total observation window. Eventos antes disso são ignorados na
        construção do payload, mas o histórico bruto fica intocado no DB.
    emerging_window_days
        Janela usada por detect_evolution e classify_ecosystems para
        detectar emerging/declining. Deve ser ≤ window_days / 2.
    """
```

Retorno: dict que **deve** passar por `identity.validators.validate_payload`
antes de qualquer geração. Falha de validação aqui = bug no classificador.

---

## 2. `classify_ecosystems` — campo `ecosystems`

### Entrada conceitual

Dois canais independentes:

- **L1 (git history)** — `l1_signals.file_extensions` agregado em
  `get_l1_summary()`. Cada chave do dicionário é uma extensão (`"py"`,
  `"rb"`, `"ts"`); o valor é a soma das ocorrências cross-repo.
- **L2 (sessões Claude Code)** — `sessions.extensions_json` agregado por
  `started_at >= window_start`. Cada chave é a extensão com ponto
  (`".py"`, `".rb"`), valor é o count cumulativo.

Para uniformizar, o classificador normaliza ambos para extensões **sem
ponto**, em lowercase, antes de mapear.

### Mapping de extensão → ecosystem

Reusa [`EXTENSION_TO_ECOSYSTEM`](packages/engine/src/extractors/files.py)
**parcialmente**. O classificador precisa do enum fechado do schema v1
(ver `identity.schema.ECOSYSTEMS`), que difere em alguns pontos do mapping
do extractor:

| Extension | extractor mapping | schema mapping | Ação |
|-----------|-------------------|----------------|------|
| `.tsx` | `react` | `react` | reuse |
| `.jsx` | `react` | `react` | reuse |
| `.ts`  | `node` | `node` | reuse |
| `.kt`  | `java` | `kotlin` | **override** — schema separa `kotlin` (mobile) de `java_spring` (backend) |
| `.swift` | `swift` | `swift_ios` | **override** |
| `.java` | `java` | `java_spring` | **override** |
| `.cs` | `dotnet` | `dotnet` | reuse |
| `.dart` | `flutter` | `flutter` | reuse |

A regra: **se houve override**, o mapping vive em
`classifiers/signals/ecosystems.py` como `EXTENSION_TO_SCHEMA_ECOSYSTEM`,
e o classificador **nunca** usa diretamente o mapping bruto do extractor.
Isso evita que mudanças downstream (categorização) afetem upstream
(detecção).

### Manifestos e signals adicionais

Além de extensões, dois sinais auxiliares confirmam um ecosystem:

- **Manifesto presente** (L1): `Gemfile`, `package.json`, `Cargo.toml`,
  etc. Já capturado em `l1_signals.ecosystems` como `{eco: true}`.
- **technical_signals do tipo `ecosystem`** (L2): voto explícito feito
  durante o processamento da sessão.

Cada manifesto vale **3× o peso** de uma única extensão. Isso impede
que um único arquivo `.rb` aleatório em um repo Python contamine a
classificação.

### Cálculo do score por ecosystem

```python
def _score(ext_counts: dict, manifesto_presence: dict) -> dict[str, float]:
    """Combina contagens de extensão + presença de manifesto.

    Retorna {ecosystem: score} onde score é um valor relativo (não
    normalizado). A normalização é responsabilidade de _rank().
    """
    scores: dict[str, float] = {}
    for ext, count in ext_counts.items():
        eco = EXTENSION_TO_SCHEMA_ECOSYSTEM.get(ext.lstrip(".").lower())
        if eco:
            scores[eco] = scores.get(eco, 0.0) + float(count)

    for eco, present in manifesto_presence.items():
        # Manifesto via _ECOSYSTEM_MANIFESTS pode usar IDs que não estão
        # no enum v1 (ex: "java" do mapping antigo vs "java_spring" do
        # schema). Roteia através de MANIFEST_TO_SCHEMA_ECOSYSTEM.
        target = MANIFEST_TO_SCHEMA_ECOSYSTEM.get(eco, eco)
        if present and target in ECOSYSTEMS:
            scores[target] = scores.get(target, 0.0) + 3.0

    return scores
```

### Ranking — dominant / secondary

```python
def _rank(scores: dict[str, float]) -> tuple[list[str], list[str]]:
    """
    Returns (dominant, secondary) following the schema's maxItems rules
    (dominant ≤ 2, secondary ≤ 3).
    """
    if not scores:
        return [], []

    total = sum(scores.values())
    # Share de cada ecosystem (proporção do total combinado).
    shares = {eco: s / total for eco, s in scores.items()}

    # Ordem decrescente; empates resolvidos pela ordem alfabética para
    # estabilidade entre execuções.
    ordered = sorted(shares.items(), key=lambda kv: (-kv[1], kv[0]))

    # Thresholds calibrados via observação inicial; revisitar com dados
    # de produção depois de 50+ retratos.
    DOMINANT_MIN_SHARE = 0.25     # < 25% nunca é dominante
    SECONDARY_MIN_SHARE = 0.08    # < 8% é ruído, não secondary

    dominant = [eco for eco, share in ordered if share >= DOMINANT_MIN_SHARE][:2]
    if not dominant:
        # Edge case: ninguém atinge 25% (dados muito difusos). Usa o top-1
        # como dominante mesmo abaixo do threshold para não bloquear o LLM.
        dominant = [ordered[0][0]]

    used = set(dominant)
    secondary = [
        eco for eco, share in ordered
        if eco not in used and share >= SECONDARY_MIN_SHARE
    ][:3]

    return dominant, secondary
```

### Janela temporal — `emerging` e `declining`

Para detectar mudança ao longo do tempo, o classificador computa
**dois rankings**:

1. `recent_scores` — eventos dos últimos `emerging_window_days` dias.
2. `prior_scores` — eventos entre `emerging_window_days` e
   `window_days` dias atrás.

```python
def _detect_shifts(
    recent: dict[str, float],
    prior: dict[str, float],
) -> tuple[list[str], list[str]]:
    """Compare two windows; return (emerging, declining)."""
    recent_total = sum(recent.values()) or 1
    prior_total = sum(prior.values()) or 1

    recent_share = {e: s / recent_total for e, s in recent.items()}
    prior_share = {e: s / prior_total for e, s in prior.items()}

    all_eco = set(recent_share) | set(prior_share)
    deltas = []
    for eco in all_eco:
        delta = recent_share.get(eco, 0.0) - prior_share.get(eco, 0.0)
        deltas.append((eco, delta, recent_share.get(eco, 0.0), prior_share.get(eco, 0.0)))

    # Emerging: cresceu ≥ 15 pontos percentuais E representa ≥ 12%
    # da janela recente. O segundo termo elimina ruído de baixo volume.
    emerging = sorted(
        [(e, d) for e, d, r, _ in deltas if d >= 0.15 and r >= 0.12],
        key=lambda kv: -kv[1],
    )

    # Declining: simétrico. ≥ 15 pp de queda E ≥ 12% na janela prior
    # (ou seja, era relevante antes).
    declining = sorted(
        [(e, d) for e, d, _, p in deltas if d <= -0.15 and p >= 0.12],
        key=lambda kv: kv[1],
    )

    return [e for e, _ in emerging][:2], [e for e, _ in declining][:2]
```

### Tabela de calibração

| Threshold | Valor | Razão |
|-----------|-------|-------|
| `DOMINANT_MIN_SHARE` | 0.25 | Abaixo disso, narrativa "Dev Rails" é enganosa |
| `SECONDARY_MIN_SHARE` | 0.08 | Abaixo, é ruído (1 arquivo em 20) |
| Manifest weight | 3.0× | Manifesto = decisão de stack, não acidente |
| Emerging delta min | +0.15 pp | Mudança visível mas não erratic |
| Emerging share min | 0.12 | Garante volume real, não 1 commit |
| Declining mirror | −0.15 pp | Simétrico ao emerging |
| `emerging_window_days` | 90 | "Últimos meses" cabe no tom da frase |

Calibração inicial; **revisitar com 50+ retratos reais** antes de
considerar definitiva.

### Edge cases

- **Sem L1 e sem L2.** `ecosystems = {dominant: [], secondary: [], ...}`.
  O `select_generation_path` joga para fallback automaticamente.
- **Apenas L1 (sem sessões).** `recent_window` é vazia, `prior_window`
  agrega tudo. Sem emerging/declining possível.
- **Apenas L2 (sem repos importados).** Funciona normalmente; manifestos
  ficam zerados, mas extensões fornecem sinal.
- **Ecosystem fora do enum v1.** Extensão `.elm`, `.hs`, `.scala` etc.
  são **descartadas** silenciosamente. Não corromper o payload com
  valores que `validate_payload` rejeitaria.

### Assinatura final

```python
def classify_ecosystems(
    db: BeheldDB,
    *,
    window_days: int = 180,
    emerging_window_days: int = 90,
    now: Optional[datetime] = None,  # injetável para testes determinísticos
) -> dict:
    """Returns the ecosystems block of the v1 payload."""
    cutoff_recent = (now or _now_utc()) - timedelta(days=emerging_window_days)
    cutoff_window = (now or _now_utc()) - timedelta(days=window_days)

    l1 = db.get_l1_summary()
    sessions_recent = _sessions_between(db, cutoff_recent, now)
    sessions_prior = _sessions_between(db, cutoff_window, cutoff_recent)

    # Cumulative (full window) for dominant/secondary
    combined = _merge(
        _l1_extension_counts(l1),
        _session_extension_counts(sessions_recent + sessions_prior),
    )
    manifesto_presence = l1.get("ecosystems_merged", {})
    cum_scores = _score(combined, manifesto_presence)
    dominant, secondary = _rank(cum_scores)

    # Time-windowed for emerging/declining
    recent_scores = _score(_session_extension_counts(sessions_recent), {})
    prior_scores = _score(_session_extension_counts(sessions_prior), {})
    emerging, declining = _detect_shifts(recent_scores, prior_scores)

    # Sanity: emerging/declining nunca repetem dominant exato
    # (ex: dominant=[rust], emerging=[rust] é redundante — a transição
    # já é capturada por declining=[go]). Mas em casos como o Exemplo C
    # da spec da frase (rust dominant + emerging, go declining) ambos
    # são informação útil; mantemos como está.

    return {
        "dominant": dominant,
        "secondary": secondary,
        "emerging": emerging,
        "declining": declining,
    }
```

---

## 3. `detect_evolution` — campo `evolution`

### Saída esperada

```json
{
  "has_evolution": true,
  "timeframe": "couple_years",
  "trajectory": "stack_migration"
}
```

Três campos:

- **`has_evolution`** — boolean. Decide se a frase pode usar elementos
  temporais ("últimos meses", "nos últimos dois anos").
- **`timeframe`** — categoria temporal cobrindo o histórico observado.
  Enum: `months` | `year` | `couple_years` | `many_years` | `insufficient_history`.
- **`trajectory`** — natureza da mudança detectada. Enum:
  `stack_migration` | `test_maturity_growth` | `workflow_shift` |
  `scope_broadening` | `scope_deepening` | `none`.

### `timeframe` — derivado do histórico real

```python
def _classify_timeframe(earliest: datetime, now: datetime) -> str:
    days = (now - earliest).days
    if days < 60:
        return "insufficient_history"
    if days < 240:           # ~8 meses
        return "months"
    if days < 540:           # ~18 meses
        return "year"
    if days < 1460:          # ~4 anos
        return "couple_years"
    return "many_years"
```

O `earliest` é o **mínimo** entre:
- `l1_aggregated.earliest_commit` (mais antigo)
- `started_at` mais antigo em `sessions` dentro da janela

Se ambos None: `timeframe = "insufficient_history"` e
`has_evolution = False`.

### `trajectory` — qual mudança domina

`detect_evolution` avalia cada candidato em ordem de prioridade. A
**primeira condição que atinge confiança suficiente é retornada**.

#### 1. `stack_migration`

Disparado quando o output de `classify_ecosystems` produz:
- `len(emerging) >= 1` **e** `len(declining) >= 1`, ou
- `len(emerging) >= 1` **e** o emerging é diferente de qualquer dominant
  anterior detectável.

Implementação:

```python
def _is_stack_migration(eco_block: dict) -> bool:
    if eco_block["declining"] and eco_block["emerging"]:
        return True
    if eco_block["emerging"]:
        # Emerging que ainda não é dominant indica migração em curso.
        return eco_block["emerging"][0] not in eco_block["dominant"]
    return False
```

#### 2. `test_maturity_growth`

Comparar `test_ratio` agregado em duas janelas:

```python
def _is_test_maturity_growth(db, recent_cutoff, window_cutoff) -> bool:
    recent_ratio = _avg_test_ratio(db, recent_cutoff, None)
    prior_ratio = _avg_test_ratio(db, window_cutoff, recent_cutoff)

    # +0.20 absolute em test_ratio E ratio recente ≥ 0.30. O segundo termo
    # evita "0.05 → 0.25" disparar (ainda baixo).
    return (recent_ratio - prior_ratio) >= 0.20 and recent_ratio >= 0.30
```

`_avg_test_ratio` agrega `has_test_context` (L2) e `test_ratio` (L1) na
janela. Peso 50/50 quando ambos presentes.

#### 3. `workflow_shift`

Compara distribuição de `workflow_pattern` entre as duas janelas. Se o
top-1 mudou **e** o novo top-1 tem share ≥ 40% na janela recente:

```python
def _is_workflow_shift(sessions_recent, sessions_prior) -> bool:
    top_recent = _top_workflow(sessions_recent)
    top_prior = _top_workflow(sessions_prior)
    if top_recent is None or top_prior is None:
        return False
    if top_recent == top_prior:
        return False
    recent_share = _workflow_share(sessions_recent, top_recent)
    return recent_share >= 0.40
```

#### 4. `scope_broadening`

Número de ecosystems distintos com share ≥ 8% cresceu de N para M
com M − N ≥ 2 entre janela prior e recente.

#### 5. `scope_deepening`

Inverso: número de ecosystems caiu, mas concentração no top-1
aumentou (≥ +0.20 em share).

#### 6. `none`

Nenhuma das condições acima. `has_evolution = False`.

### Tabela de calibração

| Trajectory | Condição | Threshold |
|------------|----------|-----------|
| `stack_migration` | emerging ∧ (declining ∨ emerging ∉ dominant) | — |
| `test_maturity_growth` | Δ test_ratio | +0.20 abs, recent ≥ 0.30 |
| `workflow_shift` | top workflow muda | nova share ≥ 0.40 |
| `scope_broadening` | Δ ecosystems com share ≥ 8% | +2 |
| `scope_deepening` | Δ ecosystems negativo + Δ top share | −1 e +0.20 |

### Assinatura

```python
def detect_evolution(
    db: BeheldDB,
    eco_block: dict,
    *,
    window_days: int = 180,
    emerging_window_days: int = 90,
    now: Optional[datetime] = None,
) -> dict:
    earliest = _earliest_signal(db, window_days, now)
    timeframe = _classify_timeframe(earliest, now or _now_utc()) if earliest else "insufficient_history"

    if timeframe == "insufficient_history":
        return {"has_evolution": False, "timeframe": timeframe, "trajectory": "none"}

    if _is_stack_migration(eco_block):
        return {"has_evolution": True, "timeframe": timeframe, "trajectory": "stack_migration"}

    cutoff_recent = (now or _now_utc()) - timedelta(days=emerging_window_days)
    cutoff_window = (now or _now_utc()) - timedelta(days=window_days)
    sessions_recent = _sessions_between(db, cutoff_recent, now)
    sessions_prior = _sessions_between(db, cutoff_window, cutoff_recent)

    if _is_test_maturity_growth(db, cutoff_recent, cutoff_window):
        return {"has_evolution": True, "timeframe": timeframe, "trajectory": "test_maturity_growth"}

    if _is_workflow_shift(sessions_recent, sessions_prior):
        return {"has_evolution": True, "timeframe": timeframe, "trajectory": "workflow_shift"}

    if _is_scope_broadening(sessions_recent, sessions_prior):
        return {"has_evolution": True, "timeframe": timeframe, "trajectory": "scope_broadening"}

    if _is_scope_deepening(sessions_recent, sessions_prior):
        return {"has_evolution": True, "timeframe": timeframe, "trajectory": "scope_deepening"}

    return {"has_evolution": False, "timeframe": timeframe, "trajectory": "none"}
```

Nota: `eco_block` é o output de `classify_ecosystems` — passado como
argumento para evitar recálculo. A ordem `classify_ecosystems → detect_evolution`
no orchestrator é **obrigatória**.

---

## 4. `classify_test_pattern` — campo `test_pattern`

### Discipline

Derivado de **test_ratio combinado**:

```python
def _combined_test_ratio(db, window_cutoff) -> float:
    l1_summary = db.get_l1_summary()
    l1_ratio = float(l1_summary.get("avg_test_ratio") or 0.0)

    sessions = _sessions_between(db, window_cutoff, None)
    if sessions:
        with_test = sum(1 for s in sessions if s.has_test_context)
        l2_ratio = with_test / len(sessions)
    else:
        l2_ratio = 0.0

    if l1_summary.get("total_repos", 0) == 0:
        return l2_ratio
    if not sessions:
        return l1_ratio
    # 50/50 weighting — neither layer dominates the discipline signal.
    return 0.5 * l1_ratio + 0.5 * l2_ratio
```

Faixas (espelham [identity-phrase-generator.md](identity-phrase-generator.md)):

| Discipline | test_ratio |
|------------|-----------|
| `strong` | > 0.5 |
| `moderate` | 0.3 – 0.5 |
| `low` | 0.1 – 0.3 |
| `minimal` | < 0.1 |

### Approach

Derivado de **`workflow_pattern` distribution** e timing dos test files:

| Approach | Condição |
|----------|----------|
| `tdd_dominant` | top workflow = `tdd`, share ≥ 0.60 |
| `tdd_partial` | top workflow = `tdd`, share entre 0.30 e 0.60 |
| `test_after` | top workflow = `test_after` ∨ `review_before_commit` |
| `test_seldom` | discipline ∈ {`low`, `minimal`} e workflow não é tdd |
| `exploratory` | default — não atingiu nenhuma das outras |

Workflow patterns vêm de `sessions.workflow_pattern` (já populado pelo
classificador legado em `classifiers/workflow.py`).

---

## 5. `classify_workflow` — campo `workflow`

### Primary

Top workflow pattern por share na janela completa. Empate resolvido por
volume absoluto, depois alfabético.

```python
def classify_workflow(db, window_cutoff) -> dict:
    sessions = _sessions_between(db, window_cutoff, None)
    primary = _top_workflow(sessions) or "exploratory"
    out = {"primary": primary}

    # Emerging workflow opcional — só emite se houver mudança significativa
    cutoff_recent = window_cutoff + (datetime.utcnow() - window_cutoff) / 2
    sessions_recent = [s for s in sessions if s.started_at >= cutoff_recent]
    sessions_prior = [s for s in sessions if s.started_at < cutoff_recent]
    top_recent = _top_workflow(sessions_recent)
    top_prior = _top_workflow(sessions_prior)
    if top_recent and top_prior and top_recent != top_prior:
        out["emerging"] = top_recent

    return out
```

Fallback quando não há nenhuma sessão classificada: `primary =
"exploratory"`.

---

## 6. `classify_timing` — campo `timing`

### Peak period

Reusa `extractors.timing.analyze_timing`. Mapeamento de `peak_hours[0]`
para enum do schema:

```python
def _peak_period_from_hour(hour: int) -> str:
    if 6 <= hour < 12:
        return "morning"
    if 12 <= hour < 18:
        return "afternoon"
    if 18 <= hour < 22:
        return "evening"
    if hour >= 22 or hour < 6:
        return "late_night"
    return "distributed"  # unreachable; kept para satisfazer mypy
```

**Distribuído** se a entropia das `peak_hours` (top 3) for alta:

```python
def _is_distributed(peak_hours: list[int], hour_counts: dict[int, int]) -> bool:
    if len(peak_hours) < 3:
        return False
    top_total = sum(hour_counts[h] for h in peak_hours[:3])
    grand_total = sum(hour_counts.values())
    # Se as top-3 horas representam < 40% do total, atividade é difusa.
    return (top_total / grand_total) < 0.40
```

### Consistency

Derivado de **dispersão entre dias da semana**:

```python
def _consistency(timestamps: list[str]) -> str:
    by_day = Counter(_parse(ts).date() for ts in timestamps if _parse(ts))
    if not by_day:
        return "sporadic"

    distinct_days = len(by_day)
    span_days = (max(by_day) - min(by_day)).days + 1
    activity_ratio = distinct_days / span_days  # dias ativos / dias totais

    if activity_ratio >= 0.6 and span_days >= 30:
        return "very_consistent"
    if activity_ratio >= 0.4:
        return "consistent"
    if activity_ratio >= 0.2:
        return "irregular"
    return "sporadic"
```

### Session length

Média de `duration_minutes` na janela:

| session_length | avg duration |
|----------------|--------------|
| `short` | < 30 min |
| `medium` | 30 – 60 min |
| `long` | 60 – 120 min |
| `marathon` | > 120 min |

Campo opcional (não-required no schema). Omitido se não houver sessão
com `duration_minutes > 0`.

---

## 7. `classify_tooling` — campo `tooling.platforms`

### Algoritmo

União dos sinais de plataforma de L1 + L2, deduplicado e mapeado para
o enum v1:

```python
def classify_tooling(db) -> dict:
    l1 = db.get_l1_summary()
    l1_platforms = set(l1.get("platforms_merged", {}).keys())

    l2_rows = db.connect().execute(
        "SELECT DISTINCT signal_value FROM technical_signals "
        "WHERE signal_type = 'platform'"
    ).fetchall()
    l2_platforms = {r["signal_value"] for r in l2_rows}

    # Translation: extractor usa "cloud_infra", "ci_cd"; schema usa
    # "terraform", "github_actions", etc. Mapping explícito.
    canonical = set()
    for raw in l1_platforms | l2_platforms:
        mapped = PLATFORM_RAW_TO_SCHEMA.get(raw, raw)
        if mapped in PLATFORMS:  # schema enum
            canonical.add(mapped)

    # Ordem por volume L1 (mais commits com aquele arquivo) com fallback
    # alfabético. `maxItems = 5` no schema.
    ordered = sorted(canonical, key=lambda p: (-_platform_volume(db, p), p))
    return {"platforms": ordered[:5]}
```

### Mapping legado → schema

```python
PLATFORM_RAW_TO_SCHEMA: dict[str, str] = {
    "ci_cd": "circleci",          # default; melhor refinar com presença de .circleci/
    "cloud_infra": "terraform",   # default; melhor refinar com aws/ vs gcp/
    "database": "postgres",       # default conservador; refinar por filename
    "mobile": None,               # mobile não é platform no schema v1
}
```

Quando o mapping retorna `None`, o sinal é descartado.

**TODO produção**: refinar mapping com inspeção de filenames (já
implementada em `git_extractor._detect_platforms`).

---

## 8. `classify_ai_usage` — campo `ai_usage` (opcional)

### Quando emitir

Apenas se `sample_size.confidence_band ∈ {high, medium}` E houver
> 30 sessões Claude Code (`source = "claude-code"`) na janela.

### Mapping

```python
def classify_ai_usage(db, window_cutoff) -> Optional[dict]:
    sessions = [s for s in _sessions_between(db, window_cutoff, None)
                if s.source == "claude-code"]
    if len(sessions) < 30:
        return None

    # primary_mode — derivado de tools_used distribution
    tool_pattern = _aggregate_tools(sessions)
    primary_mode = _classify_ai_mode(tool_pattern)

    # intensity — events por sessão
    total_events = sum(s.event_count for s in sessions)
    events_per_session = total_events / len(sessions)
    if events_per_session > 80:
        intensity = "heavy"
    elif events_per_session > 30:
        intensity = "moderate"
    else:
        intensity = "light"

    return {"primary_mode": primary_mode, "intensity": intensity}
```

`_classify_ai_mode` mapeia a distribuição de tools para o enum:

| Top tool category | primary_mode |
|-------------------|--------------|
| Read/Grep/Glob (search) > 50% | `code_understanding` |
| Edit/Write > 50% | `code_generation` |
| Bash com `pytest|rspec|jest` > 30% | `debugging` |
| Edit em arquivos pre-existentes > 60% | `refactoring` |
| Mistura sem domínio claro | `exploration` |

---

## 9. `classify_sample_size` — campo `sample_size.confidence_band`

```python
def classify_sample_size(db) -> dict:
    sessions = db.count_sessions()
    repos = len(db.get_l1_repositories())

    if sessions > 500 and repos > 5:
        band = "high"
    elif sessions >= 100 or (repos >= 3):
        band = "medium"
    elif sessions >= 30 or repos >= 1:
        band = "low"
    else:
        band = "minimal"

    return {"confidence_band": band}
```

Espelha exatamente a [tabela da spec da frase](identity-phrase-generator.md#faixas-qualitativas).

---

## 10. Orchestrator — composição final

```python
def classify_signals_payload(
    db: BeheldDB,
    *,
    window_days: int = 180,
    emerging_window_days: int = 90,
    now: Optional[datetime] = None,
) -> dict:
    """Build a v1 signals payload from the current DB state."""
    now = now or datetime.now(timezone.utc)
    window_cutoff = now - timedelta(days=window_days)

    eco_block = classify_ecosystems(
        db, window_days=window_days,
        emerging_window_days=emerging_window_days, now=now,
    )

    payload = {
        "schema_version": "1",
        "data_sources": {
            "l1": len(db.get_l1_repositories()) > 0,
            "l2": db.count_sessions() > 0,
        },
        "ecosystems": eco_block,
        "test_pattern": classify_test_pattern(db, window_cutoff),
        "workflow": classify_workflow(db, window_cutoff),
        "timing": classify_timing(db, window_cutoff),
        "evolution": detect_evolution(
            db, eco_block,
            window_days=window_days,
            emerging_window_days=emerging_window_days, now=now,
        ),
        "tooling": classify_tooling(db),
        "sample_size": classify_sample_size(db),
    }

    ai = classify_ai_usage(db, window_cutoff)
    if ai is not None:
        payload["ai_usage"] = ai

    # ── self-check: payload tem que validar contra o schema v1 antes de
    # sair do classificador. Falha aqui é bug do classificador, nunca do
    # consumidor.
    from identity.validators import validate_payload
    validate_payload(payload)  # raises jsonschema.ValidationError

    return payload
```

---

## 11. Determinismo e idempotência

**Determinismo:** dado o mesmo estado de DB e o mesmo `now`, o
classificador deve retornar **bytes idênticos**. Isso significa:

1. Nenhuma randomização (sem `random.choice`, sem ordering implícito).
2. Empates resolvidos por ordem alfabética.
3. Floats arredondados a 4 casas decimais antes de comparação de
   threshold (evita drift Python ↔ JS).
4. `datetime.now()` injetado, nunca chamado diretamente — fixture pode
   passar um instante fixo.

**Idempotência:** classificador é puro. Roda múltiplas vezes ⇒ resultado
idêntico ⇒ não corrompe DB. O IdentityGenerator pode ser invocado em
loop sem efeitos colaterais.

---

## 12. Testabilidade

### Estrutura de testes

```
packages/engine/tests/classifiers/signals/
├── __init__.py
├── conftest.py              # fábrica DB-em-memória pré-povoada
├── test_ecosystems.py       # cada caso de rank, shift detection
├── test_evolution.py        # cada trajectory enum
├── test_test_pattern.py
├── test_workflow.py
├── test_timing.py
├── test_tooling.py
├── test_ai_usage.py
├── test_sample_size.py
└── test_orchestrator.py     # payload completo passando validate_payload
```

### Padrão recomendado por subclassificador

```python
def test_dominant_when_single_strong_ecosystem(db_factory):
    db = db_factory(
        l1_repos=[{"ecosystems": {"rails": True}, "extension_counts": {"rb": 500}}],
        sessions=[],
    )
    result = classify_ecosystems(db)
    assert result["dominant"] == ["rails"]
    assert result["secondary"] == []
    assert result["emerging"] == []
```

`db_factory` é a fixture central — cria BeheldDB em memória,
povoa via APIs de save_l1_*, save_session, save_signals, e devolve.

### Casos canônicos a cobrir

| Subclassifier | Casos críticos |
|---------------|----------------|
| `ecosystems` | (a) só L1, (b) só L2, (c) ambos, (d) ninguém, (e) tie-break, (f) shift detectado, (g) shift abaixo do threshold, (h) ecosystem fora do enum descartado |
| `evolution` | cada trajectory enum, insufficient_history, prioridade quando múltiplas condições casam |
| `test_pattern` | cada faixa de discipline, cada enum de approach, sem L1/sem L2 |
| `workflow` | primary + emerging, sem sessões |
| `timing` | cada peak_period, consistent vs sporadic, distributed |
| `tooling` | dedup L1+L2, mapping legado→schema, raw que retorna None |
| `ai_usage` | abaixo de 30 sessões → None, cada primary_mode |
| `sample_size` | cada banda |
| `orchestrator` | payload passa `validate_payload` para 5 cenários canônicos da [identity spec](identity-phrase-generator.md#9-exemplos-completos-de-execu%C3%A7%C3%A3o) |

---

## 13. Critérios de pronto para produção

- [ ] Cada subclassificador isolado em arquivo próprio com docstring + testes unitários
- [ ] `classify_signals_payload` faz self-validation via `validate_payload`
- [ ] `db_factory` fixture cobre os 5 cenários canônicos da identity spec
- [ ] Determinismo verificado: chamar 100× com mesmo `now` produz payload byte-idêntico
- [ ] Mapping legado → schema documentado e revisado para cada plataforma e ecosystem
- [ ] Thresholds de calibração centralizados em `classifiers/signals/_thresholds.py` (não espalhados)
- [ ] Logging interno em `INFO` registrando trajectory escolhida + scores; útil para revisar calibração
- [ ] Bench: classificar payload de DB com 10k sessões + 50 repos termina em < 500ms p99
- [ ] Documentação interna: README em `classifiers/signals/` apontando para esta spec

---

## 14. Itens fora de escopo

- **Score numérico interno** (test_ratio, peak_hours como inteiros)
  permanece no DB e nos endpoints existentes (`/scores/current`,
  `/metrics/workflow`). Esta spec só cuida da projeção categórica para
  o LLM.
- **Schema v2** (com `code_review_pattern`, `documentation_habit`)
  é trabalho futuro. Quando vier, esta spec ganha um classificador
  paralelo `signals_v2/` mantendo compatibilidade backward via
  `schema_version`.
- **Recalibração automática** dos thresholds com base em revisão manual
  agregada — possível futuro, fora do MVP.

---

## 15. Referências

- [identity-phrase-generator.md](identity-phrase-generator.md) — schema v1 + tom da frase
- [packages/engine/src/storage/sqlite.py](../packages/engine/src/storage/sqlite.py) — fonte da verdade do schema do banco
- [packages/engine/src/extractors/files.py](../packages/engine/src/extractors/files.py) — mapping extensão → ecosystem legado
- [packages/engine/src/l1/git_extractor.py](../packages/engine/src/l1/git_extractor.py) — extração L1

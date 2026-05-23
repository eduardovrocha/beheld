# Beheld — Endpoint `POST /bundles`

> **Spec de implementação** · v1.0 · 2026-05-15
> Documento de referência única para o endpoint que orquestra a geração
> de bundle público — combinando snapshot assinado, sinais
> classificados e frase de identidade.

---

## Visão geral

`POST /bundles` é o **ponto de entrada único** para gerar um retrato
público. Hoje o engine expõe três endpoints relacionados —
`POST /snapshot/payload`, `POST /snapshot/save`,
e `GET /snapshot/latest` — que cobrem a parte criptográfica do
.beheld. Este endpoint **encapsula** esses três e adiciona:

1. Classificação categórica via `classify_signals_payload` (ver
   [classifier-signals-payload.md](classifier-signals-payload.md))
2. Geração de frase via `IdentityGenerator` (ver
   [identity-phrase-generator.md](identity-phrase-generator.md))
3. Persistência ligando snapshot ↔ identity_phrase
4. Resposta única com tudo necessário pra render HTML/OG/badge

**Endpoints existentes permanecem** — `snapshot/payload` e
`snapshot/save` continuam como API de baixo nível para clientes que
querem controle granular (e.g. CLI assinando offline). `POST /bundles`
é a API de alto nível, recomendada para o caminho típico.

```
                    POST /bundles  (novo, alto nível)
                          │
              ┌───────────┼──────────────────────────┐
              ▼           ▼                          ▼
   classify_signals   build_bundle_payload    IdentityGenerator
       _payload()      (existente)              .generate()
              │           │                          │
              │           ▼                          │
              │     payload + scores + l1 + l2       │
              │           │                          │
              └───────────┴──────────────────────────┘
                          │
                          ▼
                    snapshot save  (POST /snapshot/save interno)
                          │
                          ▼
                  identity_phrases save
                          │
                          ▼
                  BundleResponse (JSON)
```

---

## 1. Decisão fundamental — síncrono

O endpoint **é síncrono** e responde em até ~5s p99. Razões:

- O usuário invoca via `beheld share` ou via clique no dashboard —
  está esperando o link compartilhável. Polling intermediário pioraria UX.
- O custo dominante é o LLM (Haiku ~1–3s para o prompt do payload v1
  observado). Soma com classifier (~50ms) + snapshot (~30ms) + DB write
  (~10ms) fica abaixo do orçamento.
- `select_generation_path` desvia para fallback quando os sinais são
  fracos, dispensando LLM nesses casos.

### Quando reconsiderar async

Migrar para 202 + polling **apenas** se uma das três condições ficar
verdadeira em produção:

1. p95 do endpoint passar de **8 segundos**.
2. Custo médio de LLM por geração passar de **$0.005** (5× Haiku).
3. Demandar geração em paralelo de múltiplos bundles para um usuário
   (recomputação histórica em background).

Até lá: síncrono.

---

## 2. Contrato HTTP

### Request

```http
POST /bundles HTTP/1.1
Content-Type: application/json

{
  "force_regenerate": false,
  "period_days": 30
}
```

| Campo | Tipo | Default | Descrição |
|-------|------|---------|-----------|
| `force_regenerate` | bool | `false` | Se `true`, ignora cache e regenera identity phrase mesmo se já existir para o snapshot atual |
| `period_days` | int | `30` | Janela de agregação L2 passada para `build_bundle_payload` |

Body opcional — `POST /bundles` com body vazio é equivalente a
`{"force_regenerate": false, "period_days": 30}`.

### Response — sucesso (200)

```json
{
  "bundle": {
    "snapshot_id": 42,
    "hash": "sha256:abc...123",
    "previous_hash": "sha256:def...456",
    "created_at": "2026-05-15T14:00:00Z",
    "payload": { /* canonical BundlePayload v3 */ },
    "canonical_json": "{...}",
    "needs_signing": true
  },
  "identity": {
    "identity_long": "Dev backend de raiz Rails que migrou para Python ...",
    "identity_short": "Dev backend · Rails → Python",
    "confidence": "high",
    "generation_path": "llm",
    "model_used": "claude-haiku-4-5"
  },
  "signals": { /* signals_json v1 — útil para debug, ver seção 6 */ },
  "share": {
    "html_url": null,
    "badge_url": null,
    "og_image_url": null
  },
  "warnings": []
}
```

Campos importantes:

- **`bundle.needs_signing: true`** sempre. O engine nunca assina por
  conta própria — só o CLI tem a chave Ed25519. O cliente deve chamar
  `POST /snapshot/save` com a assinatura depois (ver seção 4).
- **`bundle.canonical_json`** é o JSON canonicalizado pronto pra
  hashear e assinar. Cliente **deve** verificar `hash ==
  "sha256:" + sha256(canonical_json)` antes de assinar.
- **`share.*_url`** é `null` no MVP — preenchido quando o serviço de
  hosting público entrar (fora do escopo desta spec).
- **`warnings`** lista degradações detectadas durante geração (ex:
  `identity_used_fallback`, `low_confidence_band`). Não impedem sucesso.

### Response — erros

| Código | Significado | Quando |
|--------|-------------|--------|
| `400` | Body malformado | JSON inválido, tipos errados |
| `409` | Pré-requisito não satisfeito | `< MIN_SESSIONS` (3), nenhum score computado |
| `422` | Classificador produziu payload inválido | Schema violation interna — bug |
| `500` | Falha inesperada | Logging interno dispara alerta |
| `503` | LLM externo indisponível **e** fallback também falhou validação de segurança | Extremamente raro — recai no minimal_template |

**Importante:** LLM indisponível **sozinho** não causa 503. O
orchestrator de identity automaticamente vai pro fallback, retorna 200
com `identity.generation_path = "fallback"`. Só vira 503 se o
fallback também falhar (validação de blacklist quebrada, classificador
bug catastrófico).

#### Exemplo de 409

```json
{
  "detail": "no scores available — run the engine on at least one session before snapshotting",
  "code": "no_scores_yet",
  "context": {
    "sessions_count": 1,
    "sessions_required": 3
  }
}
```

#### Exemplo de 200 com warning

```json
{
  "bundle": { /* ... */ },
  "identity": {
    "identity_long": "Dev Node em fase inicial de captura do perfil, com primeiros sinais em GitHub.",
    "identity_short": "Backend · Node",
    "confidence": "low",
    "generation_path": "fallback",
    "model_used": null
  },
  "signals": { /* ... */ },
  "warnings": [
    {"code": "identity_used_fallback", "reason": "minimal_confidence_band"}
  ]
}
```

---

## 3. Fluxo de execução

### Pseudocódigo do handler

```python
@app.post("/bundles")
def post_bundles(body: BundleRequest = BundleRequest()) -> BundleResponse:
    # ── 0. pré-requisitos ────────────────────────────────────────────
    sessions_count = db.count_sessions()
    if sessions_count < MIN_SESSIONS:
        raise HTTPException(status_code=409, detail={
            "code": "insufficient_sessions",
            "sessions_count": sessions_count,
            "sessions_required": MIN_SESSIONS,
        })

    scores = db.get_current_scores()
    if scores is None:
        raise HTTPException(status_code=409, detail={
            "code": "no_scores_yet",
            "hint": "run /process or wait for the scheduler",
        })

    # ── 1. classify signals ──────────────────────────────────────────
    try:
        signals = classify_signals_payload(db)  # já chama validate_payload
    except jsonschema.ValidationError as e:
        logger.error("classifier produced invalid payload: %s", e.message)
        raise HTTPException(status_code=422, detail={
            "code": "classifier_bug",
            "message": str(e.message),
        })

    # ── 2. cache check ──────────────────────────────────────────────
    latest_snapshot = db.get_latest_snapshot()
    if latest_snapshot and not body.force_regenerate:
        cached = _maybe_use_cache(latest_snapshot, signals)
        if cached is not None:
            return cached

    # ── 3. build bundle payload ─────────────────────────────────────
    try:
        bundle_payload = build_bundle_payload(
            db, VERSION, period_days=body.period_days,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail={"code": "build_failed", "message": str(e)})

    # Inject signals into payload v3 (ver seção 5)
    bundle_payload.signals_v1 = signals

    # ── 4. generate identity ────────────────────────────────────────
    identity = identity_generator.generate(signals, snapshot_id=None, persist=False)
    bundle_payload.identity = {
        "long": identity.identity_long,
        "short": identity.identity_short,
        "confidence": identity.confidence,
    }

    # ── 5. canonicalize ─────────────────────────────────────────────
    canonical = payload_to_canonical(bundle_payload)
    bundle_hash = "sha256:" + hashlib.sha256(canonical.encode()).hexdigest()

    warnings = _collect_warnings(identity, signals)

    return BundleResponse(
        bundle={
            "snapshot_id": None,  # preenchido quando o CLI chamar /snapshot/save
            "hash": bundle_hash,
            "previous_hash": (latest_snapshot or {}).get("hash"),
            "created_at": bundle_payload.created_at,
            "payload": dataclasses.asdict(bundle_payload),
            "canonical_json": canonical,
            "needs_signing": True,
        },
        identity=identity.to_dict(),
        signals=signals,
        share={"html_url": None, "badge_url": None, "og_image_url": None},
        warnings=warnings,
    )
```

### Sequência

```
1. validate body & gating (409s)
2. classify_signals_payload(db)      [~50ms]
3. validate_payload(signals)         [~5ms, raise → 422]
4. check cache (seção 4)             [~5ms; pode retornar cedo]
5. build_bundle_payload(db)          [~30ms]
6. IdentityGenerator.generate()      [~1–3s — bottleneck]
7. canonicalize + hash               [~10ms]
8. construct response                [~5ms]
```

Total típico: **~1.5–3.5s** com LLM, **~150ms** quando fallback é
selecionado direto.

---

## 4. Cache e invalidação

### Princípio

A frase de identidade é **cara de gerar** (LLM tem latência e custo). E
**estável** — sinais não mudam dramaticamente em horas. Cache existe
para evitar regenerar quando nada mudou.

### Estratégia: cache por **hash do payload v1**

```python
def _maybe_use_cache(latest_snapshot: dict, signals: dict) -> Optional[BundleResponse]:
    """Reuse the identity phrase if signals haven't changed materially."""
    signals_hash = _stable_hash(signals)
    cached_signals_hash = db.get_profile(f"signals_hash:{latest_snapshot['id']}")

    if cached_signals_hash != signals_hash:
        return None  # signals mudaram → regenerar

    identity = db.get_identity_phrase(latest_snapshot["id"])
    if identity is None:
        return None  # cache miss

    return BundleResponse(
        bundle={
            "snapshot_id": latest_snapshot["id"],
            "hash": latest_snapshot["hash"],
            "previous_hash": latest_snapshot["previous_hash"],
            "created_at": latest_snapshot["created_at"],
            "payload": json.loads(latest_snapshot["payload_json"]),
            "canonical_json": latest_snapshot["payload_json"],
            "needs_signing": False,  # já assinado e persistido
        },
        identity={
            "identity_long": identity["long"],
            "identity_short": identity["short"],
            "confidence": identity["confidence"],
            "generation_path": identity["generation_path"],
            "model_used": identity["model_used"],
        },
        signals=signals,
        share={"html_url": None, "badge_url": None, "og_image_url": None},
        warnings=[{"code": "served_from_cache"}],
    )
```

### `_stable_hash`

```python
def _stable_hash(payload: dict) -> str:
    """SHA-256 da serialização canonical do payload v1. Mesma função usada
    pelo bundle hash, garantindo consistência."""
    return hashlib.sha256(
        canonical_json(payload).encode("utf-8")
    ).hexdigest()
```

### Persistência do hash

Cada vez que um identity_phrase é gravado, salvamos também:

```python
db.set_profile(f"signals_hash:{snapshot_id}", _stable_hash(signals))
```

Linha no `profile` table — leve, sem schema novo necessário.

### Quando o cache **invalida**

| Trigger | Mecanismo |
|---------|-----------|
| `force_regenerate=true` no request | Pula step de cache check |
| Sinais mudaram (`_stable_hash` diferente) | Regenera automaticamente |
| Snapshot novo foi criado | snapshot_id muda → cache miss |
| identity_phrase deletada manualmente | cache miss |
| Schema do payload sobe pra v2 | `_stable_hash` muda (campo novo) → invalida tudo |

### Quando o cache **não** invalida (intencional)

- Dia novo, mesmos sinais. A frase não envelhece a cada 24h —
  envelhece quando o comportamento muda. Sem "TTL de identidade".
- LLM model bumpado (Haiku 4.5 → 4.6). Cliente que queira regenerar
  passa `force_regenerate=true`. O `model_used` no banco serve de
  audit trail.
- Texto da identity legível, mas internamente confidence baixa. O
  warning sinaliza, não invalida automaticamente.

---

## 5. Mudança no `BundlePayload` — versão 3

### Diff de schema

O `BundlePayload` atual ([models.py](../packages/engine/src/models.py))
contém `created_at, beheld_version, previous_hash, scores, l1, l2`.

V3 adiciona:

```python
@dataclass(frozen=True)
class BundlePayload:
    created_at: str
    beheld_version: str
    previous_hash: Optional[str]
    scores: Scores
    l1: BundleL1Section
    l2: BundleL2Section
    # ── new in v3 ───────────────────────────────────────────────────
    schema_version: str = "3"
    signals_v1: Optional[dict] = None
    identity: Optional[dict] = None
```

Campos `signals_v1` e `identity` são **dicts opacos** do ponto de vista
do bundle — não há dataclass dedicado porque eles já têm schema próprio
(o v1 do classifier, e os 3 campos da identity). Documentação clara
em docstring do dataclass.

### `signals_v1` no bundle — por quê

Embarcar o signals_json no bundle público tem dois benefícios:

1. **Auditabilidade.** Quem inspeciona o .beheld vê os sinais
   categóricos que produziram a frase. Frase + sinais juntos formam
   contrato verificável.
2. **Regeneração futura.** Cliente pode regenerar a frase localmente
   sem reabrir o classificador inteiro.

Custo: payload cresce ~500 bytes. Aceitável.

### Backward compatibility

Bundle v3 lê v2 sem problema (campos novos têm default `None`). Bundle
v2 lê v3 ignorando campos extras (JSON é permissivo). O hash muda
quando o payload muda, então **snapshots v2 antigos têm hash diferente
do que teriam em v3** — mas o `previous_hash` continua válido para a
cadeia, porque cada snapshot só referencia o anterior por hash imutável.

### Twin TypeScript

`packages/cli/src/bundle/canonical.ts` precisa ser atualizado para v3
**antes** do release do endpoint. Ver tarefa em
[critérios de pronto](#11-critérios-de-pronto-para-produção).

---

## 6. Por que `signals` no response

A primeira leitura sugere "signals já está dentro de `bundle.payload` —
duplicação?". Sim, mas:

- **Bundle.payload** é o objeto canonicalizado, otimizado pra assinatura.
- **`signals` no topo** é a forma navegável (objeto JS), pronta pra
  consumir no dashboard sem re-parse do canonical.

Pequena duplicação no JSON da resposta vale o ergonômico no cliente.

---

## 7. Persistência detalhada

### Tabelas envolvidas

| Tabela | Operação |
|--------|----------|
| `snapshots` | INSERT após signing pelo CLI (via `POST /snapshot/save`) |
| `identity_phrases` | INSERT no fluxo de `/bundles`, vinculado ao snapshot_id |
| `profile` | SET `signals_hash:{snapshot_id} = <hash>` para cache |

### Ordem de gravação

`POST /bundles` **não** grava no `snapshots` direto — apenas devolve o
canonical pronto pra assinatura. A gravação fica para
`POST /snapshot/save`, que é chamado pelo CLI/dashboard depois de
assinar com Ed25519.

**Mas** o identity_phrase é gravado **antes** do snapshot existir.
Como ligar?

#### Opção escolhida: dois passos

1. `POST /bundles` chama `identity_generator.generate(signals,
   snapshot_id=None, persist=False)`. Retorna a frase no response, sem
   persistir.
2. Cliente assina e chama `POST /snapshot/save` com a assinatura.
3. `POST /snapshot/save` (handler atualizado) detecta que veio do fluxo
   /bundles via campo `identity_phrase: {...}` no body, e persiste
   tanto o snapshot quanto a identity_phrase com `snapshot_id` correto.

```python
class SnapshotSaveBody(BaseModel):
    hash: str = Field(..., pattern=r"^sha256:[0-9a-f]{64}$")
    previous_hash: Optional[str] = Field(None, pattern=r"^sha256:[0-9a-f]{64}$")
    payload_json: str
    bundle_path: Optional[str] = None
    # ── new ──
    identity_phrase: Optional[dict] = None
    signals_hash: Optional[str] = None

@app.post("/snapshot/save")
def snapshot_save(body: SnapshotSaveBody) -> dict:
    snap_id = db.save_snapshot(
        bundle_hash=body.hash,
        previous_hash=body.previous_hash,
        payload_json=body.payload_json,
        bundle_path=body.bundle_path,
    )

    if body.identity_phrase:
        db.save_identity_phrase(
            long=body.identity_phrase["identity_long"],
            short=body.identity_phrase["identity_short"],
            confidence=body.identity_phrase["confidence"],
            generation_path=body.identity_phrase["generation_path"],
            model_used=body.identity_phrase.get("model_used"),
            snapshot_id=snap_id,
        )

    if body.signals_hash:
        db.set_profile(f"signals_hash:{snap_id}", body.signals_hash)

    return {"ok": True, "id": snap_id, "hash": body.hash}
```

### Vantagens dessa abordagem

- Não força engine a conhecer a chave Ed25519.
- Transação atômica no `/snapshot/save` (snapshot + identity + cache hash).
- Cliente que use só `/bundles` sem assinar (modo dev) consegue o
  preview sem efeitos colaterais no banco.

---

## 8. Concurrency e idempotência

### Concurrent requests

`POST /bundles` é seguro chamar concorrentemente. Cada chamada:

1. Lê estado consistente do DB (transaction-isolation level: SQLite
   `default deferred` é suficiente — leituras são consistentes).
2. Classifica sinais (puro, sem efeito colateral).
3. Chama LLM (idempotente do ponto de vista do sistema; pode produzir
   frases ligeiramente diferentes pelo `temperature=0.7`).
4. Retorna response sem persistir.

Persistência só ocorre quando `/snapshot/save` é chamado, e essa
operação tem `UNIQUE(hash)` que previne duplicata exata. Hashes
diferentes (ex: 2 requests concorrentes geraram frases diferentes →
canonical diferente → hashes diferentes) **ambos passam**, criando
2 snapshots distintos na cadeia. Comportamento aceitável — usuário vê
ambos no histórico.

### Idempotência de `/bundles`

`POST /bundles` com `force_regenerate=false` é "idempotente em espírito":
chamadas repetidas com mesmo estado de DB devolvem **mesma identity**
(via cache) e **mesmo hash** (canonicalização é determinística).

Com `force_regenerate=true` ou após mudança de DB, hash e identity podem
mudar — mas isso é semântica esperada, não bug.

---

## 9. Observabilidade

### Logs estruturados

Cada request emite:

```json
{
  "endpoint": "/bundles",
  "duration_ms": 2340,
  "stages": {
    "classify": 47,
    "build_payload": 31,
    "identity_generate": 2210,
    "canonicalize": 12,
    "respond": 5
  },
  "identity_path": "llm",
  "confidence_band": "high",
  "cache_hit": false,
  "warnings": []
}
```

### Métricas (Prometheus-ready se exposto futuramente)

| Métrica | Tipo | Tag |
|---------|------|-----|
| `bundles_total` | counter | `path={llm,fallback,minimal,cache}` |
| `bundles_duration_ms` | histogram | `stage={classify,identity,...}` |
| `bundles_errors_total` | counter | `code={409,422,500,503}` |
| `bundles_llm_cost_estimate` | counter | tokens × pricing |

### Alertas

| Condição | Severidade |
|----------|------------|
| `minimal_template` path > 0.5% em 1h | Page (bug catastrófico) |
| `fallback` path > 40% em 24h | Warn (classificador precisa ajuste) |
| `bundles_duration_ms p99` > 8s em 5min | Warn |
| `bundles_errors_total{code="500"}` > 5 em 5min | Page |
| `bundles_errors_total{code="503"}` > 0 | Page |

---

## 10. Implementação — checklist de arquivos

| Arquivo | Mudança |
|---------|---------|
| `packages/engine/src/api.py` | Adicionar handler `POST /bundles` |
| `packages/engine/src/api.py` | Atualizar `POST /snapshot/save` para aceitar `identity_phrase` opcional |
| `packages/engine/src/models.py` | Adicionar campos `schema_version`, `signals_v1`, `identity` ao `BundlePayload`; bump `BUNDLE_PAYLOAD_VERSION = "3"` |
| `packages/engine/src/bundle.py` | Garantir que `payload_to_canonical` lida com os novos campos |
| `packages/engine/src/classifiers/signals/` | Implementar `classify_signals_payload` (ver [classifier spec](classifier-signals-payload.md)) |
| `packages/cli/src/bundle/canonical.ts` | Twin TypeScript atualizado pra v3 (preserva ordering, ignora unknown fields) |
| `packages/engine/tests/test_api.py` | Cobrir os 4 cenários canônicos (sucesso, 409 insuficiente, fallback, cache hit) |
| `packages/engine/tests/test_bundle_contract.py` | Atualizar fixture pra v3, novo hash esperado |

---

## 11. Critérios de pronto para produção

- [ ] Handler `POST /bundles` implementado em `api.py` com docstring referenciando esta spec
- [ ] Body Pydantic com defaults sãos, validação clara
- [ ] Pré-requisitos checados (409 claros, com `code` e `context`)
- [ ] `classify_signals_payload` integrado, falha → 422 com detail
- [ ] `IdentityGenerator` invocado com `persist=False`
- [ ] Cache lookup via `_stable_hash` antes de chamar LLM
- [ ] `BundlePayload` v3 com `signals_v1` e `identity` embarcados
- [ ] `POST /snapshot/save` aceita `identity_phrase` e grava ligado ao snapshot_id correto
- [ ] Canonical JSON v3 idêntico entre Python e TypeScript (test_bundle_contract atualizado)
- [ ] Logs estruturados emitidos com stages e durations
- [ ] Tests: sucesso, 409 sem scores, 409 sem sessões, 422 classifier bug, cache hit, fallback path, force_regenerate
- [ ] Latência p99 < 5s em fixture com 100 sessões
- [ ] Documentação no README do engine apontando para esta spec
- [ ] Migration de schema do `BundlePayload` documentada (mas backward-compat mantida via defaults)

---

## 12. Itens fora de escopo desta spec

- **Geração das URLs `share.*_url`** — depende do serviço de hosting
  público, ainda não definido.
- **Re-geração agendada** (background job que regenera fallbacks
  antigos quando dev acumula sinais) — futuro, ver
  [identity-phrase-generator.md §12](identity-phrase-generator.md#12-itens-fora-de-escopo-desta-spec).
- **Rate limiting** — endpoint local, escopo single-user, sem
  necessidade no MVP. Se virar API pública, voltar aqui.
- **API key auth** — engine roda em localhost, sem auth no MVP.
- **Streaming response** — endpoint síncrono, não-streaming. Reconsiderar
  só se o cliente quiser feedback incremental (improvável).

---

## 13. Referências

- [identity-phrase-generator.md](identity-phrase-generator.md) — gerador da frase
- [classifier-signals-payload.md](classifier-signals-payload.md) — produtor do signals_json
- [identity-validation-plan.md](identity-validation-plan.md) — plano E2E
- [packages/engine/src/api.py](../packages/engine/src/api.py) — endpoints atuais
- [packages/engine/src/bundle.py](../packages/engine/src/bundle.py) — canonicalização atual

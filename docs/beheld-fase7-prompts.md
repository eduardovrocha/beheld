# DevProfile — Prompts de Execução: Fase 7 (Claimed vs Demonstrated)

> Execute um prompt por sessão no Claude Code.
> Cada prompt é autossuficiente — contém contexto, objetivo, critérios e o que NÃO fazer.
> Ordem obrigatória: F7.1 → F7.2 → F7.3 → F7.4 → F7.5 → F7.6 → F7.7

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

## Princípios da Fase 7 (cole também junto do contexto global)

```
A Fase 7 introduz Claimed vs Demonstrated — o dev opcionalmente se declara
(cargo, stack, anos, etc.) e o DevProfile compara contra os sinais reais
(L1 + L2), produzindo um delta verificável.

Princípios não-negociáveis:

1. DevProfile é testemunha, não juiz. Nunca afirma "esse dev é bom".
   Relata: "ele se descreveu assim. Aqui está o que ele faz. Decide você."

2. Auto-declaração é INPUT pra verificação, não conteúdo pra display.
   O que aparece publicamente é sempre o DELTA — claim + observação + status.

3. Três estados de verificação, cada um significativo:
   - confirmed       (✓) — sinais batem com a declaração
   - discrepant      (⚠) — sinais limitados ou contradizem (NUNCA "mentira")
   - insufficient_data (⚠) — dados insuficientes pra verificar
   - self_declared   (ℹ) — DevProfile não verifica esse tipo de claim

4. O dev pode publicar bundle com ⚠ visível. É o caminho da transparência
   radical. Produto avisa, dev decide.

5. Claims envelhecem. Cada novo bundle recalcula verification_status com
   base nos sinais correntes. Bundle anterior fica congelado.

6. Self-declared (ℹ) aparece em BLOCO SEPARADO, claramente demarcado como
   "self-declared, not verified by DevProfile" — protege o sinal do que é
   efetivamente verificado.

Tipos de claim do MVP (5 verifiable + 4 self-declared):

Verificáveis pelo DevProfile:
  - primary_stack       — top linguagens em L1+L2
  - years_experience    — derivado do earliest_commit em L1
  - specialization      — front/back/fullstack/devops/data via ecosystems
  - test_discipline     — workflow_distribution + test_ratio
  - work_pattern        — timing signals de L2

Self-declared (DevProfile não verifica, exibe com etiqueta):
  - employment_history  — empregadores e datas
  - education           — formação acadêmica
  - certifications      — certificações
  - role_at_company     — cargos específicos em empresas específicas
```

---

## F7.1 — Modelo de dados de claims

```
Implemente o modelo de dados de claims no scoring engine Python (packages/engine).

### Contexto

A Fase 7 introduz duas novas tabelas que persistem as declarações do dev e o
estado mais recente de verificação de cada uma. A verificação é recalculada
a cada snapshot — o bundle anterior fica congelado, o próximo recalcula.

Para MVP, persiste apenas o latest_status por claim (sem histórico de
verificações). Histórico pode entrar em fase futura como tabela separada
claim_verifications.

### O que implementar

**1. Migration SQLite em packages/engine/src/storage/sqlite.py**

Tabela `claims`:
  - id INTEGER PRIMARY KEY AUTOINCREMENT
  - claim_type TEXT NOT NULL CHECK (claim_type IN (
      'primary_stack', 'years_experience', 'specialization',
      'test_discipline', 'work_pattern',
      'employment_history', 'education', 'certifications', 'role_at_company'
    ))
  - claim_value TEXT NOT NULL                     (JSON serializado)
  - declared_at TEXT NOT NULL                     (ISO-8601)
  - is_active INTEGER NOT NULL DEFAULT 1          (0 quando removido logicamente)
  - latest_status TEXT                            (nullable até primeira verificação)
  - latest_observation TEXT                       (texto humano, ex: "87% das sessões em Python/TS")
  - latest_evidence_anchors TEXT DEFAULT '{}'     (JSON: session_count, repo_hashes, etc)
  - latest_verified_at TEXT                       (ISO-8601 da última verificação)

Index: CREATE INDEX idx_claims_active ON claims(is_active, claim_type)

**2. Funções CRUD em packages/engine/src/storage/sqlite.py**

  save_claim(claim_type: str, claim_value: dict, declared_at: str) -> int
    → insere claim com is_active=1, retorna claim_id
    → claim_value é serializado como JSON

  list_active_claims() -> list[dict]
    → retorna todas as claims com is_active=1
    → cada dict: {id, claim_type, claim_value, declared_at, latest_status,
                  latest_observation, latest_evidence_anchors, latest_verified_at}
    → claim_value e evidence_anchors já desserializados

  deactivate_claim(claim_id: int) -> bool
    → seta is_active=0, retorna True se encontrou e atualizou

  update_claim_verification(
      claim_id: int, status: str, observation: str, evidence_anchors: dict
  ) -> None
    → atualiza latest_status, latest_observation, latest_evidence_anchors,
      latest_verified_at (= now())
    → status DEVE estar em {confirmed, discrepant, insufficient_data, self_declared}

  get_claim_by_id(claim_id: int) -> dict | None

### O que NÃO implementar

- Histórico de verificações (tabela claim_verifications) — fase futura
- Soft delete via flag separada — usar is_active
- Versionamento de schema — usar migration linear igual às tabelas existentes

### Testes em packages/engine/tests/claims/test_storage.py

- test_save_claim_returns_id
- test_save_claim_serializes_value_as_json
- test_save_claim_rejects_invalid_claim_type (CHECK constraint)
- test_list_active_claims_excludes_deactivated
- test_list_active_claims_deserializes_value
- test_deactivate_claim_sets_is_active_zero
- test_deactivate_claim_returns_false_when_not_found
- test_update_claim_verification_sets_all_fields
- test_update_claim_verification_rejects_invalid_status

### Critério de conclusão

pytest packages/engine/tests/claims/test_storage.py → todos os testes passando
Migration aplicada sem erro em banco existente (não-destrutiva)
Tabela claims criada com schema correto (verificar via sqlite3 CLI)
```

---

## F7.2 — Claim verifiers (uma classe por claim_type)

```
Implemente os verifiers de claims no scoring engine Python
(packages/engine/src/claims/).

### Contexto

Cada claim_type tem um verifier que recebe o valor declarado e os sinais
agregados (L1 + L2), e retorna um VerificationResult com status, observação
humana e evidence anchors.

Para self-declared claims, existe um único SelfDeclaredVerifier que sempre
retorna status="self_declared" — o produto declara abertamente que não
verifica esse tipo.

### O que implementar

**1. Base class e dataclasses em packages/engine/src/claims/base.py**

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import ClassVar, Literal

VerificationStatus = Literal[
    "confirmed", "discrepant", "insufficient_data", "self_declared"
]

@dataclass
class VerificationResult:
    status: VerificationStatus
    observation: str
    evidence_anchors: dict = field(default_factory=dict)

class ClaimVerifier(ABC):
    claim_type: ClassVar[str]

    @abstractmethod
    def verify(
        self,
        claim_value: dict,
        l1_aggregated: dict,
        l2_signals: dict,
    ) -> VerificationResult: ...
```

**2. PrimaryStackVerifier em packages/engine/src/claims/primary_stack.py**

claim_type = "primary_stack"
claim_value: { "languages": ["python", "typescript"] }

Lógica:
  - Calcular top N linguagens combinando L1 (file_extensions) + L2 (session
    extensions) com pesos 60/40
  - Se TODAS as linguagens declaradas estão no top 5 → confirmed
  - Se PELO MENOS UMA está mas outras não → discrepant
  - Se NENHUMA está no top 10 → discrepant
  - Se L1+L2 vazios → insufficient_data

Observation exemplos:
  - "Confirmado. 87% das sessões em Python/TS nos últimos 90 dias, 8 repos
     em L1 com essas linguagens."
  - "Sinal limitado. Python aparece em 73% das sessões (top 1), mas Rust
     aparece em apenas 2% (não está no top 10)."

Evidence anchors:
  - session_count_total, session_count_match, l1_repos_match (lista de root_hashes)

**3. YearsExperienceVerifier em packages/engine/src/claims/years_experience.py**

claim_type = "years_experience"
claim_value: { "years": 8 }

Lógica:
  - Calcular anos = (now - l1.earliest_commit) / 365.25
  - Se anos >= claimed * 0.85 → confirmed (margem 15%)
  - Se anos entre claimed * 0.50 e claimed * 0.85 → discrepant
  - Se anos < claimed * 0.50 → discrepant (gap grande)
  - Se L1 vazio → insufficient_data

Observation exemplos:
  - "Confirmado. L1 mostra atividade contínua desde 2017 (8.2 anos)."
  - "Sinal limitado. L1 mostra 3.4 anos de atividade git, contra 8 anos
     declarados. Anos anteriores podem estar fora dos repositórios importados."

Evidence anchors:
  - earliest_commit_date, calculated_years, l1_repos_count

**4. SpecializationVerifier em packages/engine/src/claims/specialization.py**

claim_type = "specialization"
claim_value: { "area": "backend" }
áreas válidas: "backend", "frontend", "fullstack", "devops", "data", "mobile"

Lógica:
  - Mapear cada área a um conjunto de ecosystems esperados:
    - backend: {rails, django, fastapi, node, spring, go, ...}
    - frontend: {react, vue, angular, svelte, nextjs, ...}
    - fullstack: backend ∩ frontend ambos com presença significativa
    - devops: {docker, kubernetes, terraform, ansible, ...}
    - data: {pandas, spark, dbt, airflow, jupyter, ...}
    - mobile: {react-native, flutter, swift, kotlin-android, ...}
  - Combinar ecosystems de L1 + L2
  - Se >= 60% dos ecosystems detectados pertencem ao set da área declarada → confirmed
  - Se entre 30%-60% → discrepant
  - Se < 30% → discrepant
  - Se L1+L2 vazios → insufficient_data

Observation exemplos:
  - "Confirmado. 78% dos ecosystems detectados são de backend
     (rails, fastapi, postgres, redis)."
  - "Sinal limitado. Backend aparece em 22% dos ecosystems; predominância
     em frontend (react, nextjs, tailwind)."

Evidence anchors:
  - matching_ecosystems, total_ecosystems, match_ratio

**5. TestDisciplineVerifier em packages/engine/src/claims/test_discipline.py**

claim_type = "test_discipline"
claim_value: { "discipline": "tdd_first" }
disciplinas válidas: "tdd_first", "test_after", "test_light"

Lógica:
  - Pegar workflow_distribution do L2 e test_ratio do L1+L2
  - tdd_first: workflow["tdd"] >= 0.30 AND test_ratio >= 0.30 → confirmed
  - test_after: workflow["test-after"] >= 0.40 AND test_ratio >= 0.15 → confirmed
  - test_light: test_ratio < 0.15 → confirmed
  - Mismatch entre claim e dados → discrepant
  - L2 sessions < 30 → insufficient_data

Observation exemplos:
  - "Confirmado. 38% das sessões mostram padrão TDD-first (testes antes de
     implementação). Test ratio: 42%."
  - "Sinal limitado. Padrão dominante é test-after (39%), não TDD-first."

Evidence anchors:
  - workflow_distribution, test_ratio, sessions_analyzed

**6. WorkPatternVerifier em packages/engine/src/claims/work_pattern.py**

claim_type = "work_pattern"
claim_value: { "pattern": "early_bird" }
patterns válidos: "early_bird" (6h-12h), "balanced" (9h-18h), "night_owl" (18h-2h)

Lógica:
  - Pegar peak_hours de L2.timing_signals
  - Se >= 60% das horas de pico caem na faixa do pattern declarado → confirmed
  - Se 30%-60% → discrepant
  - Se < 30% → discrepant
  - L2 sessions < 30 → insufficient_data

Observation exemplos:
  - "Confirmado. Pico de atividade entre 14h e 23h, alinhado com night_owl."
  - "Sinal limitado. Pico observado entre 9h-15h (balanced), contra
     early_bird declarado."

Evidence anchors:
  - peak_hours, match_ratio, sessions_analyzed

**7. SelfDeclaredVerifier em packages/engine/src/claims/self_declared.py**

claim_types: ["employment_history", "education", "certifications", "role_at_company"]

verify() retorna sempre:
  VerificationResult(
    status="self_declared",
    observation="DevProfile não verifica esse tipo de declaração.",
    evidence_anchors={}
  )

**8. Registry em packages/engine/src/claims/__init__.py**

```python
VERIFIERS: dict[str, ClaimVerifier] = {
    "primary_stack": PrimaryStackVerifier(),
    "years_experience": YearsExperienceVerifier(),
    "specialization": SpecializationVerifier(),
    "test_discipline": TestDisciplineVerifier(),
    "work_pattern": WorkPatternVerifier(),
    "employment_history": SelfDeclaredVerifier(),
    "education": SelfDeclaredVerifier(),
    "certifications": SelfDeclaredVerifier(),
    "role_at_company": SelfDeclaredVerifier(),
}

def verify_claim(
    claim_type: str, claim_value: dict, l1_aggregated: dict, l2_signals: dict
) -> VerificationResult:
    verifier = VERIFIERS.get(claim_type)
    if verifier is None:
        raise ValueError(f"Unknown claim_type: {claim_type}")
    return verifier.verify(claim_value, l1_aggregated, l2_signals)
```

### O que NÃO implementar

- Verifiers para tipos não-MVP (cargo específico, ferramentas, etc) — fase futura
- LLM nos verifiers — toda lógica deve ser determinística e rápida (< 50ms)
- Score numérico de verificação — apenas os 4 status enum

### Testes em packages/engine/tests/claims/test_verifiers.py

Para cada verifier, testar:
- happy path (confirmed)
- discrepant path (mismatch)
- insufficient_data path (L1+L2 vazios ou abaixo do mínimo)
- observation contém números/evidências corretos

Para SelfDeclaredVerifier:
- test_self_declared_always_returns_self_declared_status
- test_self_declared_observation_is_consistent

### Critério de conclusão

pytest packages/engine/tests/claims/test_verifiers.py → todos passando
Cada verifier executa em < 50ms para entrada típica (medir com timing)
Registry resolve corretamente todos os 9 claim_types
```

---

## F7.3 — Endpoints FastAPI de claims

```
Implemente os endpoints HTTP para gestão de claims no scoring engine
(packages/engine/src/main.py).

### Contexto

CLI (TypeScript) chama o engine (Python) via HTTP para todas operações de
claims: declarar, listar, remover, verificar. Verificação retorna o delta
imediatamente para o usuário pré-visualizar.

### O que implementar

**1. Endpoint POST /claims**

Body:
  {
    "claim_type": "primary_stack",
    "claim_value": { "languages": ["python", "typescript"] }
  }

Resposta 201:
  {
    "id": 1,
    "claim_type": "primary_stack",
    "claim_value": { ... },
    "declared_at": "2026-05-20T14:00:00Z",
    "verification": {
      "status": "confirmed",
      "observation": "...",
      "evidence_anchors": { ... }
    }
  }

Fluxo:
  1. Validar claim_type contra registry
  2. Validar claim_value contra schema do tipo (use Pydantic models por tipo)
  3. save_claim() → claim_id
  4. Carregar l1_aggregated + l2_signals (funções existentes)
  5. verify_claim() → VerificationResult
  6. update_claim_verification() persiste o resultado
  7. Retornar claim + verification

**2. Endpoint GET /claims**

Query params: ?include_inactive=false (default false)

Resposta:
  {
    "claims": [
      {
        "id": 1,
        "claim_type": "primary_stack",
        "claim_value": { "languages": [...] },
        "declared_at": "...",
        "verification": {
          "status": "confirmed",
          "observation": "...",
          "evidence_anchors": { ... },
          "verified_at": "..."
        }
      },
      ...
    ]
  }

**3. Endpoint DELETE /claims/{id}**

  → 204 No Content se sucesso
  → 404 se claim_id não existe ou já está inativo

**4. Endpoint POST /claims/verify-all**

Sem body. Re-executa verify para TODAS as claims ativas. Usado pelo CLI antes
de gerar snapshot.

Resposta:
  {
    "claims": [ ... mesma estrutura do GET /claims, com verificações
                    recém-recalculadas ],
    "summary": {
      "total": 5,
      "confirmed": 3,
      "discrepant": 1,
      "insufficient_data": 0,
      "self_declared": 1
    }
  }

Performance: deve completar em < 500ms para 20 claims (verifiers são rápidos).

### Schemas Pydantic em packages/engine/src/api/schemas.py

Definir schemas por claim_type para validar claim_value:

```python
class PrimaryStackValue(BaseModel):
    languages: list[str] = Field(min_length=1, max_length=10)

class YearsExperienceValue(BaseModel):
    years: int = Field(ge=0, le=80)

class SpecializationValue(BaseModel):
    area: Literal["backend", "frontend", "fullstack", "devops", "data", "mobile"]

class TestDisciplineValue(BaseModel):
    discipline: Literal["tdd_first", "test_after", "test_light"]

class WorkPatternValue(BaseModel):
    pattern: Literal["early_bird", "balanced", "night_owl"]

# Self-declared types — schema livre (string ou dict permitido)
class EmploymentHistoryValue(BaseModel):
    employers: list[dict]  # {company, role, start, end}

# ... e assim por diante
```

### O que NÃO implementar

- Endpoint de bulk insert de claims — uma claim por request
- Endpoint que retorna verificação SEM persistir — verificação sempre persiste
- Re-verificação automática no GET — só no POST /claims/verify-all

### Testes em packages/engine/tests/claims/test_endpoints.py

- test_post_claims_creates_and_verifies
- test_post_claims_rejects_invalid_type_returns_400
- test_post_claims_rejects_invalid_value_returns_422
- test_get_claims_returns_only_active_by_default
- test_get_claims_include_inactive_true
- test_delete_claims_returns_204
- test_delete_claims_not_found_returns_404
- test_delete_claims_idempotent_on_already_inactive (segunda chamada retorna 404)
- test_post_verify_all_recomputes_status
- test_post_verify_all_summary_counts_correct

### Critério de conclusão

pytest packages/engine/tests/claims/test_endpoints.py → todos passando
POST /claims com cada um dos 9 tipos funciona end-to-end
POST /claims/verify-all com 20 claims completa em < 500ms
```

---

## F7.4 — CLI: comando devprofile claims

```
Implemente os comandos CLI para gestão de claims em
packages/cli/src/commands/claims.ts.

### Contexto

CLI expõe 3 subcomandos: add (wizard interativo), list (tabela), remove
(confirmação + delete). O wizard pré-visualiza a verificação antes de salvar
— se o status for ⚠, exibe aviso claro mas permite confirmar mesmo assim.

Componente de UX: usar @inquirer/prompts (já em uso no devprofile init wizard).

### O que implementar

**1. devprofile claims add — wizard interativo**

Fluxo:
  1. select claim_type (lista dos 9 tipos com descrições curtas)
  2. input claim_value (UI específica por tipo)
  3. POST /claims → recebe verificação
  4. Exibe pré-visualização:

     ┌─ Declaração a ser publicada ─────────────────────────┐
     │                                                       │
     │  Tipo: Stack principal                               │
     │  Valor: Python, TypeScript                           │
     │                                                       │
     │  Verificação: ✓ Confirmado                           │
     │  87% das sessões em Python/TS nos últimos 90 dias.   │
     │  8 repositórios em L1 com essas linguagens.          │
     │                                                       │
     └───────────────────────────────────────────────────────┘

     Se ⚠ (discrepant ou insufficient_data):

     ⚠  Atenção — sinais não confirmam totalmente esta declaração.
        Você pode publicar mesmo assim (será visível pra todos),
        ou remover a declaração.

  5. confirm: "Manter declaração?" [keep | remove]
     Se remove → DELETE /claims/{id}, retorna ao menu

**UI por claim_type:**

primary_stack:
  prompt: "Quais linguagens são seu stack principal? (separar por vírgula)"
  parser: split e trim, validar não-vazio, max 10

years_experience:
  prompt: "Quantos anos de experiência como desenvolvedor?"
  parser: number entre 0 e 80

specialization:
  prompt: select de "Backend / Frontend / Fullstack / DevOps / Data / Mobile"

test_discipline:
  prompt: select de "TDD-first / Test-after / Test-light"

work_pattern:
  prompt: select de "Early bird (6h-12h) / Balanced (9h-18h) / Night owl (18h-2h)"

Self-declared (employment_history, education, certifications, role_at_company):
  prompt mais elaborado por subcampos, ou texto livre
  Aviso pré-input: "ℹ DevProfile não verifica esse tipo de declaração.
                    Aparecerá no perfil em bloco separado, marcado como
                    'self-declared, não verificado'."

**2. devprofile claims list — tabela**

GET /claims → renderizar tabela ASCII:

  ID  TIPO              VALOR                       STATUS              VERIFICADO EM
  ──  ────              ─────                       ──────              ─────────────
  1   stack principal   Python, TypeScript          ✓ Confirmado        2026-05-20
  2   especialização    Senior React Engineer       ⚠ Sinal limitado    2026-05-20
  3   empregadores      Stripe (2020-2022), ...     ℹ Self-declared     2026-05-20

Opção --verbose: exibe a observation completa de cada claim.

**3. devprofile claims remove <id>**

  1. GET /claims → buscar o id
  2. Se não encontrado, "Claim {id} não encontrada." e exit 1
  3. Exibir detalhes da claim
  4. Confirm: "Remover esta declaração? [y/N]"
  5. Se y → DELETE /claims/{id}, "Declaração removida."
  6. Se n → "Cancelado."

### Princípio de UX

O wizard NUNCA usa linguagem de auto-promoção. Frases como "Mostre seu valor!"
ou "Destaque suas conquistas!" são proibidas. O tom é o de R2D2: observação,
não celebração.

Exemplo bom:  "Quais linguagens são seu stack principal?"
Exemplo ruim: "Mostre ao mundo seu domínio técnico!"

Exemplo bom:  "Declaração salva. Verificação anexada ao próximo snapshot."
Exemplo ruim: "🎉 Parabéns! Sua declaração foi adicionada ao perfil!"

### O que NÃO implementar

- Edição inline de claim existente — usuário remove + adiciona de novo
- Importação de LinkedIn ou texto livre — fase futura (F7.X)
- Múltiplas claims do mesmo tipo — uma claim por tipo (na fase atual)
  (Se já existe claim ativa do mesmo tipo, devprofile claims add pergunta
   se quer substituir.)

### Testes em packages/cli/tests/claims/

- test_claims_add_happy_path_confirmed
- test_claims_add_warns_on_discrepant_allows_publish
- test_claims_add_remove_after_preview_calls_delete
- test_claims_add_replaces_existing_claim_of_same_type
- test_claims_list_renders_table_with_correct_icons
- test_claims_remove_confirms_before_delete
- test_claims_remove_not_found_exits_with_code_1

Mockar HTTP client do engine.

### Critério de conclusão

bun test packages/cli/tests/claims → todos passando
devprofile claims add executa todos os 9 tipos sem erro
Tabela do devprofile claims list renderiza corretamente em terminais 80 cols
Nenhuma frase do wizard soa como LinkedIn (revisar manualmente)
```

---

## F7.5 — Bundle v2: integração da seção claims

```
Atualize o payload do snapshot e a geração do .dpbundle para incluir as
seções claims e self_declared (packages/engine/src/main.py e
packages/cli/src/commands/snapshot.ts).

### Contexto

O bundle ganha duas novas seções top-level no payload:
- claims: array de claims verificáveis com status de verificação
- self_declared: array de claims auto-declaradas (bloco separado, marcado)

Bump da versão do bundle: "1" → "2".

### O que implementar

**1. Endpoint POST /snapshot/payload (atualização)**

Atualize o payload retornado para incluir as duas novas seções:

  {
    "version": "2",
    "created_at": "...",
    "devprofile_version": "...",
    "previous_hash": "...",
    "scores": { ... },
    "l1": { ... },
    "l2": { ... },

    "claims": [
      {
        "claim_type": "primary_stack",
        "claim_value": { "languages": [...] },
        "declared_at": "2026-05-20T...",
        "verification": {
          "status": "confirmed",
          "observation": "...",
          "evidence_anchors": { ... },
          "verified_at": "2026-05-20T..."
        }
      },
      ...
    ],

    "self_declared": [
      {
        "claim_type": "employment_history",
        "claim_value": { ... },
        "declared_at": "...",
        "note": "DevProfile does not verify this claim type."
      },
      ...
    ]
  }

Regras:
  - Claims verificáveis (primary_stack, years_experience, specialization,
    test_discipline, work_pattern) entram em payload.claims
  - Claims self-declared (employment_history, education, certifications,
    role_at_company) entram em payload.self_declared
  - Se não houver claims ativas de uma categoria, a seção é array vazio (não omite)
  - Antes de montar o payload, executar verify-all internamente para
    garantir status fresh

**2. Comando devprofile snapshot (atualização em snapshot.ts)**

Antes de gerar o bundle:
  1. Chamar POST /claims/verify-all
  2. Exibir delta consolidado:

     Declarações verificadas:
       ✓ 3 confirmadas
       ⚠ 1 com sinal limitado
       ℹ 1 self-declared (não verificada)

     Detalhe das ⚠:
       - Especialização "Senior React Engineer": sinal limitado.
         React aparece em 2 de 87 sessões (90 dias).

  3. Se houver ⚠, prompt: "Continuar com bundle? Declarações com ⚠
     ficarão visíveis publicamente. [y/N]"
     - Default: N
     - Se N, abortar geração ("Bundle não gerado. Edite ou remova as
       declarações com ⚠ via devprofile claims remove <id>.")
  4. Se sem ⚠ ou user confirmou, prosseguir com POST /snapshot/payload,
     assinar, salvar bundle

Output após bundle gerado:

  Bundle gerado: ~/.devprofile/snapshots/2026-05-20T14-00-00.dpbundle

  Perfil capturado:
    Base histórica:       12 repositórios · 4.832 commits
    Trajetória observada: 847 sessões · 90 dias
    Declarações:          3 ✓  ·  1 ⚠  ·  1 ℹ

### O que NÃO implementar

- Edição de claims dentro do fluxo de snapshot — só consulta + confirmação
- Modificar version "1" pra preservar — bundles v1 antigos continuam
  válidos pelo verifier (Fase 5), mas novos sempre saem v2

### Testes em packages/engine/tests/claims/test_bundle_payload.py

- test_payload_v2_includes_claims_section
- test_payload_v2_includes_self_declared_section
- test_payload_claims_only_contains_verifiable_types
- test_payload_self_declared_only_contains_self_declared_types
- test_payload_runs_verify_all_before_building
- test_payload_claims_empty_array_when_no_claims
- test_payload_version_field_is_string_2

Em packages/cli/tests/commands/test_snapshot_claims.ts:

- test_snapshot_aborts_when_warning_status_and_user_declines
- test_snapshot_continues_when_warning_status_and_user_confirms
- test_snapshot_no_prompt_when_all_confirmed
- test_snapshot_output_shows_delta_summary

### Critério de conclusão

pytest packages/engine/tests/claims/test_bundle_payload.py → todos passando
bun test packages/cli/tests/commands/test_snapshot_claims.ts → todos passando
Bundle gerado contém ambas as seções (claims + self_declared)
Bundle v1 antigo continua sendo verificado corretamente pelo devprofile verify
```

---

## F7.6 — Verifier: exibição do delta no devprofile verify

```
Atualize o comando devprofile verify para exibir as seções claims e
self_declared do bundle v2 (packages/cli/src/commands/verify.ts).

### Contexto

devprofile verify <arquivo.dpbundle> hoje valida assinatura, chain hash e
exibe scores. Com bundle v2, precisa exibir também as duas novas seções de
forma clara e separada.

### O que implementar

**1. Detecção de versão**

Ao ler o bundle, identificar payload.version. Se "1", manter comportamento
atual. Se "2", aplicar layout adicional descrito abaixo.

**2. Layout do output para bundle v2**

Após a seção de scores, adicionar:

  ┌─ Declarações e verificação ──────────────────────────────────────┐
  │                                                                  │
  │  ✓ Stack principal: Python, TypeScript                          │
  │    Confirmado. 87% das sessões em Python/TS nos últimos 90 dias. │
  │    8 repositórios em L1 com essas linguagens.                    │
  │                                                                  │
  │  ✓ Anos de experiência: 8                                        │
  │    Confirmado. L1 mostra atividade contínua desde 2017.          │
  │                                                                  │
  │  ⚠ Especialização: Senior React Engineer                        │
  │    Sinal limitado. React aparece em 2 de 87 sessões em 90 dias. │
  │    Nenhum repositório React em L1.                               │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘

  ┌─ Auto-declarado (não verificado por DevProfile) ────────────────┐
  │                                                                  │
  │  ℹ Empregadores                                                  │
  │    Stripe (2020-2022)                                            │
  │    Stack Overflow (2018-2020)                                    │
  │                                                                  │
  │  ℹ Formação                                                      │
  │    Mestrado em Computação - USP                                  │
  │                                                                  │
  │  Nota: DevProfile não verifica este tipo de declaração.          │
  │        Estas informações são apresentadas como o dev as          │
  │        declarou, sem validação externa.                          │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘

**3. Princípios visuais**

- Blocos visualmente distintos — o de self_declared TEM que parecer
  diferente do de verificadas. Fonte do bloco, cor (se terminal suporta),
  ou padrão de borda diferenciado.
- Nota explícita ao final do bloco self_declared. Não confiar no usuário
  inferir — declarar.
- Ícones: ✓ (confirmed), ⚠ (discrepant ou insufficient_data), ℹ (self_declared)
- Se claims ou self_declared vazios, omitir o bloco completamente
  (não exibir "nenhuma declaração").

**4. Verificações estruturais adicionais para v2**

Após validar assinatura, chain hash, etc, adicionar:

  ✓ Assinatura Ed25519 válida
  ✓ Hash do payload íntegro
  ✓ Cadeia de snapshots contínua
  ✓ Seção L1 presente (12 repositórios)
  ✓ Seção L2 presente (847 sessões)
  ✓ Seção Claims presente (3 verificáveis · 2 self-declared)

Se a seção claims tiver status inválido, registrar warning sem invalidar:
  ⚠ Claim com status desconhecido encontrada — ignorada

### O que NÃO implementar

- Re-verificação online no verifier — verify exibe o que está no bundle
  (que foi verificado no momento da geração). Re-verificar quebraria a
  premissa de bundle congelado.
- Comparação visual entre bundles diferentes — fase futura

### Testes em packages/cli/tests/commands/test_verify_claims.ts

- test_verify_v2_renders_claims_section
- test_verify_v2_renders_self_declared_section
- test_verify_v2_omits_claims_when_empty_array
- test_verify_v2_omits_self_declared_when_empty_array
- test_verify_v1_unchanged_behavior (bundle antigo continua funcionando)
- test_verify_handles_unknown_claim_status_with_warning

### Critério de conclusão

bun test packages/cli/tests/commands/test_verify_claims.ts → todos passando
devprofile verify de bundle v2 real renderiza as duas seções corretamente
devprofile verify de bundle v1 antigo continua funcionando sem mudanças
```

---

## F7.7 — Testes end-to-end

```
Implemente uma suíte e2e que cobre o ciclo completo de claims, do declare
ao verify, em packages/e2e/tests/claims.test.ts.

### Contexto

Testes anteriores cobrem unidades isoladas. Esta suíte garante que o fluxo
completo funciona end-to-end: dev declara, perfil verifica, snapshot embute,
verify renderiza.

Assume engine + mcp-server rodando em portas locais (subir antes do teste
via beforeAll que dispara o daemon).

### Cenários obrigatórios

**E2E-1: ciclo feliz — 5 claims confirmadas**

  1. Setup: SQLite limpo + L1/L2 com dados que conferem com claims
  2. devprofile claims add primary_stack {languages: [python, typescript]}
  3. devprofile claims add years_experience {years: 8}
  4. devprofile claims add specialization {area: backend}
  5. devprofile claims add test_discipline {discipline: tdd_first}
  6. devprofile claims add work_pattern {pattern: night_owl}
  7. devprofile snapshot
  8. devprofile verify <bundle>
  9. Assert: todas as 5 claims aparecem com ✓
  10. Assert: bloco self_declared está ausente (não há claims do tipo)

**E2E-2: claim discrepante — dev publica com ⚠**

  1. Setup: L1/L2 com Python dominante
  2. devprofile claims add specialization {area: frontend}  (discrepant)
  3. devprofile snapshot (confirma publicar mesmo com ⚠)
  4. devprofile verify <bundle>
  5. Assert: claim aparece com ⚠ e observation correta

**E2E-3: misto verifiable + self_declared**

  1. devprofile claims add primary_stack ...
  2. devprofile claims add employment_history {employers: [...]}
  3. devprofile snapshot
  4. devprofile verify <bundle>
  5. Assert: bloco "Declarações e verificação" tem 1 entrada
  6. Assert: bloco "Auto-declarado" tem 1 entrada
  7. Assert: nota "DevProfile não verifica..." aparece no bloco
     self-declared

**E2E-4: envelhecimento de claim entre snapshots**

  1. Setup inicial: L2 com TDD-first dominante
  2. devprofile claims add test_discipline {discipline: tdd_first}
  3. devprofile snapshot → bundle_1 (claim confirmed)
  4. Simular passagem de tempo + injetar L2 onde tdd cai pra 5%
  5. devprofile snapshot → bundle_2 (claim discrepant)
  6. devprofile verify bundle_1 → claim ainda confirmed (congelado)
  7. devprofile verify bundle_2 → claim discrepant (recalculado)

**E2E-5: remover claim e regenerar**

  1. devprofile claims add primary_stack ...
  2. devprofile snapshot → bundle_1 contém a claim
  3. devprofile claims remove <id>
  4. devprofile snapshot → bundle_2 NÃO contém a claim
  5. devprofile verify bundle_1 → claim aparece
  6. devprofile verify bundle_2 → seção claims vazia

**E2E-6: abort por ⚠ quando user nega confirmação**

  1. Setup com claim discrepant
  2. devprofile snapshot → prompt aparece, simular "N"
  3. Assert: bundle NÃO foi gerado
  4. Assert: mensagem "Bundle não gerado..." aparece

### Critério de conclusão

bun test packages/e2e/tests/claims.test.ts → todos os 6 cenários passando
Smoke test manual em ambiente limpo: instalar, fazer 3 claims, gerar
bundle, verificar — comportamento idêntico aos testes.
```

---

## Checklist final da Fase 7

Antes de marcar v0.4.0 como release-ready:

```
[ ] F7.1 — Tabela claims criada com schema correto, CRUD testado
[ ] F7.2 — 5 verifiers + SelfDeclaredVerifier implementados, registry funciona
[ ] F7.3 — 4 endpoints (POST/GET/DELETE/verify-all) com testes verdes
[ ] F7.4 — devprofile claims add/list/remove funcional, copy passou no filtro R2D2
[ ] F7.5 — Bundle v2 com seções claims + self_declared, snapshot aborta com ⚠ + nega
[ ] F7.6 — devprofile verify renderiza ambas seções, bundle v1 continua funcionando
[ ] F7.7 — 6 cenários e2e passando
[ ] pytest packages/engine/tests/claims/ → zero falhas
[ ] bun test packages/cli/tests/commands/ (claims + snapshot + verify) → zero falhas
[ ] Smoke test manual end-to-end em ambiente limpo
[ ] Nenhuma copy do wizard ou do verifier soa como LinkedIn
[ ] Versão bumped: package.json para 0.4.0, devprofile-engine version constant
```

Pronto pra tag v0.4.0 quando todos os 11 itens marcados.

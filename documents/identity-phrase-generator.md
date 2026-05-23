# Beheld — Gerador de Frase de Identidade Técnica

> **Spec de implementação** · v1.0 · 2026-05-15
> Documento de referência única para o componente responsável por destilar
> sinais comportamentais em frase de identidade pública.

---

## Visão geral

A frase de identidade é o **Bloco 1** do retrato técnico — a primeira coisa
que o dev e quem acessa o link público leem. Aparece em três meios:

| Meio | Versão usada | Tamanho típico |
|------|--------------|----------------|
| Página HTML pública | `identity_long` | 22–35 palavras |
| Imagem Open Graph | `identity_long` | mesma |
| Badge SVG embeddable | `identity_short` | 3–7 palavras |

A geração acontece no backend após `POST /bundles`, antes de renderizar
HTML/OG/badge. O resultado é persistido em SQLite e cacheado por bundle.

Duas implementações coexistem com mesma interface de saída:

- **LLM path** — chamada ao Claude Haiku com prompt estruturado
- **Fallback path** — templates rule-based determinísticos

A seleção entre os dois é por **qualidade esperada da saída**, não por
disponibilidade do LLM.

---

## 1. Schema do payload de entrada (`signals_json`)

O classificador do engine produz este payload a partir do SQLite local.
Nenhum campo aceita texto livre, nomes próprios ou paths.

### Schema formal

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://beheld.dev/schemas/identity-signals.v1.json",
  "title": "Identity Signals Payload",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "data_sources",
    "ecosystems",
    "test_pattern",
    "workflow",
    "timing",
    "evolution",
    "tooling",
    "sample_size"
  ],

  "properties": {
    "schema_version": { "const": "1" },

    "data_sources": {
      "type": "object",
      "additionalProperties": false,
      "required": ["l1", "l2"],
      "properties": {
        "l1": { "type": "boolean" },
        "l2": { "type": "boolean" }
      }
    },

    "ecosystems": {
      "type": "object",
      "additionalProperties": false,
      "required": ["dominant", "secondary", "emerging", "declining"],
      "properties": {
        "dominant":  { "type": "array", "maxItems": 2, "items": { "$ref": "#/$defs/ecosystem" } },
        "secondary": { "type": "array", "maxItems": 3, "items": { "$ref": "#/$defs/ecosystem" } },
        "emerging":  { "type": "array", "maxItems": 2, "items": { "$ref": "#/$defs/ecosystem" } },
        "declining": { "type": "array", "maxItems": 2, "items": { "$ref": "#/$defs/ecosystem" } }
      }
    },

    "test_pattern": {
      "type": "object",
      "additionalProperties": false,
      "required": ["discipline", "approach"],
      "properties": {
        "discipline": { "enum": ["strong", "moderate", "low", "minimal"] },
        "approach":   { "enum": ["tdd_dominant", "tdd_partial", "test_after", "test_seldom", "exploratory"] }
      }
    },

    "workflow": {
      "type": "object",
      "additionalProperties": false,
      "required": ["primary"],
      "properties": {
        "primary":  { "enum": ["tdd", "test_after", "debug_driven", "refactor_heavy", "exploratory", "review_before_commit"] },
        "emerging": { "enum": ["tdd", "test_after", "debug_driven", "refactor_heavy", "exploratory", "review_before_commit"] }
      }
    },

    "timing": {
      "type": "object",
      "additionalProperties": false,
      "required": ["peak_period", "consistency"],
      "properties": {
        "peak_period":    { "enum": ["morning", "afternoon", "evening", "late_night", "distributed"] },
        "consistency":    { "enum": ["very_consistent", "consistent", "irregular", "sporadic"] },
        "session_length": { "enum": ["short", "medium", "long", "marathon"] }
      }
    },

    "evolution": {
      "type": "object",
      "additionalProperties": false,
      "required": ["has_evolution", "timeframe"],
      "properties": {
        "has_evolution": { "type": "boolean" },
        "timeframe":     { "enum": ["months", "year", "couple_years", "many_years", "insufficient_history"] },
        "trajectory":    { "enum": ["stack_migration", "test_maturity_growth", "workflow_shift", "scope_broadening", "scope_deepening", "none"] }
      }
    },

    "tooling": {
      "type": "object",
      "additionalProperties": false,
      "required": ["platforms"],
      "properties": {
        "platforms": { "type": "array", "maxItems": 5, "items": { "$ref": "#/$defs/platform" } }
      }
    },

    "ai_usage": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "primary_mode": { "enum": ["code_generation", "code_understanding", "debugging", "refactoring", "exploration"] },
        "intensity":    { "enum": ["heavy", "moderate", "light"] }
      }
    },

    "sample_size": {
      "type": "object",
      "additionalProperties": false,
      "required": ["confidence_band"],
      "properties": {
        "confidence_band": { "enum": ["high", "medium", "low", "minimal"] }
      }
    }
  },

  "$defs": {
    "ecosystem": {
      "enum": [
        "rails", "node", "react", "vue", "next",
        "python", "django", "fastapi",
        "flutter", "go", "rust",
        "java_spring", "kotlin", "swift_ios",
        "dotnet", "elixir_phoenix", "php_laravel",
        "ruby_other", "devops"
      ]
    },
    "platform": {
      "enum": [
        "docker", "kubernetes",
        "github", "github_actions", "gitlab", "gitlab_ci", "circleci",
        "aws", "gcp", "azure", "vercel", "cloudflare",
        "postgres", "mysql", "redis", "mongodb", "elasticsearch",
        "terraform", "ansible", "blockchain"
      ]
    }
  }
}
```

### Faixas qualitativas — referência das classificações

**`test_pattern.discipline`** (derivado de `test_ratio` agregado):
- `strong`: > 0.5
- `moderate`: 0.3–0.5
- `low`: 0.1–0.3
- `minimal`: < 0.1

**`timing.peak_period`** (derivado de `peak_hours`):
- `morning`: 6h–12h
- `afternoon`: 12h–18h
- `evening`: 18h–22h
- `late_night`: 22h–6h
- `distributed`: sem concentração clara

**`timing.session_length`** (média):
- `short`: < 30min
- `medium`: 30–60min
- `long`: 60–120min
- `marathon`: > 120min

**`sample_size.confidence_band`** (combina L1 + L2):
- `high`: > 500 sessões + > 5 repos
- `medium`: 100–500 sessões OU 3–5 repos
- `low`: 30–100 sessões OU 1–2 repos
- `minimal`: < 30 sessões e sem repos

### Princípios do payload

1. **Apenas sinais derivados.** Nunca dados brutos. O LLM recebe
   "ecosystem dominante: rails", nunca "847 commits em /Users/ed/projects/x".
2. **Categorias, não nomes próprios.** Enums fechados em todos os campos
   string. Qualquer valor fora do enum é descartado pelo classificador.
3. **Faixas e tendências, não valores absolutos.** Número absoluto identifica.
   "847 commits em Python" cruzado com GitHub permite re-identificação.
   O número exato fica no SQLite local.

### Validação na fronteira

Antes de enviar ao LLM ou usar no fallback, validação contra schema:

```python
import jsonschema

SCHEMA = json.load(open("identity-signals.v1.json"))

def validate_payload(payload: dict) -> None:
    jsonschema.validate(payload, SCHEMA)
```

Se validação falhar, é bug no classificador — log de erro interno,
**não enviar para LLM**, usar template mínimo absoluto (seção 6).

---

## 2. Caminho LLM — prompt e regras

### Prompt do sistema

```
Você é responsável por gerar a frase de identidade técnica de um
desenvolvedor, destilada a partir de sinais comportamentais reais
de uso. Essa frase aparece em três lugares: na página HTML pública
do retrato, na imagem Open Graph compartilhada em redes, e como
versão compactada em um badge embeddable em README.

Você recebe sinais estruturados (números, categorias, distribuições).
Você produz duas frases em português brasileiro, na mesma chamada,
com tom editorial considerado — como se um amigo desenvolvedor
estivesse apresentando este dev para outro dev em uma conferência.

TOM E REGISTRO
==============

Imagine que você foi convidado para descrever o trabalho de alguém
em uma conversa real entre pares técnicos. Você não está vendendo
essa pessoa. Não está elogiando. Está apenas descrevendo, com
precisão, o que os dados mostram sobre como ela trabalha.

Use:
- Segunda pessoa (você) na versão longa
- Indicativo direto, sem hedging ("você é..." não "você parece ser...")
- Verbos no presente para padrões atuais, pretérito perfeito composto
  ou imperfeito para evolução ("migrou", "tem feito")
- Linguagem natural de conversa entre devs, não jargão corporativo

NÃO use, em nenhuma hipótese:
- Adjetivos avaliativos: "talentoso", "experiente", "versátil",
  "sólido", "habilidoso", "expert", "senior", "ninja", "rockstar",
  "skilled", "proficient"
- Linguagem de LinkedIn: "passionate about", "driven by",
  "with experience in", "specializing in"
- Comparações hierárquicas: "acima da média", "destaque", "elite"
- Superlativos: "excepcional", "extraordinário", "incomparável"
- Início com "Você é um desenvolvedor..." — comece direto pela
  característica mais distintiva nos dados
- Listas de tecnologias soltas sem contexto narrativo
- Buzzwords genéricas: "full-stack", "polyglot", "tech enthusiast"

REGRAS DE CONTEÚDO
==================

Versão longa (HTML público + OG image):
- Entre 22 e 35 palavras
- Usa pelo menos 2 fatos específicos dos sinais fornecidos
- Inclui pelo menos um elemento temporal ("últimos dois anos",
  "nos últimos meses") quando há sinal de evolução
- Pode mencionar ferramentas ou ecosystems específicos por nome
- NÃO inclui números absolutos (commits, sessões, percentuais)
- Estrutura narrativa: identidade técnica → evolução ou padrão
  diferencial → traço de trabalho

Versão curta (badge embeddable):
- Entre 3 e 7 palavras
- Forma: substantivo + qualificador opcional + transformação opcional
- Exemplos de estrutura: "Dev backend · Rails → Python"
- Usa ponto-mediano ( · ) como separador entre identidade e
  qualificador, seta (→) para indicar transformação temporal
- Sem verbos conjugados
- Sem pontuação final

FORMATO DE SAÍDA
================

Retorne EXCLUSIVAMENTE um objeto JSON válido, sem markdown,
sem prefixo, sem explicação. Estrutura:

{
  "identity_long": "string com 22-35 palavras",
  "identity_short": "string com 3-7 palavras",
  "confidence": "high" | "medium" | "low"
}

confidence reflete quão distintivos são os sinais:
- "high": múltiplos sinais convergem para identidade clara
- "medium": identidade legível, mas com sinais mais difusos
- "low": sinais escassos ou contraditórios — frases devem ser
  mais genéricas mas ainda específicas o suficiente para
  passar nas validações
```

### Exemplos de saída boa (few-shot no prompt)

**Exemplo A** — Sinais: ecosystem dominante Ruby, Python emergente,
test ratio alto, peak afternoon, plataformas Docker + GitHub Actions + Postgres.

```json
{
  "identity_long": "Dev backend de raiz Rails que migrou para Python nos últimos dois anos, com forte disciplina de testes e ritmo de trabalho concentrado entre 14h e 19h.",
  "identity_short": "Dev backend · Rails → Python",
  "confidence": "high"
}
```

**Exemplo B** — Sinais: ecosystems mistos Node e Python, test ratio médio,
workflow exploratório, sem evolução clara.

```json
{
  "identity_long": "Generalista pragmático, igualmente à vontade em Node e Python, com inclinação a explorar antes de estabelecer padrão e ritmo de trabalho consistente ao longo do dia.",
  "identity_short": "Generalista · Node e Python",
  "confidence": "medium"
}
```

**Exemplo C** — Sinais: Rust em forte ascensão, Go declinando,
TDD dominante, peak distributed.

```json
{
  "identity_long": "Dev de sistemas que vem transitando de Go para Rust nos últimos meses, com TDD bem estabelecido como prática e curiosidade ativa por novas ferramentas de baixo nível.",
  "identity_short": "Sistemas · Go → Rust",
  "confidence": "high"
}
```

### Exemplos de saída ruim (anti-padrões no prompt)

```
❌ "identity_long": "Você é um desenvolvedor talentoso e versátil
   com sólida experiência em múltiplas tecnologias modernas."
   Razão: adjetivos avaliativos, genérico, podia ser qualquer um.

❌ "identity_long": "Full-stack engineer passionate about Ruby
   on Rails and Python, driven by clean code and testing."
   Razão: tom LinkedIn, em inglês, buzzwords.

❌ "identity_short": "Eduardo é um desenvolvedor backend"
   Razão: verbo conjugado, palavras desnecessárias, longa demais.

❌ "identity_short": "Rails Python Docker GitHub"
   Razão: lista solta sem estrutura narrativa.
```

### User message template

```
Gere as duas frases de identidade para o dev a partir dos sinais
abaixo. Siga rigorosamente as regras de tom e formato.

Sinais:
{signals_json}
```

### Parâmetros da chamada

- **Modelo**: `claude-haiku-4-5` (custo baixo, latência baixa, qualidade
  suficiente para a tarefa estruturada)
- **Temperature**: 0.7 (alguma variabilidade narrativa, mas não erratic)
- **Max tokens**: 400 (suficiente para JSON com as duas frases + margem)
- **Timeout**: 10 segundos (acima disso, fallback)
- **Retries**: até 3 tentativas em caso de validação falhar

---

## 3. Caminho fallback — templates rule-based

### Princípio de inversão

O fallback **não é rede de segurança**. É caminho legítimo para casos
onde produz saída honestamente melhor que o LLM produziria.

Em sinais minimais, o LLM tende a inventar contexto para atingir o
mínimo de palavras. Frase template determinística e honesta supera
frase LLM forçada e especulativa.

### Função de seleção

Executada antes da chamada ao LLM:

```python
def select_generation_path(payload: dict) -> Literal["llm", "fallback"]:
    """
    Escolhe o caminho de geração baseado em qualidade esperada de saída.
    """
    sample = payload["sample_size"]["confidence_band"]
    has_evolution = payload["evolution"]["has_evolution"]
    eco_dominant = len(payload["ecosystems"]["dominant"])
    eco_emerging = len(payload["ecosystems"]["emerging"])

    # Sinais insuficientes para narrativa
    if sample == "minimal":
        return "fallback"

    if sample == "low" and not has_evolution and eco_emerging == 0:
        return "fallback"

    if eco_dominant == 0:
        return "fallback"

    return "llm"
```

O fallback também é acionado quando o LLM falha validação após 3
tentativas (caminho secundário). Em ambos os casos: `generation_path = "fallback"`.

### Templates do `identity_long`

**Caso A** — Sinais mínimos absolutos (`confidence_band: minimal`):

```python
template_a = (
    f"Dev {eco_label} em fase inicial de captura do perfil, "
    f"com primeiros sinais em {primary_platform_label}."
)
```

Exemplo:
- Input: `dominant=["node"]`, `platforms=["github"]`
- Output: `"Dev Node em fase inicial de captura do perfil, com primeiros sinais em GitHub."`

Razão: comunica "dados ainda escassos" sem usar termos pejorativos sobre
o dev. "Mínimo" e "esporádico" são tecnicamente corretos mas socialmente
cortantes — preservar a dignidade do dev sem mentir é parte do contrato.

**Caso B** — Sinais escassos mas existem (`confidence_band: low`,
sem `evolution`, sem `emerging`):

```python
template_b = (
    f"Dev {eco_label} com {test_label} de testes "
    f"e ritmo {timing_label}, "
    f"trabalhando com {top_platforms_label}."
)
```

Exemplo:
- Input: `dominant=["flutter"]`, `discipline="moderate"`,
  `peak_period="evening"`, `platforms=["github","github_actions"]`
- Output: `"Dev Flutter com disciplina moderada de testes e ritmo concentrado nas noites, trabalhando com GitHub e GitHub Actions."`

### Templates do `identity_short` — hierarquia

Avaliada top-down, primeira condição que casa é usada:

**Caso 1** — Há `emerging` ou `declining` (transformação clara):

```python
short = f"{domain_label} · {dominant_short} → {emerging_short}"
# Exemplo: "Backend · Rails → Python"
```

**Caso 2** — Há `secondary` relevante:

```python
short = f"{domain_label} · {dominant_short} e {secondary_short}"
# Exemplo: "Generalista · Node e Python"
```

**Caso 3** — Apenas `dominant`, com mapping de domínio:

```python
short = f"{domain_label} · {dominant_short}"
# Exemplo: "Mobile · Flutter"
```

**Caso 4** — Apenas `dominant`, sem mapping disponível (último recurso):

```python
short = f"{dominant_label}"
# Exemplo: "Ruby"
```

Único caso onde a short tem 1 palavra. O badge SVG trata short curta
com layout ajustado: centralização vertical, mais respiro, sem tentar
preencher horizontal.

### Mapping de domínio (`DOMAIN_LABELS`)

```python
DOMAIN_LABELS = {
    # Mobile
    "flutter":       "Mobile",
    "swift_ios":     "Mobile",
    "kotlin":        "Mobile",
    # Backend
    "rails":         "Backend",
    "django":        "Backend",
    "fastapi":       "Backend",
    "node":          "Backend",        # quando sozinho
    "java_spring":   "Backend",
    "dotnet":        "Backend",
    "elixir_phoenix": "Backend",
    "php_laravel":   "Backend",
    # Sistemas
    "rust":          "Sistemas",
    "go":            "Sistemas",
    # Frontend
    "react":         "Frontend",
    "vue":           "Frontend",
    "next":          "Frontend",
    # Infra
    "devops":        "DevOps",
}
```

Ecosystems sem mapping (`python` sozinho, `ruby_other`) caem no Caso 4
(nome bruto). Adicionar ao mapping quando padrões claros emergirem em
produção.

### Labels human-readable de ecosystems e plataformas

```python
ECOSYSTEM_LABELS = {
    "rails": "Rails",
    "node": "Node",
    "react": "React",
    "python": "Python",
    "rust": "Rust",
    "go": "Go",
    "flutter": "Flutter",
    "dotnet": ".NET",
    "elixir_phoenix": "Elixir",
    "php_laravel": "Laravel",
    # ... (ver schema para lista completa)
}

PLATFORM_LABELS = {
    "github": "GitHub",
    "github_actions": "GitHub Actions",
    "docker": "Docker",
    "postgres": "Postgres",
    "kubernetes": "Kubernetes",
    # ...
}

TEST_DISCIPLINE_LABELS = {
    "strong": "forte disciplina",
    "moderate": "disciplina moderada",
    "low": "hábito ainda em formação",
    "minimal": "primeiros sinais",
}

TIMING_LABELS = {
    "morning": "concentrado nas manhãs",
    "afternoon": "concentrado nas tardes",
    "evening": "concentrado nas noites",
    "late_night": "concentrado de madrugada",
    "distributed": "distribuído ao longo do dia",
}
```

---

## 4. Validação programática

### Estrutura dual de regras

Validações de **segurança** aplicam aos dois caminhos sem exceção:

- JSON válido e parseável
- Ausência de adjetivos da blacklist em `identity_long`:
  ```
  ["talentoso", "experiente", "versátil", "sólido", "habilidoso",
   "expert", "senior", "ninja", "rockstar", "passionate", "driven",
   "skilled", "proficient", "excepcional", "extraordinário",
   "incomparável", "destaque", "elite", "full-stack"]
  ```
- `identity_long` NÃO começa com "Você é um desenvolvedor"
- `identity_short` não contém pontuação final (`.`, `!`, `?`)
- `confidence` ∈ `{"high", "medium", "low"}`

Validações de **qualidade** têm faixas diferentes por caminho:

| Path | `identity_long` | `identity_short` |
|------|-----------------|------------------|
| LLM | 22–35 palavras | 3–7 palavras |
| Fallback | 12–25 palavras | 1–5 palavras |

### Razão da faixa relaxada no fallback

O fallback gera template determinístico a partir de sinais limitados.
Forçar a chegar em 22 palavras produziria prosa inflada com filler —
pior que uma frase curta honesta.

**Frase curta honesta supera frase longa forçada.**

### Implementação da validação

```python
WORD_COUNT_RANGES = {
    "llm":      {"long": (22, 35), "short": (3, 7)},
    "fallback": {"long": (12, 25), "short": (1, 5)},
}

BLACKLIST = {
    "talentoso", "experiente", "versátil", "sólido", "habilidoso",
    "expert", "senior", "ninja", "rockstar", "passionate", "driven",
    "skilled", "proficient", "excepcional", "extraordinário",
    "incomparável", "destaque", "elite", "full-stack",
}

def validate_output(
    output: dict,
    path: Literal["llm", "fallback"],
) -> tuple[bool, str | None]:
    """
    Retorna (is_valid, error_reason).
    """
    # Validações de segurança (ambos os paths)
    long_words = output["identity_long"].lower().split()
    if any(w.strip(".,;:") in BLACKLIST for w in long_words):
        return False, "blacklist_violation"

    if output["identity_long"].startswith("Você é um desenvolvedor"):
        return False, "forbidden_opening"

    if output["identity_short"].rstrip().endswith((".", "!", "?")):
        return False, "trailing_punctuation"

    if output["confidence"] not in {"high", "medium", "low"}:
        return False, "invalid_confidence"

    # Validações de qualidade (faixa por path)
    ranges = WORD_COUNT_RANGES[path]
    long_count = len(output["identity_long"].split())
    short_count = len(output["identity_short"].split())

    if not (ranges["long"][0] <= long_count <= ranges["long"][1]):
        return False, f"long_word_count_out_of_range_{path}"

    if not (ranges["short"][0] <= short_count <= ranges["short"][1]):
        return False, f"short_word_count_out_of_range_{path}"

    return True, None
```

---

## 5. Confidence no fallback

Sempre `"low"` no caminho fallback, independente da causa (sinais
minimais OU LLM falhou validação).

O sistema **nunca afirma alta confiança em saída de fallback**.

Se a UI quiser diferenciar entre "low por sinais escassos" e "low por
LLM falho", o campo no banco é `generation_path` — não inflar a `confidence`.

---

## 6. Última camada — template mínimo absoluto

Para falhas catastróficas (bug no classificador, payload corrompido,
fallback também falhou validação de segurança):

```python
MINIMAL_TEMPLATE = {
    "identity_long": "Retrato em construção — primeiros sinais sendo capturados.",
    "identity_short": "Retrato em construção",
    "confidence": "low",
    "generation_path": "minimal_template",
}
```

Garante que a página pública nunca fica vazia ou quebrada. Usado em
< 0.1% dos casos esperados. Quando usado, dispara alerta interno
automático para investigação.

---

## 7. Persistência

### Schema da tabela

```sql
CREATE TABLE identity_phrases (
    bundle_id        INTEGER PRIMARY KEY,
    long             TEXT NOT NULL,
    short            TEXT NOT NULL,
    confidence       TEXT NOT NULL,    -- "high" | "medium" | "low"
    generation_path  TEXT NOT NULL,    -- "llm" | "fallback" | "minimal_template"
    model_used       TEXT,             -- "claude-haiku-4-5" ou NULL
    generated_at     TEXT NOT NULL,
    FOREIGN KEY (bundle_id) REFERENCES bundles(id)
);

CREATE INDEX idx_identity_path ON identity_phrases(generation_path);
```

### Uso do campo `generation_path`

- **UI nunca expõe.** Transparente ao usuário.
- **Observabilidade interna.** Que fração dos retratos é fallback? Se
  alta, classificador precisa ajuste.
- **Re-geração futura.** Quando o dev acumular mais sessões, retratos
  antigos com `generation_path="fallback"` viram candidatos a regenerar
  com LLM em background.
- **Telemetria de qualidade.** Distribuição de paths ao longo do tempo
  é proxy de maturidade do classificador.

---

## 8. Fluxo de decisão completo

```
Entrada: signals_json validado contra schema v1
    │
    ▼
┌────────────────────────────────────────────────────┐
│ 1. select_generation_path(payload) → "llm" ou      │
│    "fallback"                                      │
└────────────────────────────────────────────────────┘
    │
    ├─── "llm" ──────────┐
    │                    ▼
    │            ┌────────────────────────────────────┐
    │            │ 2a. Construir prompt + chamar LLM  │
    │            │ 2b. validate_output(resp, "llm")   │
    │            │ 2c. Se válido: gravar              │
    │            │     generation_path="llm"          │
    │            │ 2d. Se inválido após 3 tentativas: │
    │            │     ir para 3 com path="fallback"  │
    │            └────────────────────────────────────┘
    │                    │
    └─── "fallback" ─────┤
                         ▼
                ┌────────────────────────────────────┐
                │ 3a. Aplicar templates de fallback  │
                │     (long: A ou B, short: 1–4)     │
                │ 3b. validate_output(resp,          │
                │     "fallback")                    │
                │ 3c. Se válido: gravar              │
                │     generation_path="fallback"     │
                │ 3d. Se inválido: usar template     │
                │     mínimo absoluto, gravar        │
                │     generation_path=               │
                │     "minimal_template",            │
                │     disparar alerta interno        │
                └────────────────────────────────────┘
```

---

## 9. Exemplos completos de execução

### Exemplo 1 — Caminho LLM, sinais ricos

**Input:**

```json
{
  "schema_version": "1",
  "data_sources": { "l1": true, "l2": true },
  "ecosystems": {
    "dominant": ["rails"],
    "secondary": ["python", "react"],
    "emerging": ["python"],
    "declining": []
  },
  "test_pattern": { "discipline": "strong", "approach": "tdd_partial" },
  "workflow": { "primary": "test_after", "emerging": "refactor_heavy" },
  "timing": {
    "peak_period": "afternoon",
    "consistency": "very_consistent",
    "session_length": "medium"
  },
  "evolution": {
    "has_evolution": true,
    "timeframe": "couple_years",
    "trajectory": "stack_migration"
  },
  "tooling": { "platforms": ["docker", "github_actions", "postgres", "github"] },
  "sample_size": { "confidence_band": "high" }
}
```

**Path selecionado:** `llm`

**Output (após chamada LLM + validação):**

```json
{
  "identity_long": "Dev backend de raiz Rails que migrou para Python nos últimos dois anos, mantendo disciplina forte de testes e ritmo concentrado nas tardes, com infraestrutura assentada em Docker e Postgres.",
  "identity_short": "Dev backend · Rails → Python",
  "confidence": "high"
}
```

Gravado: `generation_path="llm"`, `model_used="claude-haiku-4-5"`.

### Exemplo 2 — Fallback primário (sinais minimais)

**Input:**

```json
{
  "schema_version": "1",
  "data_sources": { "l1": false, "l2": true },
  "ecosystems": {
    "dominant": ["node"],
    "secondary": [],
    "emerging": [],
    "declining": []
  },
  "test_pattern": { "discipline": "minimal", "approach": "test_seldom" },
  "workflow": { "primary": "exploratory" },
  "timing": { "peak_period": "distributed", "consistency": "sporadic" },
  "evolution": {
    "has_evolution": false,
    "timeframe": "insufficient_history",
    "trajectory": "none"
  },
  "tooling": { "platforms": ["github"] },
  "sample_size": { "confidence_band": "minimal" }
}
```

**Path selecionado:** `fallback` (sample_size = "minimal" → bypass LLM)

**Output (template A + Caso 3 da hierarquia short):**

```json
{
  "identity_long": "Dev Node em fase inicial de captura do perfil, com primeiros sinais em GitHub.",
  "identity_short": "Backend · Node",
  "confidence": "low"
}
```

Contagens: long = 14 palavras (em 12–25 ✓), short = 3 palavras (em 1–5 ✓).
Gravado: `generation_path="fallback"`, `model_used=NULL`.

### Exemplo 3 — Fallback primário (bootstrap recente)

**Input:**

```json
{
  "schema_version": "1",
  "data_sources": { "l1": true, "l2": false },
  "ecosystems": {
    "dominant": ["flutter"],
    "secondary": ["dotnet"],
    "emerging": [],
    "declining": []
  },
  "test_pattern": { "discipline": "moderate", "approach": "test_after" },
  "workflow": { "primary": "exploratory" },
  "timing": { "peak_period": "evening", "consistency": "consistent" },
  "evolution": {
    "has_evolution": false,
    "timeframe": "many_years",
    "trajectory": "none"
  },
  "tooling": { "platforms": ["github", "github_actions"] },
  "sample_size": { "confidence_band": "low" }
}
```

**Path selecionado:** `fallback` (low + sem evolution + sem emerging)

**Output (template B + Caso 2 da hierarquia short):**

```json
{
  "identity_long": "Dev Flutter com disciplina moderada de testes e ritmo concentrado nas noites, trabalhando com GitHub e GitHub Actions.",
  "identity_short": "Mobile · Flutter e Dotnet",
  "confidence": "low"
}
```

Contagens: long = 19 palavras (em 12–25 ✓), short = 5 palavras (em 1–5 ✓).
Gravado: `generation_path="fallback"`, `model_used=NULL`.

---

## 10. Versionamento do schema

O campo `schema_version` no payload existe para evolução futura. Quando
adicionar nova dimensão (`code_review_pattern`, `documentation_habit`,
etc.), incrementar para `"2"`.

O backend mantém múltiplos prompts versionados e roteia pela versão.
Isso evita re-renderização de retratos antigos quando o sistema evolui,
e dá controle granular sobre rollout de novas dimensões.

Regra: tratar evolução desse schema com o mesmo rigor que migrations
de banco de dados em produção — backward-compatibility, deprecation
gradual, dual-write quando necessário.

---

## 11. Observabilidade

Métricas a coletar em produção:

| Métrica | Valor saudável | Alerta se |
|---------|----------------|-----------|
| `generation_path` distribution | LLM > 70%, fallback < 25%, minimal < 1% | Fallback > 40% (classificador precisa ajuste) |
| LLM validation failure rate | < 10% nas primeiras tentativas | > 25% (prompt precisa ajuste) |
| LLM final fallback rate | < 5% (após 3 retries) | > 15% |
| Latência geração total | < 3s p99 | > 10s |
| Custo médio por geração | < $0.001 (Haiku) | Aumento súbito |
| Minimal template usage | < 0.1% | > 1% (bug crítico no classificador) |

Dashboard interno mostra distribuição de paths ao longo do tempo,
fragmentos de saídas rejeitadas (sem dados de usuário) para revisão
manual semanal.

---

## 12. Itens fora de escopo desta spec

Documentados aqui para registro, não cobertos:

- **Internacionalização.** Prompt em PT-BR. Versão EN é trabalho separado
  (duplicar prompt, roteamento por config de usuário).
- **Customização visual paga.** Tier Pro pode oferecer customização sutil
  (cor de acento, tipografia). Decisão de produto, não de geração de frase.
- **Re-geração ativa.** Background job que re-roda fallbacks antigos com
  LLM quando dev acumula sinais. Implementar após v0.2 estabilizar.
- **A/B test de prompts.** Suportado pela arquitetura (prompts versionados),
  mas instrumentação dedicada é trabalho separado.

---

## 13. Critérios de pronto para produção

- [ ] Schema JSON v1 validado e versionado em repositório
- [ ] Função `validate_payload(payload)` implementada com `jsonschema`
- [ ] Função `select_generation_path(payload)` implementada e testada
- [ ] `LLMGenerator` implementada com retry + validação
- [ ] `FallbackGenerator` implementada com templates A/B e hierarquia short 1–4
- [ ] `validate_output(output, path)` implementada com regras duais
- [ ] Tabela `identity_phrases` criada com campo `generation_path`
- [ ] Template mínimo absoluto + alerta interno funcionando
- [ ] Testes cobrindo:
  - [ ] LLM path happy (3 exemplos da spec)
  - [ ] LLM retry após validação falha
  - [ ] Fallback path com sinais minimais
  - [ ] Fallback path após LLM falhar 3x
  - [ ] Template mínimo após fallback falhar
  - [ ] Validação de blacklist em ambos os paths
  - [ ] Validação de word count nos dois sets de regras
  - [ ] Hierarquia short: Caso 1, 2, 3, 4 isoladamente
  - [ ] Mapping de domínio para cada ecosystem
- [ ] Métricas de observabilidade instrumentadas
- [ ] Documento de runbook para alertas (minimal_template usado, fallback rate alto)

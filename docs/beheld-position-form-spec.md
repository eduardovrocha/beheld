# beheld — Position Form Spec (Redesign)

> Criado: 2026-05-26
> Escopo: reformulação do formulário de criação/edição de position
> URL: localhost:5173/company/dashboard#posicoes (criar e editar)

---

## Índice

1. [Visão geral](#1-visão-geral)
2. [Estrutura de abas](#2-estrutura-de-abas)
3. [Aba Descrição](#3-aba-descrição)
4. [Aba Critérios de Match](#4-aba-critérios-de-match)
5. [Dados de localização](#5-dados-de-localização)
6. [Modelo de dados](#6-modelo-de-dados)
7. [Mapeamento campos → banco](#7-mapeamento-campos--banco)
8. [Backlog](#8-backlog)
9. [Stop-and-ask conditions](#9-stop-and-ask-conditions)

---

## 1. Visão geral

O formulário de position é dividido em duas abas:

- **Descrição** — informações sobre a vaga para referência interna da empresa
- **Critérios de match** — sinais de telemetria que definem o matching contra os devs

As duas abas são independentes. A empresa pode salvar a position com apenas a Descrição preenchida — os critérios de match são opcionais para salvar, obrigatórios para ativar o matching.

**O que é removido:**
- Campo "importar arquivo" — removido sem substituto

---

## 2. Estrutura de abas

```
┌─────────────────┬─────────────────────┐
│   Descrição     │  Critérios de match  │
└─────────────────┴─────────────────────┘
```

Navegação por clique. Estado da aba ativa preservado ao trocar — dados não são perdidos ao navegar entre abas.

Botão "Salvar" presente em ambas as abas — salva o formulário inteiro independente da aba ativa.

---

## 3. Aba Descrição

### 3.1 Campos

| Campo | Tipo | Obrigatório | Model |
|-------|------|-------------|-------|
| Título | input text | sim | `positions.title` |
| Localização | dropdown hierárquico | não | `positions.location` (jsonb) |
| Responsabilidades | textarea | não | `positions.description` |
| Technical stack desejada | textarea | não | `positions.sections.technical_stack` |
| Requerimentos | textarea | não | `positions.sections.requirements` |
| Qualificações | textarea | não | `positions.sections.qualifications` |
| Nice to have | textarea | não | `positions.sections.nice_to_have` |
| Tecnologias | tag input | não | `positions.technologies` (array) |

### 3.2 Localização — dropdown hierárquico

Quatro níveis em cascata. Cada nível só aparece após o nível anterior ser selecionado.

```
Nível 1 — Região
  Remote
  América do Norte
  América Central
  América do Sul
  Europa Ocidental
  Leste Europeu
  Emirados Árabes Unidos
  Oceania
  Ásia
  África

Nível 2 — País (listado a partir da região selecionada)

Nível 3 — Estado / Província (listado a partir do país selecionado)
  Exibido apenas para países com subdivisões relevantes.
  Para países sem estados: pular para cidade.

Nível 4 — Cidade (listada a partir do estado selecionado)
```

**Seleção de "Remote":**
Ao selecionar Remote, os níveis 2, 3 e 4 não aparecem.
`location = { region: "remote" }`

**Seleção de qualquer outra região:**
Exibir nível 2 (países). A empresa pode salvar apenas com região + país sem precisar de estado e cidade.

**Valor armazenado:**
```json
{
  "region":  "south_america",
  "country": "BR",
  "state":   "MG",
  "city":    "Uberlândia"
}
```

**Display no dashboard:**
```
Remote
Uberlândia, MG — Brasil
São Paulo, SP — Brasil
Berlin — Alemanha
```

### 3.3 Campo Tecnologias

Tag input — o usuário digita e pressiona Enter ou vírgula para adicionar uma tecnologia.
Tags são removíveis com clique no ×.
Sem lista fixa — campo livre.

```
[ Ruby ] [ Rails ] [ PostgreSQL ] [ Docker ] [___________]
```

### 3.4 Campos de texto longo

Todos os textareas têm:
- Placeholder descritivo (ver seção de copy abaixo)
- Sem limite de caracteres na UI — apenas no banco (text)
- Redimensionável verticalmente

**Placeholders:**

| Campo | Placeholder |
|-------|-------------|
| Responsabilidades | "Descreva as principais responsabilidades do cargo..." |
| Technical stack desejada | "Ex: Ruby on Rails, PostgreSQL, Redis, Docker..." |
| Requerimentos | "Liste os requisitos obrigatórios para a vaga..." |
| Qualificações | "Experiências e formações desejadas..." |
| Nice to have | "Diferenciais que serão considerados, mas não obrigatórios..." |

---

## 4. Aba Critérios de Match

### 4.1 Campos

| Campo | Signal | Tipo | Obrigatório |
|-------|--------|------|-------------|
| Ecossistema | `ecosystems` | multi-select (opções fixas) | não |
| Test ratio mínimo | `test_ratio` | slider + input numérico | não |
| Frequência de certificado | `recency` | input numérico (dias) | não |

Ao menos um critério deve ser preenchido para ativar o matching.
Se nenhum critério for preenchido, a position é salva sem matching ativo — sem matches gerados.

### 4.2 Ecossistema

Multi-select com opções fixas (alinhado com os ecosystems detectados pelo beheld):

```
[ ] rails    [ ] node     [ ] python
[ ] react    [ ] flutter  [ ] devops
```

Seleção múltipla. Cada seleção adiciona um threshold `includes`.

### 4.3 Test ratio mínimo

Slider de 0 a 100 com input numérico ao lado.
Slider e input são sincronizados — alterar um atualiza o outro.

```
Test ratio mínimo
0 ────────●──────────── 100
          35%
```

Label de contexto abaixo do slider:
```
Devs com test maturity score abaixo de 35 não serão incluídos nos matches.
```

### 4.4 Frequência de certificado

Input numérico — máximo de dias desde o último bundle publicado.

```
Ativo nos últimos  [ 30 ]  dias
```

Label de contexto:
```
Devs sem bundle publicado nos últimos 30 dias não serão incluídos nos matches.
```

Valor mínimo: 1. Valor máximo: 365.

### 4.5 Prioridades (drag to rank)

Após definir os critérios, o recrutador ordena por importância.
Apenas critérios preenchidos aparecem na lista de prioridades.

```
Arraste para definir o que mais importa:

1. ☰ Test ratio
2. ☰ Ecossistema
3. ☰ Frequência de certificado
```

Pesos internos: 1º → 40%, 2º → 30%, 3º → 20%, 4º → 10%.
Os pesos são exibidos ao lado de cada item enquanto o usuário reordena.

---

## 5. Dados de localização

### 5.1 Fonte

JSON estático no frontend — sem dependência externa, sem latência.

Arquivo: `dashboard/src/data/locations.json`

### 5.2 Estrutura do JSON

```json
{
  "regions": [
    {
      "key": "remote",
      "label": "Remote",
      "countries": []
    },
    {
      "key": "south_america",
      "label": "América do Sul",
      "countries": [
        {
          "code": "BR",
          "label": "Brasil",
          "states": [
            {
              "code": "MG",
              "label": "Minas Gerais",
              "cities": ["Belo Horizonte", "Uberlândia", "Juiz de Fora", "Contagem"]
            },
            {
              "code": "SP",
              "label": "São Paulo",
              "cities": ["São Paulo", "Campinas", "Santos", "Ribeirão Preto"]
            }
          ]
        },
        {
          "code": "AR",
          "label": "Argentina",
          "states": [
            {
              "code": "BA",
              "label": "Buenos Aires",
              "cities": ["Buenos Aires", "La Plata", "Mar del Plata"]
            }
          ]
        }
      ]
    },
    {
      "key": "north_america",
      "label": "América do Norte",
      "countries": [
        {
          "code": "US",
          "label": "Estados Unidos",
          "states": [
            { "code": "CA", "label": "California", "cities": ["San Francisco", "Los Angeles", "San Diego"] },
            { "code": "NY", "label": "New York",   "cities": ["New York City", "Buffalo", "Albany"] },
            { "code": "TX", "label": "Texas",      "cities": ["Austin", "Houston", "Dallas"] }
          ]
        },
        {
          "code": "CA",
          "label": "Canadá",
          "states": [
            { "code": "ON", "label": "Ontario",          "cities": ["Toronto", "Ottawa", "Hamilton"] },
            { "code": "BC", "label": "British Columbia", "cities": ["Vancouver", "Victoria"] }
          ]
        }
      ]
    },
    {
      "key": "western_europe",
      "label": "Europa Ocidental",
      "countries": [
        {
          "code": "DE",
          "label": "Alemanha",
          "states": [
            { "code": "BY", "label": "Bavaria",     "cities": ["Munich", "Nuremberg"] },
            { "code": "BE", "label": "Berlin",      "cities": ["Berlin"] },
            { "code": "HH", "label": "Hamburg",     "cities": ["Hamburg"] }
          ]
        },
        {
          "code": "PT",
          "label": "Portugal",
          "states": [
            { "code": "LX", "label": "Lisboa",     "cities": ["Lisboa", "Sintra", "Cascais"] },
            { "code": "PT", "label": "Porto",       "cities": ["Porto", "Gaia", "Braga"] }
          ]
        },
        {
          "code": "ES",
          "label": "Espanha",
          "states": [
            { "code": "MD", "label": "Madrid",      "cities": ["Madrid", "Alcalá de Henares"] },
            { "code": "CT", "label": "Catalunha",   "cities": ["Barcelona", "Girona"] }
          ]
        }
      ]
    },
    {
      "key": "eastern_europe",
      "label": "Leste Europeu",
      "countries": [
        {
          "code": "PL",
          "label": "Polônia",
          "states": [
            { "code": "MA", "label": "Mazóvia",      "cities": ["Varsóvia", "Łódź"] },
            { "code": "PK", "label": "Pequena Polônia", "cities": ["Cracóvia"] }
          ]
        },
        {
          "code": "UA",
          "label": "Ucrânia",
          "states": [
            { "code": "KC", "label": "Kiev",         "cities": ["Kiev", "Kharkiv"] }
          ]
        },
        {
          "code": "RO",
          "label": "Romênia",
          "states": [
            { "code": "B",  "label": "Bucareste",    "cities": ["Bucareste"] },
            { "code": "CJ", "label": "Cluj",         "cities": ["Cluj-Napoca"] }
          ]
        }
      ]
    },
    {
      "key": "uae",
      "label": "Emirados Árabes Unidos",
      "countries": [
        {
          "code": "AE",
          "label": "Emirados Árabes Unidos",
          "states": [
            { "code": "DU", "label": "Dubai",        "cities": ["Dubai"] },
            { "code": "AZ", "label": "Abu Dhabi",    "cities": ["Abu Dhabi"] }
          ]
        }
      ]
    },
    {
      "key": "oceania",
      "label": "Oceania",
      "countries": [
        {
          "code": "AU",
          "label": "Austrália",
          "states": [
            { "code": "NSW", "label": "New South Wales", "cities": ["Sydney", "Newcastle"] },
            { "code": "VIC", "label": "Victoria",        "cities": ["Melbourne", "Geelong"] }
          ]
        },
        {
          "code": "NZ",
          "label": "Nova Zelândia",
          "states": [
            { "code": "AKL", "label": "Auckland",    "cities": ["Auckland"] },
            { "code": "WGN", "label": "Wellington",  "cities": ["Wellington"] }
          ]
        }
      ]
    },
    {
      "key": "asia",
      "label": "Ásia",
      "countries": [
        {
          "code": "IN",
          "label": "Índia",
          "states": [
            { "code": "MH", "label": "Maharashtra", "cities": ["Mumbai", "Pune"] },
            { "code": "KA", "label": "Karnataka",   "cities": ["Bangalore", "Mysore"] }
          ]
        },
        {
          "code": "SG",
          "label": "Singapura",
          "states": [
            { "code": "SG", "label": "Singapura",   "cities": ["Singapura"] }
          ]
        },
        {
          "code": "JP",
          "label": "Japão",
          "states": [
            { "code": "TK", "label": "Tóquio",      "cities": ["Tóquio"] },
            { "code": "OS", "label": "Osaka",        "cities": ["Osaka"] }
          ]
        }
      ]
    },
    {
      "key": "central_america",
      "label": "América Central",
      "countries": [
        {
          "code": "MX",
          "label": "México",
          "states": [
            { "code": "CMX", "label": "Cidade do México", "cities": ["Cidade do México"] },
            { "code": "JAL", "label": "Jalisco",           "cities": ["Guadalajara"] }
          ]
        },
        {
          "code": "CO",
          "label": "Colômbia",
          "states": [
            { "code": "CUN", "label": "Cundinamarca", "cities": ["Bogotá"] },
            { "code": "ANT", "label": "Antioquia",    "cities": ["Medellín"] }
          ]
        }
      ]
    },
    {
      "key": "africa",
      "label": "África",
      "countries": [
        {
          "code": "ZA",
          "label": "África do Sul",
          "states": [
            { "code": "GP", "label": "Gauteng",      "cities": ["Joanesburgo", "Pretória"] },
            { "code": "WC", "label": "Cabo Ocidental","cities": ["Cidade do Cabo"] }
          ]
        }
      ]
    }
  ]
}
```

### 5.3 Países sem estados

Países onde a subdivisão por estado não é relevante (ex: Singapura, UAE) têm um único
"estado" com o mesmo nome do país. O nível de estado é exibido apenas se `states.length > 1`.

---

## 6. Modelo de dados

### 6.1 Migration necessária

`positions.location` deve mudar de `string` para `jsonb`:

```ruby
# Migration: change_location_to_jsonb_in_positions
change_column :positions, :location, :jsonb, using: 'location::jsonb', default: {}

# Positions existentes com location string serão convertidas:
# "São Paulo" → { "raw": "São Paulo" }
# A UI exibirá o valor "raw" como fallback para positions antigas
```

### 6.2 Estrutura do location jsonb

```json
{ "region": "south_america", "country": "BR", "state": "MG", "city": "Uberlândia" }
{ "region": "remote" }
{ "raw": "São Paulo" }   ← fallback para positions anteriores à migration
```

### 6.3 sections jsonb — estrutura esperada

```json
{
  "technical_stack":  "Ruby on Rails, PostgreSQL, Redis...",
  "requirements":     "3+ anos de experiência com...",
  "qualifications":   "Experiência com sistemas distribuídos...",
  "nice_to_have":     "Conhecimento em Kubernetes..."
}
```

---

## 7. Mapeamento campos → banco

| Campo UI | Campo banco | Tipo |
|----------|-------------|------|
| Título | `positions.title` | string |
| Responsabilidades | `positions.description` | text |
| Localização | `positions.location` | jsonb |
| Technical stack | `positions.sections.technical_stack` | jsonb key |
| Requerimentos | `positions.sections.requirements` | jsonb key |
| Qualificações | `positions.sections.qualifications` | jsonb key |
| Nice to have | `positions.sections.nice_to_have` | jsonb key |
| Tecnologias | `positions.technologies` | array |
| Ecossistema | `position_thresholds` (signal: ecosystems) | tabela |
| Test ratio | `position_thresholds` (signal: test_ratio) | tabela |
| Frequência de certificado | `position_thresholds` (signal: recency) | tabela |
| Prioridades | `position_priorities` (ranking) | tabela |

---

## 8. Backlog

| ID | Item | Status |
|----|------|--------|
| PF.1 | Migration: `location` de string para jsonb | ⬜ |
| PF.2 | Componente `PositionFormTabs` — container com duas abas | ⬜ |
| PF.3 | Aba Descrição — todos os campos com mapeamento correto | ⬜ |
| PF.4 | Componente `LocationPicker` — dropdown hierárquico 4 níveis | ⬜ |
| PF.5 | `locations.json` — dados estáticos completos | ⬜ |
| PF.6 | Componente `TagInput` para campo Tecnologias | ⬜ |
| PF.7 | Aba Critérios de match — ecosistema, test ratio, recência | ⬜ |
| PF.8 | Componente `RangeSlider` para test ratio (sincronizado com input) | ⬜ |
| PF.9 | Drag to rank de prioridades — apenas critérios preenchidos | ⬜ |
| PF.10 | Persistência: POST/PATCH para backend com estrutura correta | ⬜ |
| PF.11 | Fallback de display para `location.raw` (positions antigas) | ⬜ |
| PF.12 | Remoção do campo "importar arquivo" do formulário existente | ⬜ |

---

## 9. Stop-and-ask conditions

O agente deve parar e perguntar antes de prosseguir se:

- A migration de `location` para jsonb causar erro em positions existentes
- O campo `sections` no banco não for jsonb — verificar antes de gravar sub-chaves
- O campo `technologies` não for array — verificar tipo antes de gravar tags
- O drag to rank incluir critérios não preenchidos na lista de prioridades
- O formulário permitir submit com test ratio = 0 junto com outros critérios (0 não é threshold válido)
- O `LocationPicker` tentar renderizar nível de estado para país sem estados definidos no JSON

# beheld — Position Matching Spec

> Criado: 2026-05-26
> Escopo: extensão do model Position · matching por telemetria · near-miss · curva de evolução · reativação

---

## Índice

1. [Visão geral](#1-visão-geral)
2. [Estrutura do position](#2-estrutura-do-job-posting)
3. [Motor de matching](#3-motor-de-matching)
4. [Near-miss](#4-near-miss)
5. [Curva de evolução](#5-curva-de-evolução)
6. [Ciclo de vida do posting](#6-ciclo-de-vida-do-posting)
7. [O que o dev vê](#7-o-que-o-dev-vê)
8. [Incentivo de atualização](#8-incentivo-de-atualização)
9. [Modelo de dados](#9-modelo-de-dados)
10. [Backlog por feature](#10-backlog-por-feature)
11. [Stop-and-ask conditions](#11-stop-and-ask-conditions)

---

## 1. Visão geral

Positions são internos ao beheld — não são publicados externamente.
A empresa define uma necessidade estruturada. O beheld calcula alinhamento
contra sinais reais de telemetria dos devs no diretório.

O dev não vê vagas, não busca oportunidades, não se candidata.
O dev é encontrado passivamente com base no que demonstra fazer.

**Fluxo completo**

```
empresa cria position (thresholds + prioridades)
  → matching imediato contra diretório
  → lista ranqueada por score (devs que passaram nos thresholds)
  → near-miss list (devs que falharam em exatamente 1 threshold dentro da margem)
  → empresa contata via PP10 (fluxo de mensagem existente)

30 dias → posting expira
  → empresa revisita: near-miss atualizado com curvas de evolução
  → decide: reativar como está / modificar thresholds / encerrar

dev com bundle ≥ 5 dias → nudge de atualização (terminal + dashboard)
dev com 1 bundle → aparece como "em construção" no near-miss
```

---

## 2. Estrutura da position

### Campos

| Campo | Tipo | Entra no matching | Obrigatório |
|-------|------|-------------------|-------------|
| Título | texto livre | não | sim — já existia |
| Descrição | texto livre | não | não — já existia |
| Localização | texto livre | não | não — já existia |
| Technologies | array | não | não — já existia, camada human-readable |
| Sections | jsonb | não | não — já existia |
| Ecosystems obrigatórios | multi-select | sim — threshold | não |
| Test ratio mínimo | numérico (0–100) | sim — threshold | não |
| Recência mínima | número de dias | sim — threshold | não |
| Prioridades | drag to rank | sim — pesos | sim |

Ao menos um threshold deve ser definido para ativar o matching.

### Prioridades (drag to rank)

O recrutador ordena os sinais por importância. O beheld converte internamente:

| Posição | Peso interno |
|---------|-------------|
| 1º | 40% |
| 2º | 30% |
| 3º | 20% |
| 4º | 10% |

Sinais não incluídos no ranking não contribuem para o score.

---

## 3. Motor de matching

### Fase 1 — Filtro por thresholds

Dev passa se atender a TODOS os thresholds definidos no posting.

```
threshold linguagens:  dev tem TypeScript → ✓
threshold ecosystems:  dev tem React      → ✓
threshold test ratio:  dev tem 34% ≥ 30% → ✓
threshold recência:    ativo há 12 dias ≤ 30 → ✓

resultado: PASSA → entra na lista ranqueada
```

Dev que falha em qualquer threshold → não entra na lista ranqueada.
Dev que falha em exatamente 1 threshold dentro da margem → near-miss.

### Fase 2 — Score ponderado (apenas quem passou)

Score é calculado sobre os sinais priorizados pelo recrutador.

**Fórmula por sinal:**

```
linguagens:  presença = 100% · ausência = 0%
ecosystems:  presença = 100% · ausência = 0%
test_ratio:  min(dev_ratio / threshold_ratio, 1.0) × 100
recência:    max(0, 1 - (dias_desde_bundle / threshold_dias)) × 100
```

**Score final:**

```
score = Σ (score_sinal × peso_sinal)
```

### Exemplo

```
Posting: TypeScript (40%), test ratio ≥ 30% (30%), React (20%), recência ≤ 30 dias (10%)

Dev octocat:
  TypeScript: presente      → 100% × 0.40 = 40.0
  test ratio: 38%           → (38/30) capped → 100% × 0.30 = 30.0
  React: presente           → 100% × 0.20 = 20.0
  recência: 8 dias          → (1 - 8/30) × 100 = 73.3% × 0.10 = 7.3

Score: 97.3% → exibido como 97%
```

### O que a empresa vê na lista ranqueada

```
Devs que correspondem a esta vaga

octocat       97%   Ver perfil →   Contatar
ghostwriter   84%   Ver perfil →   Contatar
codesmith     71%   Ver perfil →   Contatar
```

Score visível para a empresa como número inteiro.
O botão "Contatar" usa o fluxo PP10 existente — job_title preenchido automaticamente
com o título interno do posting.

---

## 4. Near-miss

### Critério de entrada na near-miss list

Dev entra na near-miss se:
- Falhou em **exatamente 1** threshold
- O valor do dev está dentro de **20% abaixo** do threshold exigido

```
threshold test ratio ≥ 30%
dev tem 25% → diferença = 16.7% → dentro de 20% → near-miss ✓

dev tem 18% → diferença = 40% → fora da margem → descartado ✗

threshold linguagens: TypeScript obrigatório
dev não tem TypeScript mas tem todos os outros → near-miss (1 falha) ✓
dev não tem TypeScript e não tem React → descartado (2 falhas) ✗
```

### O que a empresa vê na near-miss list

```
Devs próximos dos requisitos

octocat     falhou: test ratio (25% · exigido: 30%)   curva: ↑ +3% em 60 dias
ghostwriter falhou: React ausente                      curva: estável
codesmith   falhou: test ratio (26% · exigido: 30%)   curva: em construção (1 ponto)

Ver perfil →   Contatar
```

O botão "Contatar" usa o fluxo PP10 — disponível para near-miss igual ao match.

---

## 5. Curva de evolução

### O que é

Série temporal dos valores de cada sinal ao longo dos bundles publicados pelo dev.
Cada bundle publicado = um ponto na curva.

### Cálculo de tendência

```
se pontos ≥ 2:
  delta = último_valor - primeiro_valor
  tendência = ↑ se delta > 0 · ↓ se delta < 0 · → se delta = 0

se pontos = 1:
  tendência = "em construção"
```

### O que é exibido por dev no near-miss

```
test ratio: 25%   ↑ +3% em 60 dias   (baseado em 3 bundles)
```

Ou:

```
test ratio: 25%   em construção   (1 bundle publicado)
```

### Margem de near-miss para "em construção"

Dev com bundle único não tem trajetória confirmada.
Aparece na near-miss list normalmente — a empresa vê o sinal atual e o estado da curva.
Não é bloqueado, não é penalizado. A empresa decide se vale contatar.

---

## 6. Ciclo de vida do posting

### Estados

| Estado | Condição |
|--------|----------|
| `active` | criado e dentro de 30 dias |
| `expired` | 30 dias sem reativação |
| `closed` | encerrado manualmente pela empresa |

### Expiração e revisão

```
dia 30 → posting expira automaticamente
  → empresa recebe notificação no /company/dashboard
  → acessa tela de revisão do posting expirado

Tela de revisão exibe:
  - Lista ranqueada atualizada (devs que passaram hoje)
  - Near-miss list atualizada com curvas de evolução
  - Opções: Reativar · Modificar thresholds · Encerrar
```

### Reativação

Reativar reinicia o contador de 30 dias.
Os matches e near-misses são recalculados no momento da reativação.
Histórico de contatos anteriores (PP10) é preservado.

### Múltiplos postings

Empresa pode ter N postings ativos simultaneamente.
Cada posting tem matching independente.
O mesmo dev pode aparecer em múltiplos postings com scores diferentes.

---

## 7. O que o dev vê

O dev não vê vagas, requisitos, títulos ou conteúdo de qualquer posting.

No dashboard do dev — seção existente de notificações:

```
2 empresas têm necessidades que correspondem ao seu perfil esta semana.
```

Apenas contagem anônima. Sem nome de empresa, sem score, sem conteúdo da vaga.
Atualizado semanalmente.

A contagem é gerada a partir de postings ativos que incluem o dev
na lista ranqueada (não near-miss — apenas matches confirmados).

---

## 8. Incentivo de atualização

### Cadência de 5 dias

O beheld incentiva o dev a atualizar o bundle a cada 5 dias para enriquecer
a curva de evolução. Não é penalidade — é sinal de atividade.

**No terminal** — ao rodar qualquer comando `beheld` com bundle ≥ 5 dias:

```
→ Seu bundle tem 6 dias.
  Atualize para enriquecer sua curva de evolução: beheld profile generate
```

Exibido uma vez por sessão de terminal. Não bloqueia o comando.

**No dashboard do dev** — indicador visual:

```
Curva de evolução   ████░░░░   3 pontos · última atualização há 6 dias
                               beheld profile generate
```

### Distinção com o threshold de 30 dias

| Conceito | Threshold | Efeito |
|----------|-----------|--------|
| Perfil desatualizado | 30 dias | badge público muda — visível para todos |
| Nudge de atualização | 5 dias | aviso interno — não visível externamente |

---

## 9. Modelo de dados

### Tabela existente: positions (estendida)

`positions` já existe no backend com os campos:
`id, company_id, title, description, location, archived_at, created_at, updated_at, technologies, sections`

Campos adicionados via migration:

```
positions (campos novos)
  status              string not null default 'active'   # active | expired | closed
  activated_at        datetime
  expires_at          datetime   # activated_at + 30 dias

  # archived_at já existia — positions arquivadas migram para status: closed
  # technologies e sections coexistem — camada human-readable, não usada no matching
```

### Novas tabelas (backend/)

```
position_thresholds
  id                  uuid pk
  position_id         uuid not null fk positions
  signal              enum: ecosystems | test_ratio | recency
  operator            enum: includes | gte | lte
  value               jsonb not null
  created_at          datetime not null

position_priorities
  id                  uuid pk
  position_id         uuid not null fk positions
  signal              enum: ecosystems | test_ratio | recency
  ranking             integer not null   # 1, 2, 3, 4
  weight              decimal not null   # 0.40, 0.30, 0.20, 0.10
  created_at          datetime not null

  index: [position_id, ranking] unique

position_matches
  id                  uuid pk
  position_id         uuid not null fk positions
  account_id          uuid not null fk accounts
  score               decimal not null   # 0.0 a 100.0
  match_type          string not null    # match | near_miss
  failed_signal       string             # nullable — apenas near_miss
  calculated_at       datetime not null
  created_at          datetime not null

  index: [position_id, account_id] unique
  index: [position_id, score desc]
  index: [position_id, match_type]
```

### Sinais disponíveis para matching

| Signal | Fonte no bundle_data | Escala |
|--------|---------------------|--------|
| `ecosystems` | `payload.l1.ecosystems` → keys com valor `true` | presença/ausência |
| `test_ratio` | `payload.l1.avg_test_ratio` × 100 | 0–100 (%) |
| `recency` | `bundle.last_bundle_at` (campo de banco) | dias desde o bundle |

`languages` não existe no bundle_data desta versão — não implementar.

### Tabela existente: bundles

A curva de evolução é calculada a partir dos bundles históricos do dev.
Não requer nova tabela — usa `bundles` com `bundle_data` + `published_at`.

### Cálculo de tendência (derivado, não persistido)

```ruby
def evolution_curve(account, signal)
  points = account.bundles.active
                          .order(published_at: :asc)
                          .map { |b| extract_signal(b.bundle_data, signal) }
                          .compact

  return { status: :building, points: points.count } if points.size < 2

  delta = points.last - points.first
  trend = delta > 0 ? :up : delta < 0 ? :down : :stable

  {
    status:  :available,
    current: points.last,
    delta:   delta,
    trend:   trend,
    points:  points.count,
    period_days: (bundles.last.published_at - bundles.first.published_at).to_i / 86400
  }
end
```

---

## 10. Backlog por feature

### P16 — Position: extensão para matching

| ID | Item | Status |
|----|------|--------|
| P16.1 | Migration: adicionar `status`, `activated_at`, `expires_at` à tabela `positions` existente | ⬜ |
| P16.2 | Migration: criar `position_thresholds` | ⬜ |
| P16.3 | Migration: criar `position_priorities` (campo `ranking`, não `position`) | ⬜ |
| P16.4 | Criar/editar position com thresholds + prioridades | ⬜ |
| P16.5 | Encerrar position manualmente | ⬜ |
| P16.6 | Expiração automática em 30 dias | ⬜ |
| P16.7 | Listagem de positions ativas e expiradas no /company/dashboard | ⬜ |
| P16.8 | Múltiplas positions simultâneas por empresa | ⬜ |

### P17 — Motor de matching

| ID | Item | Status |
|----|------|--------|
| P17.1 | Fase 1: filtro por thresholds | ⬜ |
| P17.2 | Fase 2: score ponderado por prioridades | ⬜ |
| P17.3 | Persistência de matches em `position_matches` | ⬜ |
| P17.4 | Recálculo de matches ao reativar position | ⬜ |
| P17.5 | Lista ranqueada visível no /company/dashboard | ⬜ |
| P17.6 | Botão "Contatar" com título da position preenchido automaticamente (PP10) | ⬜ |

### P18 — Near-miss

| ID | Item | Status |
|----|------|--------|
| P18.1 | Identificação de near-miss (1 falha + margem 20%) | ⬜ |
| P18.2 | Persistência em `position_matches` (match_type: near_miss) | ⬜ |
| P18.3 | Near-miss list visível na tela de revisão da position expirada | ⬜ |
| P18.4 | Botão "Contatar" disponível para near-miss | ⬜ |

### P19 — Curva de evolução

| ID | Item | Status |
|----|------|--------|
| P19.1 | Cálculo de tendência por sinal a partir de bundles históricos | ⬜ |
| P19.2 | Exibição de curva no near-miss list: ↑ / ↓ / → / em construção | ⬜ |
| P19.3 | Dev com bundle único exibido como "em construção" | ⬜ |

### P20 — Ciclo de vida e revisão

| ID | Item | Status |
|----|------|--------|
| P20.1 | Notificação ao expirar position (portal + email se configurado) | ⬜ |
| P20.2 | Tela de revisão: matches + near-miss + opções (reativar/modificar/encerrar) | ⬜ |
| P20.3 | Reativação reinicia contador de 30 dias e recalcula matches | ⬜ |

### P21 — Dev: contagem anônima de interesse

| ID | Item | Status |
|----|------|--------|
| P21.1 | Contagem semanal de positions ativas que incluem o dev como match | ⬜ |
| P21.2 | Exibição no dashboard do dev: "N empresas têm necessidades que correspondem ao seu perfil" | ⬜ |
| P21.3 | Contagem baseada apenas em matches confirmados — não near-miss | ⬜ |

### P22 — Incentivo de atualização (5 dias)

| ID | Item | Status |
|----|------|--------|
| P22.1 | Nudge no terminal quando bundle ≥ 5 dias | ⬜ |
| P22.2 | Indicador de curva no dashboard do dev | ⬜ |
| P22.3 | Nudge exibido uma vez por sessão de terminal | ⬜ |

---

## 11. Stop-and-ask conditions

O agente implementador deve parar e perguntar antes de prosseguir se:

- A migration `add_matching_fields_to_positions` alterar ou perder dados de positions existentes
- O motor de matching precisar de dados de telemetria não presentes em `bundle_data`
- A fórmula de score produzir valores fora do range 0–100
- O critério de near-miss (1 falha + 20% de margem) precisar de ajuste para sinais binários (ecosystems)
- `languages` for adicionado como signal sem existir no `bundle_data`
- `position` for usado como nome de coluna em `position_priorities` — usar `ranking`
- A curva de evolução tentar calcular tendência para `ecosystems` ou `recency` — apenas `test_ratio`
- O cálculo de contagem anônima para o dev incluir near-miss — apenas matches confirmados
- Qualquer dado da position (título, thresholds, requisitos) vazar para endpoints acessíveis pelo dev
- A reativação de position alterar matches históricos já persistidos

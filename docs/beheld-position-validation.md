# PP-VAL — Validação: Position Matching (PP16–PP22)

> Execute após PP22 concluído.
> Cole o contexto global no início da sessão antes deste prompt.
> Este prompt não implementa nada — apenas verifica e reporta.

---

## Objetivo

Validar que as implementações PP16–PP22 estão corretas, completas e consistentes
com a spec (`beheld-jobposting-spec.md`) e os prompts (`beheld-jobposting-prompts.md`).

Ao final, produzir um relatório com: ✓ passou · ✗ falhou · ⚠ atenção.

---

## 1. Integridade das migrations

```
cd backend

# 1.1 — positions existentes foram preservadas
rails c
Position.count   # deve ser > 0 se havia dados, ou 0 se base limpa — nunca erro

# 1.2 — novos campos existem
Position.column_names.include?("status")        # → true
Position.column_names.include?("activated_at")  # → true
Position.column_names.include?("expires_at")    # → true

# 1.3 — campos originais preservados
Position.column_names.include?("title")         # → true
Position.column_names.include?("description")   # → true
Position.column_names.include?("technologies")  # → true
Position.column_names.include?("sections")      # → true
Position.column_names.include?("archived_at")   # → true

# 1.4 — tabelas novas existem
ActiveRecord::Base.connection.table_exists?("position_thresholds")  # → true
ActiveRecord::Base.connection.table_exists?("position_priorities")  # → true
ActiveRecord::Base.connection.table_exists?("position_matches")     # → true

# 1.5 — campo ranking (não position) em position_priorities
PositionPriority.column_names.include?("ranking")   # → true
PositionPriority.column_names.include?("position")  # → false (conflito de nome evitado)

# 1.6 — languages NÃO é um signal válido
PositionThreshold.new(signal: "languages").valid?   # → false
PositionPriority.new(signal: "languages").valid?    # → false
```

---

## 2. Testes automatizados

```
# Rodar todos os testes das features PP16–PP22

cd backend

bundle exec rspec \
  spec/models/position_spec.rb \
  spec/models/position_threshold_spec.rb \
  spec/models/position_priority_spec.rb \
  spec/services/matching_service_spec.rb \
  spec/services/evolution_curve_service_spec.rb \
  spec/jobs/matching_job_spec.rb \
  spec/jobs/expire_positions_job_spec.rb \
  spec/jobs/expired_posting_notification_job_spec.rb \
  spec/jobs/respond_contact_job_spec.rb \
  spec/mailers/position_mailer_spec.rb \
  spec/requests/api/v1/company/positions_spec.rb \
  spec/requests/api/v1/company/position_matches_spec.rb \
  spec/requests/api/v1/company/position_near_misses_spec.rb \
  spec/requests/api/v1/dev/interest_count_spec.rb \
  spec/requests/api/v1/dev/bundle_health_spec.rb \
  --format documentation

# Resultado esperado: ZERO falhas

cd dashboard

npx vitest run \
  src/pages/company/PositionForm.test.jsx \
  src/pages/company/PositionMatches.test.jsx \
  src/pages/company/PositionReview.test.jsx \
  src/components/company/NearMissList.test.jsx \
  src/components/company/EvolutionCurve.test.jsx \
  src/components/dev/InterestCount.test.jsx \
  src/components/dev/BundleHealth.test.jsx

# Resultado esperado: ZERO falhas
```

---

## 3. MatchingService — validação com dados reais

```ruby
# Criar fixtures de teste no rails console

# Bundle com estrutura real do beheld F6.8
bundle_data = {
  "payload" => {
    "l1" => {
      "ecosystems"     => { "rails" => true, "python" => false, "react" => true },
      "avg_test_ratio" => 0.42   # 42%
    },
    "l2" => {
      "sessions_analyzed" => 847,
      "period_days"       => 90
    }
  }
}

# 3.1 — extract_signal funciona com a estrutura real
service = MatchingService.new(Position.last)
ecosystems = service.send(:extract_signal, bundle_data, bundle, "ecosystems")
ecosystems   # → deve ser array: ["rails", "react"]

test_ratio = service.send(:extract_signal, bundle_data, bundle, "test_ratio")
test_ratio   # → deve ser float: 42.0 (não 0.42)

# 3.2 — avg_test_ratio 0.42 → score em percentual (42.0), não decimal
# Se threshold test_ratio gte 30:
#   (42.0 / 30.0) capped a 100 → score 100.0 ✓
# Se threshold test_ratio gte 50:
#   (42.0 / 50.0) × 100 → score 84.0 ✓

# 3.3 — recency via bundle.last_bundle_at (não bundle_data)
recency = service.send(:extract_signal, bundle_data, bundle, "recency")
recency   # → número de dias inteiro (ex: 8)

# 3.4 — languages retorna nil
languages = service.send(:extract_signal, bundle_data, bundle, "languages")
languages   # → nil
```

---

## 4. Near-miss — validação das regras

```ruby
# 4.1 — 1 falha dentro de 20% → near_miss
# threshold test_ratio gte 30, dev tem 25 (diferença 16.7% < 20%) → near_miss ✓
# threshold test_ratio gte 30, dev tem 18 (diferença 40% > 20%) → descartado ✓

# 4.2 — 2 falhas → descartado (não near_miss)
# threshold ecosystems includes ["rails"], dev não tem rails
# threshold test_ratio gte 30, dev tem 25
# → 2 falhas → descartado ✓

# 4.3 — 1 falha ecosystems (binário) → near_miss independente de margem
# threshold ecosystems includes ["rails"], dev não tem rails mas tem todos os outros → near_miss ✓

# Verificar no banco após rodar MatchingService:
PositionMatch.where(match_type: "near_miss").each do |m|
  puts "#{m.account_id} falhou em: #{m.failed_signal}"
end
# failed_signal nunca deve ser nil para near_miss
# failed_signal nunca deve ser "languages"
```

---

## 5. Curva de evolução — validação

```ruby
# 5.1 — apenas test_ratio tem curva
curve = EvolutionCurveService.new(account, "test_ratio").call
curve[:status]   # → :available (se ≥ 2 bundles) ou :building (se 1 bundle)

# 5.2 — ecosystems → not_applicable
curve = EvolutionCurveService.new(account, "ecosystems").call
curve[:status]   # → :not_applicable

# 5.3 — recency → not_applicable
curve = EvolutionCurveService.new(account, "recency").call
curve[:status]   # → :not_applicable

# 5.4 — valor extraído em percentual (não decimal)
# bundle com avg_test_ratio: 0.35 → ponto na curva deve ser 35.0, não 0.35

# 5.5 — dev com 1 bundle
account_1_bundle = Account.joins(:bundles).group("accounts.id").having("count(bundles.id) = 1").first
curve = EvolutionCurveService.new(account_1_bundle, "test_ratio").call
curve[:status]   # → :building
curve[:points]   # → 1
```

---

## 6. Ciclo de vida — validação

```ruby
# 6.1 — position expira em 30 dias
position = Position.active.last
position.expires_at   # → activated_at + 30 dias (tolerância: ± 1 minuto)

# 6.2 — expire! muda status
position.expire!
position.reload.status   # → "expired"

# 6.3 — reactivate! reinicia datas
position.reactivate!
position.reload.status      # → "active"
position.reload.expires_at  # → agora + 30 dias (tolerância: ± 1 minuto)

# 6.4 — close! preserva registro
position.close!
position.reload.status      # → "closed"
Position.find(position.id)  # → ainda existe, não foi deletado

# 6.5 — ExpirePositionsJob expira apenas positions com expires_at passado
Position.active.where("expires_at <= ?", Time.current).count  # → 0 após job rodar
```

---

## 7. Privacidade — validação crítica

```
# 7.1 — endpoints de position não acessíveis pelo dev
GET /api/v1/dev/positions   # → deve retornar 404 ou 401 (rota não existe para devs)

# 7.2 — /api/v1/company/positions/:id/matches não vaza dados de contato
rails c
response = JSON.parse(
  Net::HTTP.get(URI("http://localhost:3000/api/v1/company/positions/#{Position.last.id}/matches"))
)
# Para cada match no response:
response.each do |match|
  raise "VAZAMENTO: email_contact" if match.key?("email_contact")
  raise "VAZAMENTO: phone_contact" if match.key?("phone_contact")
  raise "VAZAMENTO: email_recovery" if match.key?("email_recovery")
end
puts "Privacidade OK"

# 7.3 — /api/v1/dev/interest_count não vaza dados da position
response = { count: N }   # apenas count, nada mais
# Verificar que response.keys == ["count"]

# 7.4 — near_misses não vaza dados de contato
# Mesmo check do 7.2 para /near_misses
```

---

## 8. Nudge de atualização — validação

```
# 8.1 — bundle com 4 dias → sem nudge
# 8.2 — bundle com 5 dias → nudge exibido
# 8.3 — bundle com 5 dias + nudge já exibido hoje → sem nudge

bun test packages/cli/tests/nudge.test.ts --reporter=verbose

# 8.4 — nudge não usa linguagem de penalidade
# Inspecionar texto do nudge em packages/cli/src/lib/nudge.ts:
grep -i "penalidade\|expirou\|perdeu\|atenção\|urgente\|obrigatório" \
  packages/cli/src/lib/nudge.ts
# → deve retornar vazio (zero ocorrências)
```

---

## 9. Formulário React — validação

```
# Acessar localhost:5173/company/positions/new

# 9.1 — campo Linguagens não existe no formulário
# Inspecionar DOM ou código do componente:
grep -r "linguagens\|languages" dashboard/src/pages/company/PositionForm.jsx
# → deve retornar vazio ou apenas comentários

# 9.2 — ecosystems com opções fixas corretas
# Opções esperadas: rails · node · python · flutter · react · devops
# Sem valores arbitrários ou livres

# 9.3 — submit sem threshold → erro de validação visível
# Preencher apenas título → tentar submit → mensagem de erro aparece

# 9.4 — drag to rank atualiza pesos exibidos em tempo real
# Reordenar prioridades → pesos (40%, 30%, 20%, 10%) redistribuem conforme posição
```

---

## 10. Integração end-to-end

```
Executar o fluxo completo manualmente:

1. Criar position com:
   - Ecosystem obrigatório: rails
   - Test ratio mínimo: 30%
   - Prioridades: test_ratio (1º), ecosystems (2º)

2. Verificar que MatchingJob foi enfileirado

3. Aguardar MatchingJob executar (ou rodar manualmente: MatchingJob.perform_now(position.id))

4. Verificar matches:
   GET /api/v1/company/positions/:id/matches
   → devs com rails + test_ratio ≥ 30% aparecem ranqueados por score
   → scores entre 0 e 100

5. Verificar near-misses:
   GET /api/v1/company/positions/:id/near_misses
   → devs com 1 threshold falhado dentro de 20%
   → failed_signal preenchido
   → evolution presente (available / building / not_applicable)

6. Simular expiração:
   position.update!(expires_at: 1.minute.ago)
   ExpirePositionsJob.perform_now
   position.reload.status   # → "expired"

7. Verificar contagem no dashboard do dev:
   GET /api/v1/dev/interest_count
   → count reflete apenas matches confirmados em positions ativas
   → após expiração: count decrementado
```

---

## Relatório final

Para cada item acima, reportar:

```
MIGRATIONS
  [✓/✗] 1.1 — positions preservadas
  [✓/✗] 1.2 — novos campos existem
  [✓/✗] 1.3 — campos originais preservados
  [✓/✗] 1.4 — tabelas novas criadas
  [✓/✗] 1.5 — campo ranking (não position)
  [✓/✗] 1.6 — languages inválido como signal

TESTES
  [✓/✗] backend: N specs, N passando, N falhando
  [✓/✗] dashboard: N testes, N passando, N falhando

MATCHING
  [✓/✗] 3.1 — ecosystems extraído como array
  [✓/✗] 3.2 — test_ratio em percentual (não decimal)
  [✓/✗] 3.3 — recency via bundle.last_bundle_at
  [✓/✗] 3.4 — languages retorna nil

NEAR-MISS
  [✓/✗] 4.1 — margem 20% aplicada
  [✓/✗] 4.2 — 2 falhas → descartado
  [✓/✗] 4.3 — ecosystems binário → near_miss

CURVA DE EVOLUÇÃO
  [✓/✗] 5.1 — test_ratio tem curva
  [✓/✗] 5.2 — ecosystems → not_applicable
  [✓/✗] 5.3 — recency → not_applicable
  [✓/✗] 5.4 — valor em percentual
  [✓/✗] 5.5 — 1 bundle → building

CICLO DE VIDA
  [✓/✗] 6.1 — expires_at = activated_at + 30 dias
  [✓/✗] 6.2 — expire! muda status
  [✓/✗] 6.3 — reactivate! reinicia datas
  [✓/✗] 6.4 — close! preserva registro
  [✓/✗] 6.5 — job expira apenas positions devidas

PRIVACIDADE
  [✓/✗] 7.1 — rotas de position inacessíveis pelo dev
  [✓/✗] 7.2 — matches sem dados de contato
  [✓/✗] 7.3 — interest_count retorna apenas count
  [✓/✗] 7.4 — near_misses sem dados de contato

NUDGE
  [✓/✗] 8.1 — 4 dias → sem nudge
  [✓/✗] 8.2 — 5 dias → nudge
  [✓/✗] 8.3 — nudge não repetido no mesmo dia
  [✓/✗] 8.4 — sem linguagem de penalidade

FORMULÁRIO
  [✓/✗] 9.1 — sem campo languages
  [✓/✗] 9.2 — ecosystems com opções fixas
  [✓/✗] 9.3 — validação de threshold
  [✓/✗] 9.4 — pesos atualizados em tempo real

END-TO-END
  [✓/✗] 10 — fluxo completo sem erros

RESULTADO FINAL
  ✓ N itens passando
  ✗ N itens falhando
  ⚠ N itens com atenção
```

Se qualquer item crítico falhar (privacidade, matching, migrations), PARAR e reportar
antes de qualquer correção. Não corrigir silenciosamente — listar o que falhou
e aguardar instrução.

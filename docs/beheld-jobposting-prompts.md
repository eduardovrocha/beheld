# beheld — Prompts de Execução: Job Postings (PP16–PP22)

> Execute um prompt por sessão no Claude Code.
> Ordem obrigatória: PP16 → PP17 → PP18 → PP19 → PP20 → PP21 → PP22
> Cole o contexto global no início de cada sessão.

---

## Contexto global (cole no início de cada sessão)

```
Você está trabalhando no beheld — daemon local que constrói o perfil técnico
de um desenvolvedor a partir do uso do Claude Code e do Continue.dev.

Stack:
- Frontend/Dashboard: React + Vite → localhost:5173
- Backend: Rails API mode → localhost:3000
- Auth empresa: cookie _beheld_company_session
- Auth dev: DevSession token via challenge/response Ed25519

Raiz do projeto web:
  /Users/eduardovrocha/Development/ioit.solutions/beheld/web/source/

Estrutura:
  source/
  ├── frontend/    # portal público — beheld.dev
  ├── dashboard/   # área autenticada — dev e empresa (React + Vite)
  ├── admin/       # não implementar
  └── backend/     # Rails API

Job postings são internos ao beheld — não publicados externamente.
O dev nunca vê vagas, requisitos ou títulos de postings.
O dev vê apenas contagem anônima semanal de interesse.

Princípios inegociáveis:
- Nenhum dado de job posting exposto em endpoints acessíveis pelo dev
- Forever free para o dev — nenhum mecanismo de cobrança
- Matching baseado apenas em sinais de telemetria do bundle_data
- near-miss: exatamente 1 threshold falhado + dentro de 20% do valor exigido

Regras de implementação:
1. Implemente uma feature por vez, completa antes de avançar
2. Testes junto com o código — nunca depois
3. Sem TODO ou placeholder — implemente ou não inclua
4. Valide cada critério antes de reportar como concluído
5. Conventional commits: feat:, fix:, chore:, test:
6. RSpec para backend · Vitest + Testing Library para React
```

---

## PP16 — Position: extensão para matching

```
Estenda o model Position existente com capacidade de matching por telemetria.

### Contexto

Position já existe no backend com os campos:
  id, company_id, title, description, location, archived_at,
  created_at, updated_at, technologies, sections

Não criar uma nova tabela — estender a existente.
technologies e sections coexistem com os thresholds (camada human-readable).
archived_at já existe — mapeia para status: closed.

Job posting tem duas partes estruturadas:
  thresholds — filtros de entrada (ao menos 1 obrigatório)
  priorities — drag to rank (pesos internos: 1º=40%, 2º=30%, 3º=20%, 4º=10%)

Signals disponíveis: ecosystems | test_ratio | recency
(languages não existe no bundle_data desta versão — não implementar)

### O que implementar

**1. Migrations — backend/db/migrate/**

Verificar antes de criar: ler backend/db/schema.rb e confirmar campos e tabelas.

  011_add_matching_fields_to_positions.rb
    add_column :positions, :status,       :string,   null: false, default: 'active'
    add_column :positions, :activated_at, :datetime
    add_column :positions, :expires_at,   :datetime

    add_index :positions, [:company_id, :status]
    add_index :positions, :expires_at

    # Preencher activated_at e expires_at para positions existentes
    # que não têm archived_at (ainda ativas):
    Position.where(archived_at: nil).update_all(
      activated_at: Time.current,
      expires_at:   30.days.from_now
    )

    # Positions já arquivadas → status closed
    Position.where.not(archived_at: nil).update_all(status: 'closed')

  012_create_position_thresholds.rb
    id              uuid pk default gen_random_uuid()
    position_id     uuid not null fk positions
    signal          string not null   # ecosystems | test_ratio | recency
    operator        string not null   # includes | gte | lte
    value           jsonb not null
    created_at      datetime not null

  013_create_position_priorities.rb
    id              uuid pk default gen_random_uuid()
    position_id     uuid not null fk positions
    signal          string not null
    ranking         integer not null   # 1, 2, 3, 4
    weight          decimal not null   # 0.40, 0.30, 0.20, 0.10
    created_at      datetime not null

    index: [position_id, ranking] unique

**2. Models — backend/app/models/**

  Position (já existe — adicionar ao model existente)
    # Associações novas:
    has_many :position_thresholds, dependent: :destroy
    has_many :position_priorities, dependent: :destroy
    has_many :position_matches,    dependent: :destroy

    # Validações novas:
    validates :status, inclusion: { in: %w[active expired closed] }

    # Campos existentes preservados:
    # title, description, location, technologies, sections, archived_at

    scope :active,   -> { where(status: 'active') }
    scope :expired,  -> { where(status: 'expired') }

    def active?;  status == 'active'  end
    def expired?; status == 'expired' end
    def closed?;  status == 'closed'  end

    def expire!
      update!(status: 'expired')
    end

    def reactivate!
      update!(
        status:       'active',
        activated_at: Time.current,
        expires_at:   30.days.from_now
      )
    end

    def close!
      update!(status: 'closed')
    end

  PositionThreshold
    belongs_to :position
    validates :signal,   inclusion: { in: %w[ecosystems test_ratio recency] }
    validates :operator, inclusion: { in: %w[includes gte lte] }
    validates :value,    presence: true

  PositionPriority
    belongs_to :position
    validates :signal,  inclusion: { in: %w[ecosystems test_ratio recency] }
    validates :ranking, inclusion: { in: [1, 2, 3, 4] }
    validates :weight,  inclusion: { in: [0.40, 0.30, 0.20, 0.10] }
    validates :position_id, uniqueness: { scope: :ranking }

**3. API endpoints — backend/app/controllers/api/v1/company/positions_controller.rb**

Requer CompanyAuthenticated.

  GET /api/v1/company/positions
    Lista postings da empresa com status, título, contagem de matches.
    Ordenado por activated_at desc.
    Resposta:
      [{
        id, title, status, activated_at, expires_at,
        matches_count, near_miss_count
      }]

  POST /api/v1/company/positions
    Body:
      {
        title: string,
        notes: string (opcional),
        thresholds: [
          { signal: "test_ratio", operator: "gte", value: 30 },
          { signal: "ecosystems", operator: "includes", value: ["rails"] }
        ],
        priorities: [
          { signal: "test_ratio", position: 1 },
          { signal: "ecosystems", position: 2 }
        ]
      }

    Validação: ao menos 1 threshold obrigatório.
    Calcular pesos a partir de positions: 1→0.40, 2→0.30, 3→0.20, 4→0.10
    Criar Position com activated_at = now, expires_at = 30.days.from_now
    Criar thresholds e priorities associados
    Enfileirar MatchingJob.perform_later(position.id)
    Resposta 201: { id, title, status, expires_at }

  GET /api/v1/company/positions/:id
    Detalhe do posting com thresholds, priorities, matches e near_misses.

  PATCH /api/v1/company/positions/:id
    Atualiza title, notes, thresholds e priorities.
    Apenas postings com status active ou expired.
    Reenfileirar MatchingJob após update.

  DELETE /api/v1/company/positions/:id
    Encerra posting: position.close!
    Não deleta — apenas muda status para closed.

**4. Job de expiração — backend/app/jobs/expire_positions_job.rb**

  Executado diariamente via cron (configurar no config/schedule.rb ou Sidekiq-cron).

  perform:
    Position.active.where('expires_at <= ?', Time.current).find_each do |posting|
      posting.expire!
      ExpiredPostingNotificationJob.perform_later(posting.id)
    end

**5. Rotas — backend/config/routes.rb**

  namespace :api do
    namespace :v1 do
      namespace :company do
        resources :positions, only: [:index, :show, :create, :update, :destroy] do
          member do
            post :reactivate
          end
        end
      end
    end
  end

  POST /api/v1/company/positions/:id/reactivate
    posting.reactivate!
    Reenfileirar MatchingJob.perform_later(posting.id)
    Resposta 200: { id, status, expires_at }

**6. Componentes React — dashboard/src/**

  pages/company/Positions.jsx
    Lista todos os postings da empresa.
    Cada item: título · status badge · expires_at · matches_count · near_miss_count
    Ações: Ver matches · Editar · Encerrar
    Botão: "Criar nova vaga"

  pages/company/PositionForm.jsx
    Formulário de criação e edição.

    Seção 1 — Informações básicas:
      Input: Título interno (obrigatório)
      Textarea: Observações (opcional)

    Seção 2 — Requisitos mínimos (thresholds):
      Multi-select: Ecosystems obrigatórios
        Opções fixas: rails · node · python · flutter · react · devops
      Input numérico: Test ratio mínimo (%) — valor entre 0 e 100
      Input numérico: Ativo nos últimos N dias

      Ao menos 1 campo deve ser preenchido.
      NÃO incluir campo de Linguagens — não existe no bundle desta versão.

    Seção 3 — O que mais importa (prioridades):
      Drag to rank dos sinais definidos nos thresholds.
      Pesos calculados internamente (1º=40%, 2º=30%, 3º=20%, 4º=10%).
      Exibir peso ao lado de cada item enquanto o usuário reordena.

    Botão: "Criar vaga" / "Salvar alterações"

**7. Testes**

  backend/spec/models/position_spec.rb
    # Testar apenas os campos e comportamentos novos — não retestar o que já existe
    - reactivate! reinicia activated_at e expires_at, muda status para active
    - close! muda status para closed
    - expire! muda status para expired
    - scope active retorna apenas status active
    - archived_at presente → close! preserva archived_at
    - position com status active e expires_at passado → expire! funciona corretamente

  backend/spec/models/position_threshold_spec.rb
    - validates signal inclusion
    - validates operator inclusion
    - validates value presence

  backend/spec/models/position_priority_spec.rb
    - validates ranking inclusion [1,2,3,4]
    - validates uniqueness de position_id + ranking

  backend/spec/requests/api/v1/company/positions_spec.rb
    - GET sem auth → 401
    - GET com auth → lista positions da empresa
    - POST sem threshold → 422
    - POST com dados válidos → 201, MatchingJob enfileirado
    - PATCH position de outra empresa → 403
    - DELETE → status muda para closed, registro preservado, archived_at não alterado
    - POST /reactivate → activated_at atualizado, expires_at = 30 dias

  backend/spec/jobs/expire_positions_job_spec.rb
    - positions com expires_at passado → expiradas
    - positions com expires_at futuro → não alteradas
    - ExpiredPostingNotificationJob enfileirado para cada position expirada

  dashboard/src/pages/company/PositionForm.test.jsx
    - submit sem threshold → exibe erro de validação
    - submit com dados válidos → POST enviado com estrutura correta
    - drag to rank altera pesos exibidos

### Critério de conclusão

cd backend && bundle exec rails db:migrate → sem erros, positions existentes preservadas
cd backend && bundle exec rspec spec/models/position_spec.rb → todos passando
cd backend && bundle exec rspec spec/models/position_threshold_spec.rb → todos passando
cd backend && bundle exec rspec spec/models/position_priority_spec.rb → todos passando
cd backend && bundle exec rspec spec/requests/api/v1/company/positions_spec.rb → todos passando
cd backend && bundle exec rspec spec/jobs/expire_positions_job_spec.rb → todos passando
cd dashboard && npx vitest run src/pages/company/PositionForm.test.jsx → todos passando

rails c → Position.count preservado após migrate (zero registros perdidos)
POST /api/v1/company/positions sem threshold → 422
POST /api/v1/company/positions com dados válidos → 201, expires_at = now + 30 dias
DELETE /api/v1/company/positions/:id → status closed, registro preservado
ExpirePositionsJob → postings com expires_at passado marcados como expired
```

---

## PP17 — Motor de matching

```
Implemente o motor de matching — thresholds + score ponderado — e persista
os resultados em position_matches.

### Contexto

Matching opera em duas fases:
  Fase 1: filtro por thresholds (passa / não passa)
  Fase 2: score ponderado apenas para quem passou na fase 1

near-miss é calculado separadamente (PP18).

### Estrutura real do bundle_data

O bundle_data segue o schema do F6.8 do beheld:

  bundle_data = {
    "payload" => {
      "l1" => {
        "ecosystems"     => { "rails" => true, "python" => true },
        "platforms"      => { "docker" => true },
        "avg_test_ratio" => 0.42   # escala 0.0–1.0
      },
      "l2" => {
        "sessions_analyzed"    => 847,
        "period_days"          => 90,
        "workflow_distribution"=> { "tdd" => 0.23 }
      }
    }
  }

Signals disponíveis para matching (3 — não 4):
  ecosystems  → bundle_data.dig("payload","l1","ecosystems") → objeto {signal=>bool} → converter para array de keys true
  test_ratio  → bundle_data.dig("payload","l1","avg_test_ratio") × 100 → percentual 0–100
  recency     → calculado a partir de bundle.last_bundle_at (campo de banco, não bundle_data)

Signal "languages" NÃO existe no bundle — removido desta fase.

### O que implementar

**1. Migration — backend/db/migrate/**

  014_create_position_matches.rb
    id              uuid pk default gen_random_uuid()
    position_id  uuid not null fk positions
    account_id      uuid not null fk accounts
    score           decimal not null   # 0.0 a 100.0
    match_type      string not null    # match | near_miss
    failed_signal   string             # nullable — apenas near_miss
    calculated_at   datetime not null
    created_at      datetime not null
    updated_at      datetime not null

    index: [position_id, account_id] unique
    index: [position_id, score desc]
    index: [position_id, match_type]

**2. Service — backend/app/services/matching_service.rb**

  class MatchingService
    def initialize(position)
      @posting    = position
      @thresholds = position.position_thresholds
      @priorities = position.position_priorities.order(:ranking)
    end

    def call
      # Apenas devs com directory: true e bundle ativo
      candidates = Account.where(directory: true)
                          .joins(:bundles)
                          .where(bundles: { revoked_at: nil })
                          .distinct

      results = candidates.filter_map do |account|
        bundle = account.bundles.active.order(last_bundle_at: :desc).first
        next unless bundle&.bundle_data

        bundle_data = bundle.bundle_data
        failures = failed_thresholds(bundle_data, bundle)

        if failures.empty?
          score = calculate_score(bundle_data, bundle)
          { account: account, score: score, type: :match, failed: nil }
        elsif failures.size == 1 && near_miss?(bundle_data, bundle, failures.first)
          { account: account, score: 0, type: :near_miss, failed: failures.first }
        end
      end.compact

      persist_results(results)
    end

    private

    def failed_thresholds(bundle_data, bundle)
      @thresholds.reject { |t| threshold_met?(bundle_data, bundle, t) }.map(&:signal)
    end

    def threshold_met?(bundle_data, bundle, threshold)
      value = extract_signal(bundle_data, bundle, threshold.signal)
      return false if value.nil?

      case threshold.operator
      when 'includes'
        required = Array(JSON.parse(threshold.value.to_json))
        required.all? { |r| Array(value).include?(r) }
      when 'gte'
        value.to_f >= threshold.value.to_f
      when 'lte'
        value.to_f <= threshold.value.to_f
      end
    end

    def near_miss?(bundle_data, bundle, failed_signal)
      threshold = @thresholds.find { |t| t.signal == failed_signal }
      return false unless threshold
      return true if threshold.operator == 'includes'   # presença/ausência — sempre near-miss se 1 falha

      actual   = extract_signal(bundle_data, bundle, failed_signal).to_f
      required = threshold.value.to_f
      return false if required.zero?

      gap = (required - actual) / required
      gap <= 0.20   # dentro de 20% abaixo do threshold
    end

    def calculate_score(bundle_data, bundle)
      score = 0.0
      @priorities.each do |priority|
        threshold = @thresholds.find { |t| t.signal == priority.signal }
        next unless threshold

        signal_score = score_for_signal(bundle_data, bundle, threshold)
        score += signal_score * priority.weight.to_f
      end
      score.round(1).clamp(0.0, 100.0)
    end

    def score_for_signal(bundle_data, bundle, threshold)
      value = extract_signal(bundle_data, bundle, threshold.signal)
      return 0.0 if value.nil?

      case threshold.signal
      when 'ecosystems'
        100.0   # passou no threshold de presença = score máximo
      when 'test_ratio'
        required = threshold.value.to_f
        return 0.0 if required.zero?
        [value.to_f / required * 100.0, 100.0].min
      when 'recency'
        required = threshold.value.to_f   # dias máximos aceitáveis
        return 0.0 if required.zero?
        [1.0 - (value.to_f / required), 0.0].max * 100.0
      end
    end

    # bundle_data: hash do campo bundle_data no banco
    # bundle:      objeto Bundle (para campos de banco como last_bundle_at)
    def extract_signal(bundle_data, bundle, signal)
      payload = bundle_data.dig("payload") || bundle_data

      case signal
      when 'ecosystems'
        raw = payload.dig("l1", "ecosystems") || {}
        raw.select { |_, v| v == true }.keys   # → ["rails", "python"]

      when 'test_ratio'
        raw = payload.dig("l1", "avg_test_ratio")
        raw ? raw.to_f * 100.0 : nil           # 0.42 → 42.0

      when 'recency'
        return nil unless bundle
        ((Time.current - bundle.last_bundle_at) / 86400).floor   # dias desde o bundle

      # 'languages' não existe no bundle — nunca implementar
      end
    end

    def persist_results(results)
      # Deletar matches anteriores deste posting
      PositionMatch.where(position_id: @posting.id).delete_all

      results.each do |r|
        PositionMatch.create!(
          position_id: @posting.id,
          account_id:     r[:account].id,
          score:          r[:score],
          match_type:     r[:type].to_s,
          failed_signal:  r[:failed],
          calculated_at:  Time.current
        )
      end
    end
  end

**3. Job — backend/app/jobs/matching_job.rb**

  perform(position_id):
    posting = Position.find(position_id)
    return unless posting.active?
    MatchingService.new(posting).call

**4. Endpoint de matches — backend/app/controllers/api/v1/company/position_matches_controller.rb**

  GET /api/v1/company/positions/:position_id/matches

  Requer CompanyAuthenticated.
  Verificar que posting pertence à empresa.

  matches = PositionMatch.where(
    position_id: params[:position_id],
    match_type: 'match'
  ).order(score: :desc).includes(:account)

  render json: matches.map { |m|
    bundle = m.account.bundles.active.order(last_bundle_at: :desc).first
    {
      account_id:  m.account_id,
      dev_handle:  m.account.handle_or_fingerprint,
      bundle_slug: bundle&.url_slug,
      score:       m.score.round.to_i,
      calculated_at: m.calculated_at.iso8601
    }
  }

  # NUNCA incluir: email_contact, phone_contact, email_recovery

**5. Componente React — dashboard/src/pages/company/PositionMatches.jsx**

  Lista ranqueada de matches do posting.

  Para cada match:
    dev_handle (link para /v/:bundle_slug)
    score como número: "97%"
    botão "Contatar" → abre fluxo PP10 com job_title preenchido

  Se nenhum match: "Nenhum dev corresponde a esta vaga ainda."

**6. Testes**

  backend/spec/services/matching_service_spec.rb
    - dev com todos os thresholds atendidos → match com score calculado
    - dev com 1 threshold falhado dentro de 20% → near_miss
    - dev com 1 threshold falhado fora de 20% → não incluído
    - dev com 2 thresholds falhados → não incluído
    - dev com directory: false → não incluído
    - dev com bundle revogado → não incluído
    - score não excede 100.0
    - score não é negativo
    - recálculo deleta matches anteriores antes de persistir novos

  backend/spec/requests/api/v1/company/position_matches_spec.rb
    - GET sem auth → 401
    - GET de posting de outra empresa → 403
    - GET retorna apenas match_type: match (não near_miss)
    - GET não inclui email_contact nem phone_contact

  dashboard/src/pages/company/PositionMatches.test.jsx
    - renderiza lista ranqueada por score desc
    - score exibido como inteiro com %
    - "Nenhum dev" quando lista vazia

### Critério de conclusão

cd backend && bundle exec rspec spec/services/matching_service_spec.rb → todos passando
cd backend && bundle exec rspec spec/requests/api/v1/company/position_matches_spec.rb → todos passando
cd dashboard && npx vitest run src/pages/company/PositionMatches.test.jsx → todos passando

MatchingService com bundle real → score entre 0 e 100
Dev com directory: false → não aparece nos matches
GET /matches → sem email_contact nem phone_contact
```

---

## PP18 — Near-miss

```
Implemente a near-miss list — devs que falharam em exatamente 1 threshold
dentro da margem de 20%.

### Contexto

position_matches já persiste near_miss (implementado no PP17 via MatchingService).
Este prompt implementa a visualização e o fluxo de contato para near-miss.

### O que implementar

**1. Endpoint — backend/app/controllers/api/v1/company/position_near_misses_controller.rb**

  GET /api/v1/company/positions/:position_id/near_misses

  Requer CompanyAuthenticated.
  Verificar que posting pertence à empresa.

  near_misses = PositionMatch.where(
    position_id: params[:position_id],
    match_type: 'near_miss'
  ).includes(:account).order(calculated_at: :desc)

  render json: near_misses.map { |m|
    bundle = m.account.bundles.active.order(last_bundle_at: :desc).first
    {
      account_id:    m.account_id,
      dev_handle:    m.account.handle_or_fingerprint,
      bundle_slug:   bundle&.url_slug,
      failed_signal: m.failed_signal,
      failed_value:  extract_current_value(bundle, m.failed_signal),
      threshold:     threshold_for_signal(@posting, m.failed_signal)
    }
  }

  # NUNCA incluir: email_contact, phone_contact, email_recovery

**2. Componente React — dashboard/src/components/company/NearMissList.jsx**

  Para cada near_miss:
    dev_handle (link para /v/:bundle_slug)
    Falhou em: <signal label> (<failed_value> · exigido: <threshold>)
    Curva de evolução: renderizada pelo componente EvolutionCurve (PP19)
    Botão "Contatar" → fluxo PP10 com job_title preenchido
  
  Se vazia: "Nenhum dev próximo dos requisitos."

**3. Rota — backend/config/routes.rb**

  resources :positions, only: [...] do
    member do
      post :reactivate
      get  :near_misses   # adicionar
    end
  end

**4. Testes**

  backend/spec/requests/api/v1/company/position_near_misses_spec.rb
    - GET sem auth → 401
    - GET de posting de outra empresa → 403
    - GET retorna apenas match_type: near_miss
    - resposta contém failed_signal e valores corretos
    - resposta não contém email_contact nem phone_contact

  dashboard/src/components/company/NearMissList.test.jsx
    - renderiza failed_signal com valor e threshold
    - "Nenhum dev próximo" quando lista vazia
    - botão Contatar presente para cada item

### Critério de conclusão

cd backend && bundle exec rspec spec/requests/api/v1/company/position_near_misses_spec.rb → todos passando
cd dashboard && npx vitest run src/components/company/NearMissList.test.jsx → todos passando
GET /near_misses → apenas match_type near_miss, sem dados de contato do dev
```

---

## PP19 — Curva de evolução

```
Implemente o cálculo e visualização da curva de evolução por sinal.

### Contexto

A curva é calculada a partir dos bundles históricos do dev (tabela bundles existente).
Não requer nova tabela — usa bundle_data + published_at de cada bundle.
Exibida no near-miss list da tela de revisão de posting expirado.

### O que implementar

**1. Service — backend/app/services/evolution_curve_service.rb**

  class EvolutionCurveService
    WEIGHT_MAP = {
      1 => 0.40, 2 => 0.30, 3 => 0.20, 4 => 0.10
    }.freeze

    def initialize(account, signal)
      @account = account
      @signal  = signal
    end

    def call
      bundles = @account.bundles.active
                                .order(published_at: :asc)
                                .select(:bundle_data, :published_at)

      points = bundles.filter_map do |b|
        value = extract_signal(b.bundle_data, @signal)
        { value: value, date: b.published_at.to_date } if value
      end

      return { status: :building, points: points.count, current: points.last&.[](:value) } if points.size < 2

      delta  = points.last[:value] - points.first[:value]
      trend  = delta > 0 ? :up : delta < 0 ? :down : :stable
      period = (points.last[:date] - points.first[:date]).to_i

      {
        status:      :available,
        current:     points.last[:value],
        delta:       delta.round(1),
        trend:       trend,
        points:      points.count,
        period_days: period
      }
    end

    private

    def extract_signal(bundle_data, signal)
      payload = bundle_data.dig("payload") || bundle_data

      case signal
      when 'test_ratio'
        raw = payload.dig("l1", "avg_test_ratio")
        raw ? raw.to_f * 100.0 : nil   # 0.42 → 42.0

      when 'recency'
        # recency é derivado de bundle.last_bundle_at — não bundle_data
        # para a curva, usar published_at do próprio bundle (passado pelo caller)
        nil   # caller deve calcular dias_desde_bundle a partir de published_at

      # ecosystems é binário — curva não se aplica
      # languages não existe no bundle
      end
    end
  end

  Nota: curva de evolução se aplica apenas a test_ratio (numérico).
  Para ecosystems (binário) e recency (derivado de banco, não bundle_data),
  retornar { status: :not_applicable }.

**2. Endpoint — adicionar ao near_misses_controller**

  Incluir no response de near_misses:
    evolution: EvolutionCurveService.new(account, m.failed_signal).call

  Resposta completa por item:
    {
      account_id, dev_handle, bundle_slug,
      failed_signal, failed_value, threshold,
      evolution: {
        status:      "available" | "building" | "not_applicable",
        current:     25.3,
        delta:       3.1,
        trend:       "up" | "down" | "stable",
        points:      3,
        period_days: 42
      }
    }

**3. Componente React — dashboard/src/components/company/EvolutionCurve.jsx**

  Props: evolution (objeto do endpoint)

  Se status == "not_applicable":
    não renderiza nada

  Se status == "building":
    "em construção · <points> ponto(s)"

  Se status == "available":
    trend == "up"     → "↑ +<delta> em <period_days> dias"
    trend == "down"   → "↓ <delta> em <period_days> dias"
    trend == "stable" → "→ estável"

  Exemplos de output:
    ↑ +3.1% em 42 dias
    ↓ -1.2% em 30 dias
    → estável
    em construção · 1 ponto

**4. Testes**

  backend/spec/services/evolution_curve_service_spec.rb
    - dev com 1 bundle → status: building, points: 1
    - dev com 2+ bundles com test_ratio crescente → trend: up, delta positivo
    - dev com 2+ bundles com test_ratio decrescente → trend: down, delta negativo
    - dev com 2+ bundles com test_ratio igual → trend: stable, delta 0
    - signal ecosystems → status: not_applicable
    - signal recency → status: not_applicable
    - avg_test_ratio 0.42 no bundle_data → valor extraído como 42.0

  dashboard/src/components/company/EvolutionCurve.test.jsx
    - status building → "em construção · 1 ponto"
    - status available trend up → "↑ +3.1% em 42 dias"
    - status available trend down → "↓ -1.2% em 30 dias"
    - status not_applicable → renderiza null

### Critério de conclusão

cd backend && bundle exec rspec spec/services/evolution_curve_service_spec.rb → todos passando
cd dashboard && npx vitest run src/components/company/EvolutionCurve.test.jsx → todos passando
Dev com 1 bundle → building
Dev com 3 bundles com avg_test_ratio crescente → up com delta e period_days corretos
avg_test_ratio 0.42 no bundle_data → valor extraído como 42.0
Signal ecosystems → not_applicable
```

---

## PP20 — Ciclo de vida e revisão

```
Implemente notificação de expiração e tela de revisão do posting expirado.

### O que implementar

**1. Job — backend/app/jobs/expired_posting_notification_job.rb**

  perform(position_id):
    posting = Position.find(position_id)
    company = posting.company

    # Portal — o /company/dashboard já lista postings expirados
    # Email — se company.notification_email presente (reutilizar campo de Account ou adicionar a Company)
    if company.respond_to?(:notification_email) && company.notification_email.present?
      PositionMailer.expired(posting).deliver_later
    end

**2. Mailer — backend/app/mailers/position_mailer.rb**

  expired(posting):
    Para: posting.company.email
    Assunto: "Vaga expirada: #{posting.title}"
    Corpo (tom: testemunha, não alarmista):
      "A vaga '#{posting.title}' completou 30 dias.
       Acesse o beheld para revisar os candidatos e decidir se deseja reativar.
       beheld.dev/company/dashboard"

**3. Endpoint de revisão — adicionar ao positions_controller**

  GET /api/v1/company/positions/:id/review

  Apenas postings com status expired.
  Retorna matches + near_misses atualizados + opções disponíveis.

  {
    posting:    { id, title, status, expired_at },
    matches:    [...],   # mesmo formato do endpoint de matches
    near_misses: [...],  # com evolution_curve incluída
    options:    ["reactivate", "close"]
  }

**4. Componente React — dashboard/src/pages/company/PositionReview.jsx**

  Exibido quando posting.status == "expired".

  Seções:
    Título + data de expiração
    Lista ranqueada de matches (componente PositionMatches reutilizado)
    Near-miss list (componente NearMissList reutilizado, agora com curvas)
    Ações:
      Botão "Reativar vaga" → POST /reactivate
      Botão "Encerrar vaga" → DELETE /:id

**5. Badge de expiração no /company/dashboard**

  Postings expirados exibem badge "Expirada · revisar" com link para PositionReview.

**6. Testes**

  backend/spec/jobs/expired_posting_notification_job_spec.rb
    - enfileira mailer se company.email presente
    - não falha se company sem notification_email

  backend/spec/mailers/position_mailer_spec.rb
    - email enviado para company.email
    - assunto contém título do posting
    - corpo contém link beheld.dev/company/dashboard
    - corpo NÃO contém linguagem alarmista

  backend/spec/requests/api/v1/company/positions_spec.rb (adicionar)
    - GET /review de posting active → 422
    - GET /review de posting expired → 200 com matches e near_misses
    - POST /reactivate → status active, expires_at = now + 30 dias, MatchingJob enfileirado

  dashboard/src/pages/company/PositionReview.test.jsx
    - renderiza matches e near-misses
    - botão Reativar → POST correto
    - botão Encerrar → DELETE correto

### Critério de conclusão

cd backend && bundle exec rspec spec/jobs/expired_posting_notification_job_spec.rb → todos passando
cd backend && bundle exec rspec spec/mailers/position_mailer_spec.rb → todos passando
cd dashboard && npx vitest run src/pages/company/PositionReview.test.jsx → todos passando
Posting expirado → email enviado
GET /review de posting active → 422
POST /reactivate → expires_at atualizado, MatchingJob enfileirado
```

---

## PP21 — Dev: contagem anônima de interesse

```
Implemente a contagem semanal anônima de interesse no dashboard do dev.

### Contexto

O dev não vê vagas, empresas, scores ou requisitos.
Vê apenas: "N empresas têm necessidades que correspondem ao seu perfil esta semana."
Baseado apenas em matches confirmados (match_type: match) — não near_miss.
Atualizado semanalmente.

### O que implementar

**1. Endpoint — backend/app/controllers/api/v1/dev/interest_count_controller.rb**

  GET /api/v1/dev/interest_count

  Requer DevAuthenticated.

  # Postings ativos que têm o dev como match confirmado nesta semana
  count = PositionMatch
            .joins(:position)
            .where(
              account_id: current_account.id,
              match_type: 'match',
              positions: { status: 'active' }
            )
            .where('position_matches.calculated_at >= ?', 1.week.ago)
            .count

  render json: { count: count }

  # NUNCA incluir: company names, job titles, scores, thresholds

**2. Componente React — exibir no dashboard do dev**

  Adicionar ao componente existente de dashboard do dev (PP4):

  Se count > 0:
    "<count> empresa(s) têm necessidades que correspondem ao seu perfil esta semana."

  Se count == 0:
    não exibir — sem mensagem de "nenhuma empresa".

  Regras de copy:
    - Nunca mencionar nome de empresa
    - Nunca mencionar score
    - Nunca mencionar vaga ou requisitos
    - Texto exatamente: "N empresa(s) têm necessidades que correspondem ao seu perfil esta semana."

**3. Rota — backend/config/routes.rb**

  namespace :api do
    namespace :v1 do
      namespace :dev do
        get 'interest_count', to: 'interest_count#show'
      end
    end
  end

**4. Testes**

  backend/spec/requests/api/v1/dev/interest_count_spec.rb
    - GET sem auth dev → 401
    - GET com auth dev sem matches → { count: 0 }
    - GET com auth dev com matches ativos nesta semana → count correto
    - GET com matches de postings expired → não contabilizados
    - GET com matches near_miss → não contabilizados
    - resposta não contém company_name, job_title, score, threshold

  dashboard/src/components/dev/InterestCount.test.jsx
    - count 0 → renderiza null
    - count 1 → "1 empresa tem necessidades que correspondem ao seu perfil esta semana."
    - count 3 → "3 empresas têm necessidades que correspondem ao seu perfil esta semana."

### Critério de conclusão

cd backend && bundle exec rspec spec/requests/api/v1/dev/interest_count_spec.rb → todos passando
cd dashboard && npx vitest run src/components/dev/InterestCount.test.jsx → todos passando
GET com near_miss matches → count não incrementado
GET com posting expired → count não incrementado
Resposta sem nenhum dado identificável da empresa ou vaga
Count 0 → componente não renderiza
```

---

## PP22 — Incentivo de atualização (5 dias)

```
Implemente o nudge de atualização de bundle — terminal e dashboard do dev.

### Contexto

Cadência de 5 dias incentiva o dev a enriquecer a curva de evolução.
Não é penalidade. Não afeta o badge público (threshold continua sendo 30 dias).
O nudge é exibido uma vez por sessão de terminal.

### O que implementar

**1. CLI — packages/cli/src/lib/nudge.ts**

  export function shouldNudge(): boolean {
    const config = readConfig()   // lê ~/.beheld/config.json
    const lastBundle = config.last_bundle_at
    if (!lastBundle) return false

    const daysSince = daysBetween(new Date(lastBundle), new Date())
    const nudgedToday = config.nudge_shown_at === today()

    return daysSince >= 5 && !nudgedToday
  }

  export function showNudge(): void {
    console.log("")
    console.log("→ Seu bundle tem " + daysSince + " dias.")
    console.log("  Atualize para enriquecer sua curva de evolução: beheld profile generate")
    console.log("")

    saveConfig({ nudge_shown_at: today() })
  }

  Chamar shouldNudge() + showNudge() no início de qualquer comando beheld.
  Exibido uma vez por dia — nudge_shown_at persiste em config.json.

**2. Endpoint — backend/app/controllers/api/v1/dev/bundle_health_controller.rb**

  GET /api/v1/dev/bundle_health

  Requer DevAuthenticated.

  bundle = current_account.bundles.active.order(last_bundle_at: :desc).first

  return render json: { status: :no_bundle } unless bundle

  days_since = ((Time.current - bundle.last_bundle_at) / 86400).floor
  points     = current_account.bundles.active.count  render json: {
    days_since:   days_since,
    points:       points,
    needs_nudge:  days_since >= 5,
    curve_status: points >= 2 ? 'available' : 'building'
  }

**3. Componente React — dashboard/src/components/dev/BundleHealth.jsx**

  Exibido no dashboard do dev abaixo das estatísticas principais.

  Se needs_nudge == false: não exibir

  Se needs_nudge == true:
    Indicador visual de riqueza da curva:

    Se curve_status == 'available':
      "Curva de evolução · <points> pontos · última atualização há <days_since> dias"
      Link: "beheld profile generate"

    Se curve_status == 'building':
      "Curva em construção · <points> ponto(s) · última atualização há <days_since> dias"
      Link: "beheld profile generate"

    Copy nunca usa linguagem de penalidade ou urgência artificial.

**4. Testes**

  packages/cli/tests/nudge.test.ts
    - bundle com 4 dias → shouldNudge false
    - bundle com 5 dias → shouldNudge true
    - bundle com 5 dias + nudge_shown_at hoje → shouldNudge false
    - bundle com 5 dias + nudge_shown_at ontem → shouldNudge true
    - showNudge salva nudge_shown_at em config

  backend/spec/requests/api/v1/dev/bundle_health_spec.rb
    - GET sem auth → 401
    - sem bundle → { status: no_bundle }
    - bundle com 4 dias → needs_nudge: false
    - bundle com 5 dias → needs_nudge: true
    - 1 bundle → curve_status: building
    - 2+ bundles → curve_status: available

  dashboard/src/components/dev/BundleHealth.test.jsx
    - needs_nudge false → renderiza null
    - needs_nudge true + building → "Curva em construção"
    - needs_nudge true + available → "Curva de evolução · N pontos"

### Critério de conclusão

cd backend && bundle exec rspec spec/requests/api/v1/dev/bundle_health_spec.rb → todos passando
bun test packages/cli/tests/nudge.test.ts → todos passando
cd dashboard && npx vitest run src/components/dev/BundleHealth.test.jsx → todos passando

beheld com bundle de 5 dias → exibe nudge no terminal
beheld com bundle de 5 dias + já exibido hoje → não exibe
dashboard com needs_nudge false → BundleHealth não renderiza
Corpo do nudge não contém linguagem de penalidade
```

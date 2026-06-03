# Beheld — Resiliência do engine: o que vem depois do arco D0→Camada 2

> Última atualização: 2026-05-31
> Escopo: o que ficou de fora do arco recente de auto-heal do engine, em ordem de prioridade. Documento de planejamento — nenhum item está agendado, todos estão **abertos para decisão**.

---

## 0. Contexto — o que já existe

O arco recente fechou três frentes de **diagnóstico e recuperação** do busy-loop do engine, motivado por um incidente real que durou 6 dias e 16 horas sem detecção.

| Camada | Commit | Responsabilidade |
|---|---|---|
| D0 | `c1b0830` | Diagnóstico correto: `doctor` distingue offline de busy-loop; resolve PID pelo listener, não pelo `daemon.pid` |
| D1.a | `f432a90` | Quatro probes de processamento (cursor / db.write / db.wal / backlog) lendo do disco, independentes do engine vivo |
| D1.b | `0112afa` | Probes de infra: estado do LaunchAgent/systemd + 6 assinaturas conhecidas no `daemon.log` |
| D2 | `f5e4eb5` | Auto-heal interativo no `doctor`: kill-by-port + WAL checkpoint + restart, sob gate de 4 condições coincidentes |
| Camada 2 | `31e8d71` | Supervisor faz pre-bind cleanup automático + backoff de 3 falhas em 5 min com saída manual |

Os 6 dias do incidente agora têm cobertura em três tempos: o supervisor evita reincidência via pre-bind cleanup; o doctor diagnostica e cura sob demanda; o catálogo de assinaturas torna o estado oculto visível em menos de 100 ms.

**O que ainda falta**: tudo que está descrito aqui ataca o problema **antes de o busy-loop existir**, em vez de só recuperar dele. Em outras palavras: o arco fechado é "como sair do incidente"; este documento é "como impedir que ele aconteça".

---

## 1. Camada 3 — watchdog e quarentena dentro do engine Python

> Prioridade: **alta**. Sem isso, o produto continua dependente de detecção externa para recuperar de payloads patológicos.

### 1.1 Por que Camada 3 é diferente das anteriores

D0–D2 e Camada 2 atuam **fora** do engine: TypeScript no `doctor` e no supervisor. O engine Python, do lado de dentro, não sabe que está em busy-loop — está só executando o extrator ou commitando o WAL, como sempre.

Camada 3 muda isso. O engine ganha consciência do próprio tempo de execução por sessão e a capacidade de se auto-encerrar antes de virar zumbi. O lado de fora deixa de ser a única linha de defesa.

### 1.2 Sintomas que motivam

Dois sintomas confirmados no incidente:

- **`profile.db-wal` cresceu para ~836 KB** sem checkpoint nos 6 dias. Indica que o reader avançou em transações mas nunca completou o ciclo de commit/checkpoint, ou que o checkpoint ficou bloqueado num lock que nunca soltou.
- **`tool_sequence_json` foi alvo de um fix anterior** (commit `150519c`, "cap tool_sequence_json growth + auto-heal bloated DBs") — sinal de que o extrator já tinha histórico de crescimento patológico. O loop atual provavelmente é em algum extrator novo (stack F6.12a é candidato natural, dado que foi adicionado pouco antes do incidente).
- **Sessão `2026-05-28_b5e9c60b-…` tem 1,8 MB de JSONL**. Uma única sessão grande é candidata óbvia para o gatilho determinístico.

### 1.3 O que Camada 3 instala

#### 1.3.1 Yield checkpoints no loop de extração

Cada extrator processa eventos em loop. Hoje o loop é monolítico: ou processa tudo, ou trava. Camada 3 adiciona pontos de yield onde o engine:

1. Verifica se passou de um timeout duro por sessão (proposta: 30 segundos para extração + score de uma sessão).
2. Se passou, registra a sessão como suspeita num arquivo de quarentena (`~/.beheld/quarantine.json`), avança o cursor para o fim daquela sessão (sem ingerir), e segue para a próxima.

O efeito é: payload patológico para de bloquear o processamento das sessões posteriores. O backlog deixa de crescer indefinidamente, e o engine continua útil mesmo na presença de uma sessão tóxica.

#### 1.3.2 Quarentena no disco

```json
// ~/.beheld/quarantine.json
{
  "sessions": {
    "2026-05-28_b5e9c60b-….jsonl": {
      "first_seen_at": 1717012345000,
      "failures": 3,
      "last_extractor": "stack",
      "last_error": "timeout after 30s during pattern matching"
    }
  }
}
```

Após N falhas (proposta: 3), a sessão é marcada como **permanentemente excluída** do processamento. O `doctor` ganha uma probe nova `quarentena` que reporta sessões em quarentena — se o número crescer, é sinal de bug sistêmico no extrator, não de payload isolado.

#### 1.3.3 WAL checkpoint periódico (não só on-stop)

O incidente teve `profile.db-wal` em 836 KB porque o checkpoint só roda em momentos específicos do ciclo do engine. Camada 3 adiciona um job APScheduler que dispara `PRAGMA wal_checkpoint(PASSIVE)` a cada 5 minutos, independente do estado do reader. Falhas com SQLITE_BUSY são silenciadas (próxima rodada tenta de novo).

### 1.4 Conexão com Camada 2

Se Camada 3 funcionar bem, **a Camada 2 raramente dispara**. O supervisor fica como rede de segurança. Se a Camada 2 disparar com Camada 3 em produção, é sinal de que o watchdog do engine não foi suficiente — investigar antes de só limpar o backoff.

### 1.5 Critérios para considerar Camada 3 "pronta"

- Sessão sintética com loop infinito num extrator é detectada em ≤ 30s e a sessão seguinte é processada normalmente.
- `profile.db-wal` em produção fica abaixo de 256 KB em uso típico de 1 hora.
- Probe nova `quarentena` no `doctor` reporta lista de sessões e severity `warn` se houver alguma.
- Zero regressão em throughput de processamento medido em sessões normais (proposta: benchmark de 50 sessões reais, comparar antes/depois).

---

## 2. Os "fails ambientais" em `cli.test.ts` que apareceram pós-heal

> Prioridade: **média**. Não bloqueia ninguém, mas a suite ficar amarelada confunde quem chega novo.

Durante a validação do D2 ao vivo, dois testes em `cli.test.ts` passaram a falhar:

- `EngineStatus interface > engineStatus() returns null when engine is offline`
- `viewCommand orphan detection > view --refresh prints 'já está atualizado' when engine is offline`

A causa não é regressão do código: é premissa ambiental. Ambos assumem "engine offline durante testes". Quando rodei o D2 e o auto-heal subiu o engine real, esses testes passaram a ver um engine **vivo** — e o assert quebrou.

### 2.1 Possibilidades para resolver

| Abordagem | Esforço | Cuidado |
|---|---|---|
| Apontar `BEHELD_ENGINE_URL` para porta fechada nos testes | baixo | Já existe override; basta usar no `beforeEach` desses testes |
| Spawn de um engine fake em porta efêmera com `/health` configurável | médio | Mais robusto, permite testar o caminho online também |
| Marcar como `skip()` quando engine local responde | baixo | Solução covarde — perde cobertura em CI |

Recomendação: a primeira. Os testes existem para validar o comportamento do CLI **quando o engine não responde**, não para validar que o engine está down. Forçar `BEHELD_ENGINE_URL=http://127.0.0.1:1` (porta fechada garantida) torna o teste idempotente.

---

## 3. Cron periódico do `doctor`

> Prioridade: **média**. Camada 3 pode resolver a causa raiz, mas isso resolve a cauda longa de "estados estranhos que ninguém detectou".

Hoje o `doctor` só roda quando o usuário pede. Em produção, isso significa que a janela entre o início do problema e a detecção depende inteiramente do usuário se lembrar.

Proposta: um job no LaunchAgent / systemd separado que roda `beheld doctor --quiet` a cada hora. Se o exit code for 2 (crítico), notifica via `osascript` / `notify-send`, com a mesma rate-limit de 1/dia que já existe no daemon.

### 3.1 Por que não está no escopo dos arcos anteriores

O `doctor` é interativo — usa cores, hints longos, formato pensado pra ler na hora. Um cron precisaria de um modo `--quiet` que só emita o JSON estruturado (severity por probe, exit code), e o notificador precisa de uma camada de deduplicação ("já te avisei desse mesmo problema há 2 horas").

### 3.2 Conexão com Camada 2

Se Camada 3 + Camada 2 funcionarem, o cron diário do `doctor` vira "tudo verde 24 vezes ao dia", sem ruído. Aí o valor dele aparece exatamente nos casos raros que escaparam — os "unknown unknowns".

---

## 4. Telemetria opt-in dos heals disparados

> Prioridade: **baixa**, mas útil pra entender se Camada 2/3 estão sendo realmente exercitadas.

Cada heal do D2 e cada falha registrada pela Camada 2 são eventos privados, gravados em disco do usuário. Não há visibilidade agregada.

Proposta: um endpoint opt-in que recebe um payload anonimizado:

```json
{
  "event": "auto_heal_triggered",
  "platform": "darwin",
  "engine_version": "0.1.1",
  "evidence": {
    "stat": "R+",
    "cpu_pct_bucket": "500-1000",
    "etime_bucket": ">7d"
  },
  "outcome": "succeeded"
}
```

Zero identificação do usuário, zero hash de caminho, zero conteúdo de sessão. Bucket de CPU e etime preserva privacidade (não é o valor exato), mas dá sinal de gravidade.

### 4.1 Por que isso é diferente do AI insights existente

O insights endpoint atual envia scores e padrões. Telemetria de heal só envia eventos operacionais — não tem conexão com perfil técnico do usuário. Vale considerar canal separado para deixar a invariante "scores e insights são opt-in" intacta enquanto o canal de telemetria operacional pode ter default diferente (a discussão é aberta).

### 4.2 Conexão com Camada 3

Se Camada 3 entrar e telemetria de heal mostrar zero eventos por 30 dias, é confirmação empírica de que o problema foi atacado na raiz. Se continuar disparando, sabe-se em que plataforma e qual extrator está envolvido (pelo `last_extractor` na quarentena).

---

## 5. Comando `beheld heal-engine` standalone

> Prioridade: **baixa**. Conveniência, não correção.

Hoje, o usuário aciona o auto-heal **indiretamente** rodando `beheld doctor`. Se as 4 condições do gate estão presentes, o heal dispara. Se não, não.

Proposta: comando explícito `beheld heal-engine` que pula o `doctor` inteiro e roda só o heal. Útil para suporte ("rode isso, me mande o resultado") e para scripts.

### 5.1 Cuidados

- Deve sempre respeitar o gate de 4 condições — exceto se passado `--force`, e nesse caso aparece um disclaimer claro de que pode estar matando um processo legítimo.
- O `force` precisa de confirmação interativa (`--yes` para scripts) e gravar a decisão no `~/.beheld/diagnostics/forced-heals.log`.
- Reusa todo o `heal-engine.ts` existente — zero código novo de lógica, só wiring de CLI.

---

## 6. Pre-bind cleanup do MCP server também

> Prioridade: **baixa**, mas conceitualmente óbvio.

Camada 2 fez pre-bind cleanup só do engine (porta 7338). O MCP server (porta 7337) tem o mesmo risco teórico — se ficar zumbi por algum motivo, próximo `bind(7337)` vai falhar com Errno 48.

Hoje não temos evidência de busy-loop no MCP server (é Bun, não Python; surface menor; sem extrator pesado). Mas a simetria é grátis: extrair `preBindCleanup(port)` genérico e aplicar nos dois lados.

### 6.1 Por que não foi no escopo da Camada 2

A Camada 2 foi escrita reagindo ao incidente real. O MCP nunca travou. Adicionar para o MCP teria sido especulação. Agora que a infra existe (`util/ports.ts` tem `pidListeningOn` e `engineHealthy` genéricos por porta), o custo é mínimo.

---

## 7. Stack capture mais robusto

> Prioridade: **muito baixa**. O heal funcionou sem o stack no incidente real; é informação extra pro post-mortem.

No D2, o `captureStack` falhou silenciosamente: o `sample` do macOS não conseguiu amostrar o engine PID 70859 (provavelmente questão de permissão Apple para amostrar processo fora do mesmo grupo).

### 7.1 Caminhos possíveis

- **Pedir permissão na primeira execução**: pop-up explicando que `sample` precisa de Developer Tools. Atrito grande pra UX.
- **Trocar por `lldb`**: também tem fricção, pode pedir permissão de "Developer Tools".
- **Empacotar `py-spy` como dependência opcional**: funciona pra Python, mas o engine é um PyInstaller bundle — `py-spy` pode não conseguir atachar.
- **Stack endpoint no próprio engine**: o engine expõe `/debug/stack` que retorna o stack de todas as threads como JSON. Quando estiver em busy-loop, o endpoint provavelmente também trava — mas se a thread responsável pelo HTTP estiver separada da que está em loop, funciona.

A última é a mais promissora e conecta com Camada 3 (já vamos estar adicionando observabilidade interna no engine de qualquer jeito).

---

## 8. Resumo executivo — em que ordem atacar

1. **Camada 3** — ataca a causa raiz, reduz frequência dos demais sintomas, libera espaço para o resto ficar baixa prioridade.
2. **Cron periódico do `doctor`** — ganha visibilidade contínua para casos que Camada 3 não cubrir.
3. **Fails ambientais em `cli.test.ts`** — limpeza pra a suite voltar a ser fonte de verdade clara.
4. **Telemetria opt-in dos heals** — só vale a pena se Camada 3 já estiver lá; antes disso é cedo demais pra interpretar os números.
5. **Pre-bind cleanup do MCP** — barato, simétrico, sem urgência.
6. **`beheld heal-engine` standalone** — UX, sem impacto técnico.
7. **Stack capture robusto** — só quando o resto estiver estável e for valioso pra post-mortem.

Cada item está aberto para revisão antes de virar prompt de execução. Este documento não compromete ninguém; serve para a próxima sessão começar com o contexto pronto.

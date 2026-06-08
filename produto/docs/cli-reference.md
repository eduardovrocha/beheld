# Beheld — Referência do CLI

> Fonte: `packages/cli/src/` (commit `d7badd8` · 2026-06-06)
> Documento gerado por varredura do código-fonte. O código é autoritativo — specs ficam atrás dele quando divergem.
> Versão do binário declarada no entrypoint: `0.4.1` (`packages/cli/src/index.ts:5`). O comando `init` e o `update` ainda referenciam internamente `0.3.2` como string de versão (ver "Perguntas em aberto").

## Sumário

| Comando | O que faz | Efeito | Pré-condição |
|---|---|---|---|
| `beheld` (sem argumento) | Mostra ajuda ou dispara `bootstrap` na primeira vez | escreve em `~/.beheld/` se for primeira vez | nenhuma |
| `beheld bootstrap` | Migra `~/.devprofile/` → `~/.beheld/` e aponta os próximos passos | escreve em `~/.beheld/` | nenhuma |
| `beheld init` | Roda o wizard de instalação: hooks, MCP, daemons, autostart, L1 | escreve em `~/.beheld/`, `~/.claude/`, `~/.continue/`, registra LaunchAgent/systemd | nenhuma |
| `beheld harness list` | Lista todo harness conhecido com fidelidade e estado de detecção | read-only | nenhuma |
| `beheld harness install` | Instala hooks/tails para harnesses detectados | escreve em arquivos de hook do harness | harness detectado (ou `--force`) |
| `beheld start` | Sobe MCP server (7337) e Scoring engine (7338) | inicia processos, escreve PID e log | nenhuma |
| `beheld stop` | Encerra os daemons | SIGTERM → SIGKILL fallback | nenhuma |
| `beheld restart` | Stop + start, validando `/health` | reinicia processos | nenhuma |
| `beheld status` | Mostra estado dos daemons e sessão corrente | read-only | nenhuma |
| `beheld doctor` | Diagnóstico exaustivo com auto-heal de busy-loop | read-only (com exceção: pode chamar self-heal do engine) | nenhuma |
| `beheld self-heal` | Restaura silenciosamente `/beheld` e MCP server no Claude Code | escreve em `~/.claude/commands/` e `~/.claude.json` | opt-in Claude Code em `~/.beheld/config.json` |
| `beheld view` | Renderiza o perfil técnico atual | read-only (pode disparar processamento com `--refresh`) | engine no ar OU cache disponível |
| `beheld import` | Importa repositórios para o L1 (git history) | rede + escreve no engine | engine no ar |
| `beheld attest` | Vincula sua pubkey Ed25519 à identidade do GitHub | rede + escreve `~/.beheld/attestation.json` | chaves geradas (gera se faltar) |
| `beheld identity link` | Alias de `beheld attest` | idem `attest` | idem `attest` |
| `beheld identity status` | Mostra a identidade GitHub atualmente vinculada | read-only | nenhuma |
| `beheld keys show` | Mostra a public key (Ed25519, JWK) | read-only | chave existente |
| `beheld keys import` | Importa par Ed25519 existente | escreve em `~/.beheld/keys/` | nenhuma chave atual |
| `beheld keys rotate` | Gera novo par, arquiva o atual | escreve em `~/.beheld/keys/` | chave existente |
| `beheld snapshot` | Gera bundle `.beheld` assinado | escreve em `~/.beheld/snapshots/` + `~/Desktop/`, rede para Rekor | engine no ar, dados suficientes |
| `beheld snapshot list` | Lista snapshots registrados no engine | read-only | engine no ar |
| `beheld share` | Publica o bundle mais recente no portal | rede + escreve `last_published_slug` | bundle local existe |
| `beheld verify <file>` | Verifica schema, hash, assinatura, chain e Rekor | read-only (rede com `--verify-rekor`) | nenhuma |
| `beheld auth` | Autentica no portal por challenge-response e abre dashboard | rede + abre navegador | chave existente |
| `beheld update` | Baixa e substitui o binário | rede + sobrescreve `process.execPath`, reinicia daemon | nenhuma |
| `beheld delete --local` | **Destrutivo** — apaga `~/.beheld/` | destrutivo local | exige digitar "apagar tudo" |
| `beheld delete --remote` | **Destrutivo** — revoga attestation no servidor | destrutivo remoto | exige digitar "revogar" |
| `beheld delete --all` | **Destrutivo** — local + remoto + hooks + resíduos `devprofile` | destrutivo total | exige digitar "apagar tudo" |
| `beheld migrate-legacy` | Remove registros MCP project-scoped (migra para global) | escreve em `~/.claude.json` | nenhuma |
| `beheld server` | Inicia o MCP server (uso interno) | inicia HTTP em 7337 ou stdio | nenhuma |

## Flags globais

| Flag | Efeito |
|---|---|
| `-v, --version` | Imprime `0.4.1` e sai com código 0. Definido em `packages/cli/src/index.ts:12`. |
| `-h, --help` | Imprime a lista de comandos e sai com código 0. Funciona em qualquer nível de subcomando. |

Hook silencioso de **nudge de bundle** (`maybeShowBundleNudge`) roda em `preAction` antes de qualquer comando: se o bundle local mais recente tem 5+ dias e o TTY suporta, imprime uma linha sugerindo `beheld snapshot`. Falha do nudge nunca quebra o comando (`try/catch` em `packages/cli/src/index.ts:18`).

## Comandos

### `beheld` (sem subcomando)

**Assinatura:** `beheld`
**Efeito:** read-only OU escreve em `~/.beheld/` (na primeira vez).
**Pré-condições:** nenhuma.

**Descrição.** Quando invocado sem subcomando, decide entre rodar `bootstrap` (primeiro contato — não há chaves em `~/.beheld/keys/`) ou imprimir o help padrão do commander (instalação já existente). A função `defaultDispatch` em `packages/cli/src/index.ts:358` faz o gate via `keysExist()`.

**Execução.**
1. Verifica se há par Ed25519 em `~/.beheld/keys/`.
2. Se houver → `program.outputHelp()`.
3. Se não → chama `bootstrapCommand({})`.
4. Subcomando desconhecido (ex.: `beheld bogus`) é tratado em `packages/cli/src/index.ts:382` com `error: unknown command 'bogus'` em stderr e exit 1.

**Resultado esperado (caminho help).** Idêntico a `beheld --help`.

**Resultado esperado (caminho bootstrap).** Ver `beheld bootstrap` abaixo.

**Exit codes.** `0` em help e bootstrap bem-sucedido · `1` para subcomando desconhecido.

**Notas.** O nudge `maybeShowBundleNudge` roda antes do dispatch.

---

### `beheld bootstrap`

**Assinatura:** `beheld bootstrap [--import]`
**Efeito:** escreve em `~/.beheld/`. Idempotente.
**Pré-condições:** nenhuma.

**Descrição.** Onboarding L1-first: faz a ponte (cópia, nunca move) de `~/.devprofile/` para `~/.beheld/`, garante o diretório com mode 0700, e aponta os próximos passos. Com `--import` entra direto no wizard de import.

**Flags**

| Flag | Default | Efeito |
|---|---|---|
| `--import` | false | Após a ponte, dispara `runImport({})` imediatamente. |

**Execução.**
1. Header `beheld bootstrap`.
2. `bridgeLegacyDevprofile()` em `packages/cli/src/lib/legacy-bridge.ts`. Casos reportados: `no_legacy_dir` (silencioso), `empty_legacy`, `copied`, `already_migrated`, `target_non_empty`, `partial_failure`.
3. `mkdirSync(~/.beheld, mode: 0o700)` se não existir.
4. `ensureSecurePermissions(target)` reforça 0700.
5. Imprime "Next steps" com os próximos comandos OU dispara `runImport`.

**Resultado esperado (caso típico, sem legacy).**

```
  ▎ beheld  bootstrap

  ✓  ~/.beheld ready (mode 0700)

Next steps
    →  beheld import        — import git history (L1)
    →  beheld init          — wire Claude Code + Continue.dev hooks
    →  beheld view          — see your profile

  Tip: rerun with --import to enter the L1 wizard now.
```

**Resultado esperado (com legacy copiado).**

```
  ▎ beheld  bootstrap

  ✓  copied <N> item(s) from ~/.devprofile → ~/.beheld
    Original ~/.devprofile preserved + MIGRATED_TO_BEHELD.md marker written.
  ✓  ~/.beheld ready (mode 0700)
(...)
```

**Exit codes.** `0` em sucesso. A função retorna o `BootstrapResult` para testes; o binário não propaga código diferente daquele do `runImport` quando `--import`.

**Notas.** A bridge é cópia, não move — o `~/.devprofile/` é preservado com um marker `MIGRATED_TO_BEHELD.md` dentro. Ver `packages/cli/src/commands/bootstrap.ts:76-103`.

---

### `beheld init`

**Assinatura:** `beheld init [--force] [--lang <en|pt-br>]`
**Efeito:** escreve em `~/.beheld/config.json`, `~/.beheld/keys/`, registra hooks em `~/.claude/`, MCP em `~/.continue/`, instala LaunchAgent (macOS) ou systemd unit (Linux), pode subir os daemons.
**Pré-condições:** nenhuma. Se já há `config.json` e não tem `--force`, pergunta antes.

**Descrição.** Wizard interativo que conecta o Beheld aos harnesses suportados e prepara o estado local. Gera chaves Ed25519 na primeira execução (silencioso se já existirem).

**Flags**

| Flag | Default | Efeito |
|---|---|---|
| `--force` | false | Pula o prompt "Reinicializar?" e roda todos os passos. |
| `--lang <en\|pt-br>` | `en` | Idioma da tela do wizard. Valores inválidos caem em `en`. |

**Execução.**
1. `ensureSecurePermissions()` no diretório.
2. `ensureKeysSilent()` gera par Ed25519 se não houver.
3. Lê `~/.beheld/config.json`. Se existir e sem `--force`, pergunta `Beheld já está configurado. Reinicializar? [s/N]`. Resposta diferente de `s` → imprime `Abortado.` e retorna.
4. Chama `runWizard()` com callbacks para: migrar registros MCP project-scoped, instalar hooks do Claude Code + MCP + slash command, instalar MCP do Continue.dev, extrair o engine PyInstaller, subir daemons (`daemonManager.start`), instalar autostart, e disparar `runImport` opcional.
5. Persiste o resultado em `~/.beheld/config.json` com `version`, `initialized_at`, `dimensions`, `environments` e — se coletado — `author_email`.

**Resultado esperado.** A UI exata é renderizada pelo `runWizard` em `packages/cli/src/ui/wizard.ts` (escopo R6.x), variável por idioma. As mensagens dos callbacks internos incluem:

```
Daemons já em execução
Daemons iniciados
Falha parcial — MCP:<bool> Engine:<bool>
```

**Exit codes.** `0` em sucesso ou cancelamento via `Abortado.`. Falhas internas do wizard propagam o exit do callback.

**Notas.** O `init` registra hooks **globais** (`~/.claude.json`), não project-scoped — `migrateProjectScopedRegistrations` limpa registros antigos primeiro. O autostart usa LaunchAgent (`com.beheld.daemon`) ou systemd user unit (`beheld.service`).

---

### `beheld harness list`

**Assinatura:** `beheld harness list`
**Efeito:** read-only.
**Pré-condições:** nenhuma.

**Descrição.** Mostra cada adapter de harness registrado, sua `capture_fidelity` (`native_hook`, `editor_extension`, `inferred`, `local_log_tail`, `statusline`), o trust tier derivado (`high` / `med` / `low`), se está **detectado** neste host e o estado do tail (`ON`/`off`) quando aplicável.

**Execução.**
1. `buildHarnessRegistry()` enumera todos os adapters.
2. `enabledTails()` retorna os tails atualmente ligados.
3. Imprime cabeçalho + uma linha por adapter.

**Resultado esperado.**

```
  ▎ beheld  harness

  name              fidelity (trust tier)        detection        tail state
  ──────────────────────────────────────────────────────────────────────────
  <adapter-name>    <fidelity> (<tier>)          ✓ detected       tail: ON
  <adapter-name>    <fidelity> (<tier>)          · not detected   —

  <N>/<M> detected · <K> tails enabled
```

**Exit codes.** `0`.

**Notas.** O comando não spawna binários nem lê conteúdo de sessão — só inspeciona paths.

---

### `beheld harness install [names...]`

**Assinatura:** `beheld harness install [names...] [--force]`
**Efeito:** escreve nos arquivos de hook/config do harness. Idempotente.
**Pré-condições:** harness detectado, salvo com `--force`.

**Descrição.** Instala hooks ou habilita tails para os harnesses detectados. Sem nomes posicionais, opera em todos os adapters detectados. Com nomes, restringe a esses.

**Argumentos**

| Arg | Obrigatório | Formato | Descrição |
|---|---|---|---|
| `names...` | não | lista separada por espaços | Filtro por nome de adapter. |

**Flags**

| Flag | Default | Efeito |
|---|---|---|
| `--force` | false | Instala mesmo se o adapter não está detectado neste host. |

**Resultado esperado.**

```
  ▎ beheld  harness install

  · <adapter>          (not detected — skipping; use --force to install anyway)
  ✓  <adapter>          installed
  · <adapter>          already installed
  !  <adapter>          manual setup required
    <nota do adapter>

  Tip: rerun `beheld harness list` to see the updated state.
```

**Exit codes.** `0`. Erros por adapter são reportados na linha — o comando segue.

---

### `beheld start`

**Assinatura:** `beheld start`
**Efeito:** inicia processos, escreve em `~/.beheld/daemon.pid` e `~/.beheld/daemon.log`.
**Pré-condições:** nenhuma.

**Descrição.** Sobe MCP server (porta 7337) e Scoring engine (porta 7338). Se já estão no ar, imprime estado verde e retorna sem religar.

**Execução.**
1. `clearBackoffStateOnUserStart()` — limpa flag de backoff do supervisor (Camada 2).
2. `healIntegration()` — re-aplica slash command + MCP no Claude Code se sumiram.
3. Pre-check via `Promise.all([isMcpRunning(), isEngineRunning()])`.
4. Se ambos no ar: imprime e retorna.
5. Caso contrário: imprime hint sobre cold start do engine (15-30s) e chama `daemonManager.start()`.
6. Verifica resultado; se algum falhou, sai com 1.

**Resultado esperado (já no ar).**

```
  ▎ beheld  já estou no ar

  MCP server      ●  porta 7337
  Scoring engine  ●  porta 7338
```

**Resultado esperado (subindo do zero).**

```
  ▎ beheld  subindo os daemons

  Engine pode levar 15-30s no primeiro start…

  ✓  MCP server iniciado    porta 7337
  ✓  Engine iniciado        porta 7338
```

**Resultado esperado (self-heal disparado).** Linha extra antes do resultado:

```
  Restaurado: comando /beheld + registro MCP (reinicie o Claude Code para usar)
```

**Exit codes.** `0` em sucesso. `1` se MCP ou engine falharem ao iniciar.

**Notas.** O engine na primeira execução extrai o PyInstaller bundle para `~/.beheld/bin/engine` — daí o cold start de até 30s.

---

### `beheld stop`

**Assinatura:** `beheld stop`
**Efeito:** SIGTERM nos daemons, com fallback SIGKILL após 5s (`daemonManager.stop`).
**Pré-condições:** nenhuma. No-op silencioso se nada está rodando.

**Descrição.** Encerra os daemons.

**Resultado esperado (nada rodando).**

```
  ▎ beheld  nada pra parar

  Beheld não está em execução.
```

**Resultado esperado (rodando).**

```
  ▎ beheld  encerrando o expediente

  Parando Beheld…
  ✓  Beheld parado
```

**Exit codes.** `0`.

---

### `beheld restart`

**Assinatura:** `beheld restart`
**Efeito:** stop + start, com verificação final de `/health` em ambos os daemons.
**Pré-condições:** nenhuma.

**Descrição.** Reinício gracioso. Mesmo se não estava rodando, executa o start. Após start, faz um check final em `/health` antes de declarar sucesso.

**Resultado esperado (sucesso).**

```
  ▎ beheld  começando do zero

  Parando Beheld…
  ✓  Beheld parado     (graceful, fallback kill -9 se necessário)
  ✓  MCP server respondendo em /health     porta 7337
  ✓  Engine respondendo em /health         porta 7338

  Beheld reiniciado com sucesso.
```

**Resultado esperado (falha).**

```
  ✗  MCP server falhou ao iniciar      (ou Engine, conforme o caso)

  Diagnóstico: beheld doctor
```

**Exit codes.** `0` em sucesso, `1` se start falhou ou `/health` não respondeu.

---

### `beheld status`

**Assinatura:** `beheld status`
**Efeito:** read-only.
**Pré-condições:** nenhuma. Daemons offline geram apenas estado `stopped`.

**Descrição.** Estado dos daemons, sessão corrente e coleta do dia.

**Execução.**
1. Em paralelo: `mcpHealth()`, `engineHealth()`, `mcpStatus()`, `mcpSessionCurrent()`.
2. Lê `~/.beheld/daemon.pid` para enriquecer com PID por daemon.
3. Renderiza estado, sessão e coleta.

**Resultado esperado.**

```
  ▎ beheld  observando seu dia

  MCP server      ●  running  pid <N>, port 7337
  Scoring engine  ●  running  pid <N>, port 7338

  Sessão atual    <duração> min · <eventos> eventos · <ferramentas>
  Coleta hoje     <N> sessões · <M> eventos
```

Sem sessão ativa: `Sessão atual    nenhuma sessão ativa`.

**Exit codes.** `0`.

**Notas.** A porta vem de `BEHELD_MCP_URL` / `BEHELD_ENGINE_URL` quando setadas (default 7337/7338).

---

### `beheld doctor`

**Assinatura:** `beheld doctor`
**Efeito:** read-only com exceção — quando confirma as **quatro condições** de busy-loop do engine, dispara `selfHealEngine()`, que mata e reinicia o engine. Severidade do snapshot pré-heal manda no exit code.
**Pré-condições:** nenhuma.

**Descrição.** Diagnóstico exaustivo: health dos daemons, PID file, codesign (macOS), integração Claude Code, processamento (cursor, escrita do `profile.db`, WAL, backlog), autostart, assinaturas no `daemon.log`, JSONL do dia.

**Execução.**
1. `checkMcp()`, `checkEngine()` (com inspeção `ps -o stat=,%cpu=,etime=`).
2. `checkPidFile()` — compara `~/.beheld/daemon.pid` com PID real do listener.
3. `checkCodesignMacOS()` — `codesign -dv` no engine, atributo `com.apple.quarantine`.
4. `checkClaudeIntegration()` — slash + MCP em `~/.claude.json` + tentativa de self-heal.
5. `takeProcessingSnapshot()` em `~/.beheld/` (cursor, sessions, `profile.db`, WAL).
6. `evaluateCursorStaleness` (threshold 5 min), `evaluateDbWrite` (5 min), `evaluateWal` (4 MB), `evaluateBacklog` (bytes pendentes após o cursor).
7. `checkAutostart()` — `launchctl list` (darwin) ou `systemctl --user is-{enabled,active}` (linux).
8. `checkLogSignatures()` em 64 KB finais do `daemon.log`: `Errno 48`, `Address already in use`, `engine trigger timeout`, `Engine falhou ao iniciar`, `MCP server falhou ao iniciar`, `Traceback (most recent call last)`.
9. `checkJsonlToday()` — conta eventos do dia em disco e compara com `events_today` do MCP.
10. Sumário: lista críticos numerados, dispara `selfHealEngine` se as 4 condições baterem, sai com código apropriado.

**Resultado esperado (verde).**

```
  ▎ beheld  checando minha saúde

🔍 Verificando MCP server (porta 7337)…
   ✓ Respondendo em /health (v<version>)
   ✓ PID <N>

🔍 Verificando Scoring engine (porta 7338)…
   ✓ Respondendo em /health (v<version>)
   ✓ PID <N>

(... demais checks ...)

Resultado: ✓ Tudo verde
```

**Resultado esperado (crítico, sem busy-loop).**

```
Resultado: ✗ Produto degradado — <N> problema(s) crítico(s), <M> aviso(s)

1. <label do check>
   <linhas>
   <dica>
```

**Resultado esperado (busy-loop confirmado).**

```
🔧 Auto-heal disparado: engine em busy-loop confirmado
   Evidências:
     • PID <N> LISTEN em :7338
     • /health timeout
     • STAT=<R...>, CPU=<X>%, etime=<...>
     • Cursor parado há <duração> vs sessão mais nova
   Passos:
     ✓ diretório de diagnóstico preparado
     ✓ stack capturado em ~/.beheld/diagnostics/<...>
     ✓ engine matado (<detalhe>)
     ✓ socket :7338 liberado
     ✓ WAL checkpoint executado
     ✓ daemon.pid limpo (engine removido)
     ✓ daemon religado
   Rode `beheld doctor` para confirmar o estado pós-heal.
```

**Exit codes.** `0` tudo verde · `1` há warnings · `2` há críticos (independente do sucesso do auto-heal).

**Notas.** O auto-heal só dispara quando **todas** estas condições coincidem: listener na porta + `/health` crítico + STAT contém `R` + CPU > 50% + cursor parado mais que o threshold. Lógica pura em `isInequivocalBusyLoop` (`packages/cli/src/commands/doctor.ts:844`).

---

### `beheld self-heal`

**Assinatura:** `beheld self-heal [--verbose]`
**Efeito:** escreve em `~/.claude/commands/beheld.md` e `~/.claude.json` quando algum desses sumiu. Idempotente. No-op silencioso quando Claude Code não foi opt-in no `init`.
**Pré-condições:** opcionalmente `~/.beheld/config.json` com `environments.claudeCode = true`.

**Descrição.** Recria silenciosamente o slash command `/beheld` e o registro MCP global se algum dos dois foi removido (delete agressivo, upgrade, housekeeping do Claude Code). Pensado para rodar dentro de um hook `SessionStart` redirecionado para `/dev/null`.

**Flags**

| Flag | Default | Efeito |
|---|---|---|
| `--verbose` | false | Imprime uma linha sumarizando o que foi restaurado. |

**Resultado esperado (sem `--verbose`).** Nenhum output. Exit 0.

**Resultado esperado (`--verbose`).**

```
OK (nada a restaurar)
```

Ou, conforme o caso:

```
slash command restaurado
MCP server restaurado
slash command restaurado + MCP server restaurado
```

**Exit codes.** Sempre `0` — uma falha do heal nunca quebra a sessão.

---

### `beheld view`

**Assinatura:** `beheld view [--json] [--scores-only] [--refresh] [--coach] [--session-hint <phase>]`
**Efeito:** read-only. Com `--refresh`, chama `POST /process-new` no engine e aguarda até 30s pelo término.
**Pré-condições:** engine no ar **ou** cache disponível em `~/.beheld/profile.db`.

**Descrição.** Renderiza o retrato técnico atual. Modos: profile completo (default), JSON, scores crus, coach view (com hint da sessão atual).

**Flags**

| Flag | Default | Efeito |
|---|---|---|
| `--json` | false | Emite JSON em stdout. Mensagens de diagnóstico vão para stderr. |
| `--scores-only` | false | Emite scores separados por espaço. Idem stderr. |
| `--refresh` | false | Antes de renderizar, processa eventos pendentes. |
| `--coach` | false | Renderiza coach view (patterns + suggestions). |
| `--session-hint <phase>` | `unknown` | Hint do estágio da sessão atual. Valores válidos: `feature_work`, `debug`, `refactor`, `exploration`, `unknown`. |

**Execução.**
1. Se `--coach`: header `olhando seu dia de perto`, chama `coach(hint)` no engine, renderiza (JSON ou texto). Engine offline → exit 1.
2. Caso contrário: header `seu retrato hoje`.
3. `engineStatus()`. Se `--refresh` e há `unprocessed_events`, chama `processNew()` e polleia (`waitForProcessing`, timeout 30s).
4. Em paralelo: `scoresCurrent`, `profileSummary`, `insights`, `mcpSessionCurrent`.
5. Se `scores` é `null` (engine offline e sem cache), exit 1.
6. Se scores vêm de `live` e o engine não está pronto (`readiness().ready === false`), renderiza `renderCollecting()` e exit 0.
7. Se `scores.source === "cache"` ou a data está mais que 1 dia atrás, renderiza alert box "ENGINE OFFLINE" ou "SCORE DESATUALIZADO".
8. Renderiza profile via `renderProfile(data, flags)`.

**Resultado esperado (engine offline, sem cache).**

```
  ▎ beheld  seu retrato hoje

  ✗ Engine offline e nenhum score cacheado disponível.
  Execute: beheld start
```

**Resultado esperado (eventos pendentes sem `--refresh`).**

```
  ⚠️  Há eventos não processados (sessão interrompida).
  Score pode estar desatualizado.
  Execute: beheld view --refresh para atualizar.
```

**Resultado esperado (cache de dias atrás).** Alert box com título `ENGINE OFFLINE` ou `SCORE DESATUALIZADO`, sugestões `beheld doctor` e `beheld restart`.

**Exit codes.** `0` em sucesso ou em estado "ainda coletando" · `1` engine offline sem cache, ou `--coach` sem engine.

**Notas.** Em `--json`/`--scores-only`, mensagens de diagnóstico vão para stderr — stdout fica pipe-friendly.

---

### `beheld import [url]`

**Assinatura:** `beheld import [url] [--list] [--remove <hash>] [--github] [--gitlab] [--bitbucket]`
**Efeito:** rede (clona o repositório dentro do engine), escreve no banco do engine. Inclui prompt interativo para PAT quando necessário; remoção exige confirmação.
**Pré-condições:** engine no ar (sem ele, o comando aborta — "Engine indisponível. Verifique se o daemon está rodando."). `author_email` obrigatório — perguntado e persistido em `~/.beheld/config.json` se faltar.

**Descrição.** Bootstrap L1: importa o histórico Git de repositórios para alimentar a base histórica. Vários modos: URL única, loop interativo, listagem por host (GitHub/GitLab/Bitbucket), listagem dos já importados, remoção por hash do commit raiz.

**Argumentos**

| Arg | Obrigatório | Formato | Descrição |
|---|---|---|---|
| `url` | não | URL git (https/ssh) | Atalho para importar um único repositório. |

**Flags**

| Flag | Default | Efeito |
|---|---|---|
| `--list` | false | Lista repos importados como tabela `HASH / DATA / COMMITS`. |
| `--remove <hash>` | — | Remove um repo (por hash raiz) após confirmação. |
| `--github` | false | Lista + checkbox seletor via `gh` CLI ou PAT. |
| `--gitlab` | false | Idem para GitLab via `glab` CLI ou PAT. |
| `--bitbucket` | false | Idem para Bitbucket via app password. |

**Execução (URL única).**
1. Header `trazendo seu histórico`.
2. Pergunta `author_email` se faltar.
3. `importOne(url, email)` → `POST /l1/import` no engine. Polla `getImportStatus` a cada 1s até `done`/`error` (deadline 5 min).
4. Se status retornar `needs_pat`, pede PAT em prompt sem eco e re-submete.
5. Imprime linha por outcome: `imported`, `already_imported`, `author_not_found`, `clone_error`, `needs_pat`.

**Execução (`--list`).** Header `repositórios que já mapeei`, tabela com `HASH / DATA DE IMPORT / COMMITS`.

**Execução (`--remove <hash>`).** Header `apagando um repositório`, prompt `Remover repositório <hash> do L1? (esta ação não pode ser desfeita) [s/N]`. Se confirmado, chama `deleteL1Repository(hash)` no engine.

**Execução (host).** Header `trazendo seu histórico`, dispara `runHostImport(host, ingest, deps)` em `packages/cli/src/commands/import-host.ts`.

**Execução (loop interativo).** Pede URLs uma a uma; Enter vazio finaliza.

**Resultado esperado (URL importada).**

```
  ▎ beheld  trazendo seu histórico

  →  https://github.com/.../...

  ✓  <N> commits importados — adicionado ao L1

  ✓  Bootstrap concluído · 1 repositório(s) · <N> commits analisados
```

**Resultado esperado (já importado).**

```
  ⚠  Já presente no L1 (hash <abcd1234>) — pulado
```

**Resultado esperado (author não encontrado).**

```
  ⚠  Nenhum commit seu encontrado neste repositório — pulado
```

**Resultado esperado (lista vazia).**

```
  ▎ beheld  repositórios que já mapeei

  Nenhum repositório importado.
```

**Exit codes.** `0` em sucesso e em "skipped" (já presente / author não bate / clone falhou — o comando segue). `Ctrl+C` no prompt secreto sai com `130`.

**Notas.** O PAT só é mantido em memória durante o re-submit — é zerado (`pat = null`) imediatamente após. Backspace e Ctrl+C tratados no `defaultPromptSecret`.

---

### `beheld attest`

**Assinatura:** `beheld attest [--url <url>]`
**Efeito:** abre navegador, escuta callback em porta efêmera local, escreve `~/.beheld/attestation.json` (cache da identidade).
**Pré-condições:** rede; chave Ed25519 (gerada se faltar, via `loadPublicJwk()` indireto). API do portal acessível.

**Descrição.** OAuth GitHub via loopback HTTP. Vincula a public key local à identidade GitHub para subir o trust tier dos bundles.

**Flags**

| Flag | Default | Efeito |
|---|---|---|
| `--url <url>` | de `BEHELD_API_URL`, ou `getApiBaseUrl()` (resolve por `BEHELD_ENV`) | Base do API platform. |

**Execução.**
1. Header `verificando identidade GitHub`.
2. Carrega public JWK e converte para base64 padrão (`jwkXToStdB64`).
3. Gera `cli_state` aleatório (24 bytes base64url).
4. Sobe servidor HTTP local em `port: 0` (porta efêmera).
5. Monta `start_url = <baseUrl>/api/auth/github/start?cli_state=...&cli_port=...&dev_pubkey=ed25519-pub:<b64>`.
6. Abre navegador (`open` / `xdg-open` / `cmd /c start`). Se falhar, imprime URL para abrir manualmente.
7. Aguarda callback em `/callback?cli_state=...&claim_code=...`. Valida `cli_state`. Timeout 5 min → exit 1.
8. `POST /api/attestation/claim { claim_code }` → atestação assinada pelo backend.
9. Salva em `~/.beheld/attestation.json` via `saveAttestationCache()`.

**Resultado esperado.**

```
  ▎ beheld  verificando identidade GitHub

  →  subindo servidor local para callback
  →  abrindo navegador em <baseUrl>
  →  recebendo attestation
  ✓  identidade atestada
     github:        <login> (id=<N>)
     platform_key:  <key-id>
     attested_at:   <ISO>
```

**Exit codes.** `0` sucesso · `1` timeout, CSRF (`cli_state mismatch`), ou erro de claim.

**Notas.** Servidor local pára 100ms após responder, ou no timeout. A página HTML retornada ao browser tem título `Beheld — autorizado` e mostra `✓ identidade atestada` em verde.

---

### `beheld identity link`

**Assinatura:** `beheld identity link [--url <url>]`
**Efeito:** alias direto de `beheld attest`. Mesmas pré-condições, mesmo cache, mesmo output.
**Pré-condições:** ver `beheld attest`.

**Descrição.** Nome da operação no vocabulário da Fase 5 / F5.6. Implementação chama `attestCommand(opts)`.

**Resultado esperado.** Idêntico a `beheld attest`.

---

### `beheld identity status`

**Assinatura:** `beheld identity status`
**Efeito:** read-only.
**Pré-condições:** nenhuma.

**Descrição.** Imprime a identidade GitHub vinculada à chave local, ou aponta para `identity link` se não há vínculo.

**Resultado esperado (vinculada).**

```
  ▎ beheld  identidade GitHub

  →  vinculada
  github:        @<login> (id=<N>)
  platform_key:  <key-id>
  attested_at:   <ISO>
```

**Resultado esperado (não vinculada).**

```
  ▎ beheld  identidade GitHub

  →  não vinculada
  execute: beheld identity link
```

**Exit codes.** `0`.

---

### `beheld keys show`

**Assinatura:** `beheld keys show`
**Efeito:** read-only.
**Pré-condições:** par Ed25519 em `~/.beheld/keys/`.

**Descrição.** Mostra a public key Ed25519 atual (JWK) e sua fingerprint.

**Resultado esperado.**

```
  ▎ beheld  sua chave de assinatura

  Public key (Ed25519, JWK)
     x:           <base64url>
     fingerprint: <hex>
     path:        ~/.beheld/keys/public.jwk
```

**Resultado esperado (sem chave).** Em stderr:

```
  ✗  Nenhuma chave Ed25519 encontrada
     Execute: beheld init  (gera o par automaticamente)
     Ou: beheld keys import <arquivo>
```

**Exit codes.** `0` em sucesso · `1` se não há chave.

---

### `beheld keys import <path>`

**Assinatura:** `beheld keys import <path>`
**Efeito:** escreve `~/.beheld/keys/private.jwk` (0600) e `public.jwk` (0644). Recusa se já existe par.
**Pré-condições:** nenhuma chave atualmente em `~/.beheld/keys/` — caso contrário, instrui a usar `keys rotate` primeiro.

**Descrição.** Importa um par Ed25519 já existente (JWK ou PEM).

**Argumentos**

| Arg | Obrigatório | Formato | Descrição |
|---|---|---|---|
| `<path>` | sim | caminho de arquivo | JWK ou PEM com a private key. |

**Resultado esperado.**

```
  ▎ beheld  adicionando uma chave

  ✓  Chave Ed25519 importada
     fingerprint: <hex>
     private:     ~/.beheld/keys/private.jwk  (0600)
     public:      ~/.beheld/keys/public.jwk   (0644)
```

**Resultado esperado (já existe chave).**

```
  ⚠  Já existe uma chave instalada
     Use `beheld keys rotate` antes de importar — a chave atual fica arquivada.
```

**Exit codes.** `0` em sucesso · `1` se faltou path, arquivo não existe, ou já há chave.

---

### `beheld keys rotate`

**Assinatura:** `beheld keys rotate`
**Efeito:** gera novo par; o par anterior é arquivado em `~/.beheld/keys/archive/<timestamp>/`.
**Pré-condições:** chave existente.

**Descrição.** Substitui o par Ed25519 atual. Snapshots antigos continuam verificáveis porque carregam a public key no próprio bundle.

**Resultado esperado.**

```
  ▎ beheld  trocando suas chaves

  ✓  Par de chaves rotacionado
     nova fingerprint: <hex>
     arquivo anterior: ~/.beheld/keys/archive/<...>

  Snapshots antigos continuam verificáveis com a public_key embutida neles.
```

**Exit codes.** `0` em sucesso · `1` se não há chave para rotacionar.

---

### `beheld snapshot`

**Assinatura:** `beheld snapshot [--output <path>] [--share] [--html] [--author-name <name>] [--no-rekor] [--rekor-submit <path>]`
**Efeito:** escreve em `~/.beheld/snapshots/<YYYYMMDD>_<hash8>.beheld` (sempre), opcionalmente em `~/Desktop/` e em `<--output>`. Rede para Rekor (timeout 8s, opt-out via `--no-rekor`). Compartilhamento via `--share` ou prompt subsequente faz upload ao portal.
**Pré-condições:** engine no ar; engine deve responder com `200` (com `409` retorna "Sem dados suficientes para gerar um snapshot ainda").

**Descrição.** Gera bundle `.beheld` assinado: engine produz payload canônico → CLI canonicaliza, calcula hash, assina com Ed25519, embute attestation se presente, submete ao Rekor, grava em disco, registra na chain do engine, opcionalmente sobe ao portal, opcionalmente gera HTML.

**Flags**

| Flag | Default | Efeito |
|---|---|---|
| `--output <path>` | — | Grava cópia adicional do bundle no caminho dado. |
| `--share` | false | Faz upload imediato ao portal (pula prompt). |
| `--html` | false | Gera retrato HTML self-contained ao lado do bundle (`.html` no mesmo nome). |
| `--author-name <name>` | `dev` | Nome no retrato HTML. |
| `--no-rekor` | false | Pula submissão ao Rekor. Tier do bundle não será `fully_verifiable`. |
| `--rekor-submit <path>` | — | Modo separado: re-submete um bundle existente ao Rekor e reescreve in-place. |

**Execução (snapshot novo).**
1. Header `capturando o momento`.
2. `ensureKeys()` — gera par se faltar.
3. `POST <ENGINE_URL>/snapshot/payload`. `409` → exit 1 com "Sem dados suficientes". Outros não-OK → exit 1.
4. Canonicaliza payload, calcula `sha256:<hex>`, assina canonical com Ed25519, monta `signature: ed25519:<hex>` e `public_key: ed25519:<jwk.x>`.
5. Carrega attestation se cached.
6. Se `--no-rekor` não foi passado: `submitToRekor(payloadBytes, privKey, pubHex)` com DSSE envelope.
7. Grava em `~/.beheld/snapshots/`, em `--output`, e — se existir — em `~/Desktop/` (controlado por `BEHELD_NO_DESKTOP_COPY` e `BEHELD_DESKTOP_DIR`).
8. `POST <ENGINE_URL>/snapshot/save` para registrar na chain. Falha vira warning (`Bundle criado no disco mas não registrado na chain`).
9. Imprime hash, paths, identidade, composição L1/L2, linha Rekor e tier.
10. Se `--html`, escreve `<bundle>.html` com `renderSnapshotHtml`.
11. Se `--share` ou prompt afirmativo (`s`/`y`), chama `runShare()`.

**Execução (`--rekor-submit <path>`).**
1. Header `registrando bundle no Rekor`.
2. Lê o bundle; se já tem `rekor.logIndex`, imprime estado e retorna.
3. Confere `public_key` do bundle contra a chave atual. Divergência → exit 1.
4. Re-deriva canonical, chama `submitToRekor`, regrava o bundle in-place.

**Resultado esperado (sucesso).**

```
  ▎ beheld  capturando o momento

  ✓  Snapshot gerado
     hash:         <24 chars>…
     arquivo:      /Users/.../.beheld/snapshots/<...>.beheld
     desktop:      /Users/.../Desktop/<...>.beheld
     cópia:        <--output path se passado>
     assinado por: <fingerprint>
     identidade:   @<login> · GitHub OAuth        (ou: não verificada (execute beheld identity link))

  Perfil capturado
     Engine:               beheld-engine v<...>
     Hash do engine:       <16 chars>…
     Base histórica:       <texto>
     Trajetória observada: <texto>
     Rekor:                ✓ log #<N> · <integratedTime>
     Tier:                 <tier>

→ Publicar perfil verificado? [s/N]
```

**Resultado esperado (engine sem dados).**

```
✗ Sem dados suficientes para gerar um snapshot ainda.
  <detalhe do engine ou "Use o Claude Code por algumas sessões e tente novamente.">
```

**Resultado esperado (Rekor offline).** Linha `Rekor: ⚠ não registrado (rede indisponível (...) — re-submeter: beheld snapshot --rekor-submit <bundle>)`.

**Exit codes.** `0` em sucesso · `1` engine offline / sem dados / chave divergente / Rekor recusou em `--rekor-submit`.

**Notas.** O prompt de publicação é pulado em ambiente não-TTY (CI). `BEHELD_NO_DESKTOP_COPY=1` opta-out da cópia no Desktop.

---

### `beheld snapshot list`

**Assinatura:** `beheld snapshot list`
**Efeito:** read-only.
**Pré-condições:** engine no ar.

**Descrição.** Lista snapshots registrados na chain do engine (não os arquivos em disco diretamente — vem do `GET /snapshots`).

**Resultado esperado (vazio).**

```
  ▎ beheld  histórico de momentos

  Nenhum snapshot ainda. Execute: beheld snapshot
```

**Resultado esperado (com snapshots).**

```
  ▎ beheld  histórico de momentos

  <N> snapshot(s)

  →  <YYYY-MM-DD HH:MM:SS>  <hash12>  <bundle_path>
  •  <YYYY-MM-DD HH:MM:SS>  <hash12>  <bundle_path>
```

Marcador `→` indica snapshot encadeado a um anterior; `•` indica genesis (`previous_hash` null).

**Exit codes.** `0` em sucesso · `1` engine offline.

---

### `beheld share`

**Assinatura:** `beheld share`
**Efeito:** rede (POST `/api/v1/bundles` no portal). Escreve `last_published_slug` e — se aceito — `email_recovery` em `~/.beheld/config.json`.
**Pré-condições:** existe pelo menos um `.beheld` em `~/.beheld/snapshots/`.

**Descrição.** Publica o bundle mais recente local no portal. Na primeira publicação, pergunta opcionalmente um email de recuperação de conta (default N).

**Execução.**
1. Header `publicando perfil`.
2. `findLatestBundlePath()` — mais recente por mtime.
3. Lê e parseia o bundle.
4. Lê config; se `last_published_slug` não existe e há TTY, pergunta `Registrar email para recuperação de conta? [s/N]` e, se sim, pede o email.
5. `publishBundle(bundle, { emailRecovery })`.
6. Em sucesso, persiste `slug` (derivado de `result.data.url`) e `email_recovery` se passado.
7. Renderiza `renderShareSuccess(url)` — QR ASCII + URL em bold.

**Resultado esperado (sucesso).**

```
  ▎ beheld  publicando perfil

(QR code ASCII)
  <https://...>
```

Se conta foi criada na hora: `  conta criada` em dim.

**Resultado esperado (sem bundle).**

```
  ✗  Nenhum bundle encontrado. Execute: beheld snapshot
```

**Resultado esperado (falha de rede).**

```
  ✗  Falha no upload — bundle salvo localmente
  rede: <mensagem>
  Tente novamente: beheld share
```

**Resultado esperado (falha HTTP).**

```
  ✗  Falha no upload — bundle salvo localmente
  HTTP <status>: <body[:200]>
  Tente novamente: beheld share
```

**Exit codes.** `0` em sucesso · `1` sem bundle, falha de leitura, ou erro de upload.

---

### `beheld verify <file>`

**Assinatura:** `beheld verify <file> [--chain] [--verify-rekor]`
**Efeito:** read-only. Com `--verify-rekor`, rede para o log público (`fetchRekorEntry`).
**Pré-condições:** nenhuma. Funciona offline para schema/hash/signature/chain (chain resolve via `~/.beheld/snapshots/`).

**Descrição.** Valida o `.beheld`: schema, hash do payload, assinatura Ed25519, presença de seções core/enrichment, opcionalmente a chain de hashes anteriores, attestation de identidade, e (opcionalmente) confirmação online do Rekor.

**Argumentos**

| Arg | Obrigatório | Formato | Descrição |
|---|---|---|---|
| `<file>` | sim | path | Caminho do `.beheld` a verificar. |

**Flags**

| Flag | Default | Efeito |
|---|---|---|
| `--chain` | false | Resolve `previous_hash` recursivamente em `~/.beheld/snapshots/` e valida links. |
| `--verify-rekor` | false | Consulta `rekor.sigstore.dev` e confirma `logIndex` + `uuid`. |

**Resultado esperado (válido).**

```
  ▎ beheld  checando autenticidade

  schema       <label>
  sections     <a · b · c>
  sources      <harness1 (<fidelity> · N sessions), ...>

  Verificação: <file>
    ✓ schema
    ✓ hash
    ✓ signature
    ✓ core         <N> repositórios
    ✓ enrichment   <N> sessões
    ✓ identity  github: <login> (id=<N>)
      ✓ platform signature
      ✓ dev pubkey bind
      ✓ platform key status: active

  Rekor inclusion:
    ✓ Log index: #<N>
    ✓ Timestamp: <ISO> (UTC, imutável)
    ✓ UUID: <uuid>
    → Verificar em: https://rekor.sigstore.dev/api/v1/log/entries/<uuid>

  <summary do payload>
    Base histórica:       <texto>
    Trajetória observada: <texto>
    Trust tier:           <tier>
```

**Resultado esperado (inválido).** Linhas com `✗` no check que falhou e `process.exit(1)` ao final.

**Resultado esperado (sem Rekor).** `– Rekor: não registrado` + dica `beheld snapshot --rekor-submit <bundle>`.

**Exit codes.** `0` em sucesso · `1` arquivo ausente, JSON inválido, qualquer falha de check, ou divergência online com `--verify-rekor`.

---

### `beheld auth`

**Assinatura:** `beheld auth`
**Efeito:** rede (challenge-response no portal). Abre navegador no dashboard.
**Pré-condições:** chaves Ed25519 em `~/.beheld/keys/`. Conta deve existir no portal (publique antes com `beheld share`).

**Descrição.** Login passwordless via challenge-response: `POST /api/v1/auth/challenge` → assina nonce → `POST /api/v1/auth/verify` → recebe `session_token` e `redirect_url` → abre o navegador.

**Execução.**
1. Imprime `beheld auth` em dim, fingerprint truncada e URL do portal.
2. `POST /api/v1/auth/challenge { fingerprint }`. `404` → "Conta não encontrada. Publique seu perfil primeiro com `beheld share`."
3. Assina o nonce bytes com a private key.
4. `POST /api/v1/auth/verify { fingerprint, nonce, signature }`. Sucesso retorna `redirect_url`.
5. Abre browser (`open` no macOS, `xdg-open` no Linux).

**Resultado esperado.**

```
beheld auth
  fingerprint: <16 chars>…
  portal:      <https://...>
✓ Autenticado
  <full URL>
```

**Exit codes.** `0` em sucesso · `1` sem chaves, conta não encontrada, falha de rede ou de verificação.

**Notas.** Não testado contra o portal nesta varredura.

---

### `beheld update`

**Assinatura:** `beheld update`
**Efeito:** rede (consulta versão, baixa binário), sobrescreve `process.execPath`, reinicia daemon.
**Pré-condições:** rede; permissão de escrita no caminho do binário.

**Descrição.** Verifica versão remota, baixa o binário para a plataforma atual, valida checksum SHA-256 quando disponível, substitui o binário corrente e reinicia o daemon.

**Execução.**
1. Header `buscando uma versão mais nova`.
2. `GET <getApiUrl()>/version` (timeout 5s). Sem resposta → "Não foi possível verificar a versão disponível." e retorna.
3. Se `latest === VERSION` (literal `0.3.2` no arquivo) → "já é a versão mais recente." e retorna.
4. Pergunta `Atualizar agora? [S/n]`. Aceita só `s`.
5. Resolve plataforma (`darwin-arm64` / `darwin-x64` / `linux-x64`).
6. Baixa de `https://github.com/eduardovrocha/beheld/releases/download/v<latest>/beheld-<plat>` para `<binary>.new` (timeout 60s).
7. Tenta baixar `.sha256` (timeout 5s). Se OK, valida via `shasum -a 256`. Divergência → exit 1 e remove o tmp.
8. `chmod 0o755` no tmp, `rename(tmp, currentBinary)`.
9. Se daemon estava rodando, faz `stop()` + `start()`.

**Resultado esperado (atualização disponível).**

```
  ▎ beheld  buscando uma versão mais nova

  Beheld <latest> disponível  (atual: 0.3.2)
  Atualizar agora? [S/n] s
  ✓  Baixando beheld-<plat>
  ✓  Verificando checksum
  ✓  Substituindo binário
  ✓  Reiniciando daemon

  Atualizado para <latest>
```

**Resultado esperado (já é a mais nova).**

```
  ▎ beheld  buscando uma versão mais nova

  ✓  Beheld 0.3.2 já é a versão mais recente.
```

**Exit codes.** `0` em sucesso, sem atualização, ou cancelamento · `1` falha de download, checksum, ou substituição.

**Notas.** Comando não executado nesta varredura (efeito colateral irreversível). A constante `VERSION` aqui (`0.3.2`) **diverge** do `VERSION` do entrypoint (`0.4.1`) — ver "Perguntas em aberto".

---

### `beheld delete --local`

**Assinatura:** `beheld delete --local`
**Efeito:** **destrutivo local.** Pára daemon e apaga `~/.beheld/` recursivamente.
**Pré-condições:** confirmação obrigatória: usuário precisa digitar exatamente `apagar tudo` (exceto quando chamado de dentro do `--all`).

**Descrição.** Limpa todo o estado local. Não toca em hooks, attestation remota, ou binário.

**Resultado esperado.**

```
  ▎ beheld  apagando o que sobrou

  Isso apagará <N> sessões de dados locais. Não pode ser desfeito.
  Digite "apagar tudo" para confirmar: apagar tudo
  Parando daemon…
  ✓  Daemon parado
  Apagando ~/.beheld/…
  ✓  ~/.beheld/ removido
```

Se cancelar: `Abortado.` e retorna.

**Exit codes.** `0`.

**Notas.** (não executado — efeito colateral destrutivo)

---

### `beheld delete --remote`

**Assinatura:** `beheld delete --remote`
**Efeito:** **destrutivo remoto.** Revoga attestation no servidor.
**Pré-condições:** rede; existe `~/.beheld/attestation.json`. Confirmação obrigatória: usuário digita `revogar`.

**Descrição.** Assina `{action:"revoke", issued_at, timestamp}` com a chave local e envia ao `/api/attestation/revoke`. **Invalida bundles já compartilhados que referenciam a attestation.**

**Execução.**
1. Header `apagando o que sobrou`.
2. Avisa em vermelho: `Isso invalidará bundles já compartilhados que referenciam essa attestation.`
3. Pede confirmação digitada `revogar`. Diferente → `Abortado.`
4. Chama `revokeRemoteAttestation()`. Resultados possíveis: `revoked`, `not_attested`, `server_offline`, `failed`.

**Resultado esperado (sucesso).**

```
  ▎ beheld  apagando o que sobrou

  Isso invalidará bundles já compartilhados que referenciam essa attestation.
  Digite "revogar" para confirmar: revogar
  Revogando attestation no servidor…
  ✓  Attestation revogada no servidor
```

**Exit codes.** `0` (mesmo em falhas — só reporta).

**Notas.** (não executado — efeito colateral remoto destrutivo)

---

### `beheld delete --all`

**Assinatura:** `beheld delete --all`
**Efeito:** **destrutivo total.** Pára daemon, revoga attestation remota (best-effort), apaga `~/.beheld/`, remove hooks/MCP, limpa resíduos `devprofile` (LaunchAgent `com.devprofile.daemon.plist`, `systemd/user/devprofile.service`, entradas em `~/.claude/settings.json`).
**Pré-condições:** confirmação obrigatória: usuário digita `apagar tudo`.

**Descrição.** Remoção completa. Não apaga o binário — instrui o usuário a rodar `rm $(which beheld)` ao final.

**Resultado esperado (sucesso).**

```
  ▎ beheld  apagando o que sobrou

  Remoção completa: <N> sessões locais, attestation no servidor, hooks, e resíduos do nome antigo.
  Digite "apagar tudo" para confirmar: apagar tudo

  Iniciando remoção completa do Beheld…

  Parando daemon…
  ✓  Daemon parado
  Revogando attestation no servidor…
  ✓  Attestation revogada no servidor
  Removendo ~/.beheld/…
  ✓  ~/.beheld/ removido (<N> sessões)
  Removendo hooks/MCP…
  ✓  Hooks/MCP removidos
  Limpando resíduos do nome antigo (devprofile)…
  ✓  Resíduos devprofile limpos:
      LaunchAgent devprofile: LaunchAgent removido
      ~/.claude/settings.json: entries devprofile removidas

  Beheld removido com sucesso.

  Para remover o binário:
    rm $(which beheld)

  Verificar limpeza:
    which beheld && echo "binário ainda presente" || echo "✓ binário removido"
    ls ~/.beheld 2>&1
    grep -rE "beheld|devprofile" ~/.claude/settings.json ~/.continue/config.json 2>/dev/null
```

**Exit codes.** `0`.

**Notas.** (não executado — efeito colateral destrutivo total)

---

### `beheld delete` (sem flag)

**Assinatura:** `beheld delete`
**Efeito:** **erro imediato.** Sai com `1` e `Especifique --local, --remote ou --all` em stderr.
**Pré-condições:** nenhuma.

**Resultado esperado.**

```
  ▎ beheld  apagando o que sobrou
  Especifique --local, --remote ou --all
```

**Exit codes.** `1`.

---

### `beheld migrate-legacy`

**Assinatura:** `beheld migrate-legacy`
**Efeito:** escreve em `~/.claude.json` removendo registros MCP project-scoped do `beheld`.
**Pré-condições:** nenhuma.

**Descrição.** Migração one-off: o Beheld antigamente se registrava per-project no Claude Code; o modelo atual é global. Esta vassoura limpa os restos.

**Resultado esperado.**

```
Migrated <N> project-scoped registration(s) to global scope.
```

ou

```
No project-scoped registrations found.
```

**Exit codes.** `0`.

---

### `beheld server`

**Assinatura:** `beheld server [--stdio]`
**Efeito:** sobe servidor MCP (HTTP em `:7337` no modo padrão; stdio quando `--stdio`).
**Pré-condições:** nenhuma. Comando interno — invocado pelo daemon-manager ou por Claude Code.

**Descrição.** Backend MCP do Beheld. Documentado para completude — não é endpoint de uso direto pelo dev.

**Flags**

| Flag | Default | Efeito |
|---|---|---|
| `--stdio` | false | Modo MCP stdio (usado pelo Claude Code via `~/.claude.json`). |

**Execução.**
- `--stdio`: importa e roda `startStdioServer()` em `packages/mcp-server/src/stdio-server.ts`.
- sem flag: importa e roda `startServer()` em `packages/mcp-server/src/server.ts`.

**Exit codes.** O servidor é long-running; sai com 0 em shutdown gracioso ou diferente conforme falhas internas do MCP.

**Notas.** (não executado — long-running, escopo interno)

---

## Variáveis de ambiente relevantes

| Variável | Efeito |
|---|---|
| `BEHELD_DATA_DIR` | Reescreve a raiz dos dados (default `~/`). O diretório real é `<BEHELD_DATA_DIR>/.beheld/`. Usado por `status`, `doctor`, `snapshot`, `verify`, `share`, `delete`. |
| `BEHELD_MCP_URL` | Reescreve a URL do MCP (default `http://127.0.0.1:7337`). Porta extraída para `doctor` / `status`. |
| `BEHELD_ENGINE_URL` | Reescreve a URL do engine (default `http://127.0.0.1:7338`). |
| `BEHELD_API_URL` | Override do API platform usado por `attest` e `delete --remote`. |
| `BEHELD_ENV` | Ambiente (`dev` / `prod` / etc.) usado por `getApiBaseUrl`, `getApiUrl`, `getPortalUrl`, `getRekorUrl`. |
| `BEHELD_DESKTOP_DIR` | Override para a cópia conveniente do snapshot (default `~/Desktop`). |
| `BEHELD_NO_DESKTOP_COPY` | `=1` desliga a cópia para o Desktop em `snapshot`. |

## Perguntas em aberto

| # | Pergunta | Onde |
|---|---|---|
| 1 | Divergência de versão: `index.ts:5` declara `VERSION = "0.4.1"` enquanto `commands/init.ts:11` e `commands/update.ts:8` declaram `VERSION = "0.3.2"`. O `--version` exibe `0.4.1`, o `update` compara contra `0.3.2`. Intencional ou bug? | `packages/cli/src/index.ts`, `commands/init.ts`, `commands/update.ts` |
| 2 | `beheld auth` imprime cabeçalho como `beheld auth` em dim (sem o `▎` do `brand()`), divergindo do padrão visual dos demais comandos. Intencional? | `packages/cli/src/commands/auth.ts:30` |
| 3 | `beheld delete --local` não há *nenhum* flag inverso para pular o prompt manual (`apagar tudo`); só o caminho `--all` passa `skipConfirm` internamente. Sem CLI para uso scripted/CI. Faltando por design? | `packages/cli/src/commands/delete.ts:278` |
| 4 | O help do `snapshot` não lista a flag `--share` na descrição de uso impressa pelo commander (lista somente flags próprias do bloco principal). Confirmado: a flag existe, mas não é a única — investigar se o output do `--help` cobre todas. | `packages/cli/src/index.ts:165` |
| 5 | `beheld harness install` sem nomes posicionais varre todos os adapters detectados; sem comando explícito de "desinstalar" ou "desativar tail". | `packages/cli/src/commands/harness.ts` |

## Changelog

| Data | Mudança |
|---|---|
| 2026-06-08 | Versão inicial — varredura completa de `packages/cli/src/commands/` no commit `d7badd8`. |

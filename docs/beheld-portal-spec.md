# beheld — Portal Spec

> Criado: 2026-05-26
> Escopo: fluxo de publicação · dashboard dev · conta de empresa · upload por recrutador · notificações · diretório pesquisável · contato mediado

---

## Índice

1. [Artefatos e estados](#1-artefatos-e-estados)
2. [Fluxo de publicação — dev](#2-fluxo-de-publicação--dev)
3. [Conta do dev](#3-conta-do-dev)
4. [Dashboard do dev](#4-dashboard-do-dev)
5. [Fluxo de upload — recrutador](#5-fluxo-de-upload--recrutador)
6. [Conta de empresa](#6-conta-de-empresa)
7. [Notificações](#7-notificações)
8. [Diretório pesquisável](#8-diretório-pesquisável)
9. [Contato mediado](#9-contato-mediado)
10. [Modelo de dados](#10-modelo-de-dados)
11. [Backlog por feature](#11-backlog-por-feature)
12. [Stop-and-ask conditions](#12-stop-and-ask-conditions)

---

## 1. Artefatos e estados

### Dois artefatos distintos

| Artefato | Onde vive | Verificável | Badge | Propósito |
|----------|-----------|-------------|-------|-----------|
| `HTML local` | `~/.beheld/profiles/` | ✗ | nenhum | Visualização offline |
| `.dpbundle` | local + portal | ✓ | `verificado` / `desatualizado` | Dado assinado, publicável |

O HTML nunca exibe badge de verificação — não há como provar que não foi editado manualmente. Só a URL pública tem cadeia de verificação ativa.

### Estados de visibilidade por conta

| Estado | URL pública | Diretório | Ativado por |
|--------|-------------|-----------|-------------|
| `local_only` | ✗ | ✗ | padrão antes do primeiro publish |
| `verificavel` | ✓ | ✗ | `beheld --share` |
| `encontravel` | ✓ | ✓ | toggle no dashboard |

URL pública e diretório são controles ortogonais. O dev pode ter URL sem aparecer no diretório.

### Estados do perfil publicado

| Estado | Condição | Badge exibido |
|--------|----------|---------------|
| `verificado` | bundle publicado há menos de 30 dias | `verificado` |
| `desatualizado` | 30+ dias sem novo bundle publicado | `desatualizado` |

Perfil nunca expira — apenas envelhece. O badge muda visualmente, o conteúdo permanece acessível.

---

## 2. Fluxo de publicação — dev

### Geração local (sempre primeiro)

```
beheld profile generate

✓ perfil gerado → ~/.beheld/profiles/2026-05-26_abc123.html
✓ bundle gerado → ~/.beheld/bundles/2026-05-26_abc123.dpbundle
```

O bundle é gerado junto com o HTML em toda execução. A geração local nunca falha por razões de rede.

### Prompt pós-geração

```
→ Publicar perfil verificado? [s/N]
```

- Explícito, opt-in, uma linha
- Não executado automaticamente
- Não há menção de planos, upgrades ou pagamento

### Se s — fluxo de publish

```
beheld --share

→ Uploading bundle...
✓ beheld.dev/v/abc123def

→ Registrar email para recuperação de conta? [s/N]
  (recomendado — necessário para recuperar acesso se perder o equipamento)
```

O email é solicitado uma única vez, no primeiro publish. Se o dev já tem conta, o prompt não aparece.

### Falha de rede

Se o upload falhar, o bundle local permanece intacto. O perfil HTML foi gerado. Nenhum dado é perdido.

```
✗ Falha no upload — bundle salvo localmente
  Tente novamente: beheld --share
```

---

## 3. Conta do dev

### Criação

- Criada automaticamente no primeiro `beheld --share`
- Sem fluxo de registro explícito
- Identidade = fingerprint da chave pública Ed25519

### Autenticação no portal

```
beheld auth

→ portal emite challenge (nonce)
→ beheld assina localmente com chave privada
→ portal verifica assinatura contra fingerprint registrado
→ sessão estabelecida → beheld.dev/dashboard
```

A chave privada nunca sai da máquina. Sem senha, sem OAuth, sem email obrigatório para autenticar.

### Campos da conta

| Campo | Finalidade | Obrigatório |
|-------|-----------|-------------|
| Email de recuperação | segurança da conta | sim — solicitado no primeiro publish |
| Email de contato | exposto à empresa ao responder mensagem | sim — para habilitar "Responder" |
| Telefone de contato | exposto à empresa ao responder mensagem | sim — para habilitar "Responder" |

Email de recuperação e email de contato são campos separados. O dev pode usar endereços diferentes para cada finalidade.

### Recuperação de conta (perda de equipamento)

```
beheld.dev/recover

1. dev informa email de recuperação cadastrado
2. portal envia link de verificação
3. dev instala beheld no novo equipamento → novo par de chaves gerado
4. beheld recovery --token <token>
5. nova chave associada à conta
6. chave antiga revogada
```

Bundles assinados com a chave antiga permanecem válidos — eram válidos no momento da assinatura. Bundles futuros usam a nova chave.

---

## 4. Dashboard do dev

`beheld.dev/dashboard` — acessível via `beheld auth`

### Controles de visibilidade

| Controle | Escopo | Comportamento |
|----------|--------|---------------|
| URL pública | por bundle | toggle on/off por bundle publicado |
| Diretório | por conta | toggle global — on = aparece em buscas |
| Watch | por conta | on = notificações de verificação ativas |

### Seções

**Bundles publicados**

Lista cronológica com:
- Data de publicação
- Estado: `verificado` / `desatualizado`
- URL pública
- Contagem de verificações
- Toggle de visibilidade individual
- Ação: revogar

**Notificações**

Feed de verificações recebidas — empresa, cargo, área, data (ver §7).

**Mensagens**

Feed de contatos recebidos de empresas + histórico de respostas enviadas (ver §9).

**Configurações de conta**

- Email de recuperação (editável)
- Email de contato (obrigatório para habilitar "Responder")
- Telefone de contato (obrigatório para habilitar "Responder")
- Toggle do diretório
- Toggle do watch
- Email de notificação (opcional — canal adicional)
- Webhook de notificação (opcional — canal adicional)

### Revogação de bundle

Revogar remove o bundle do portal — a URL retorna 404. Bundles locais não são afetados. A revogação é irreversível para aquela URL; um novo publish gera nova URL.

### Estado do botão "Responder" sem contato configurado

```
→ Configure email e telefone de contato para responder
   beheld.dev/dashboard/settings
```

Não bloqueia o dashboard — desabilita a ação com instrução clara.

---

## 5. Fluxo de upload — recrutador

`beheld.dev/verify` — página pública, sem login obrigatório

### Sem conta de empresa

```
1. recrutador acessa beheld.dev/verify
2. faz upload do arquivo .dpbundle
3. portal verifica assinatura Ed25519
4. perfil é renderizado na sessão
5. URL temporária de sessão gerada (não persistida)
6. nenhuma notificação enviada ao dev
```

O perfil é verificado e exibido. Sem conta, sem rastro para o dev.

### Com conta de empresa (logado)

```
1. recrutador acessa beheld.dev/verify (logado)
2. preenche contexto opcional:
   → Cargo da vaga (texto livre)
   → Área de interesse (texto livre)
3. faz upload do .dpbundle
4. portal verifica assinatura Ed25519
5. perfil renderizado
6. evento registrado → notificação gerada para o dev (se watch ativo)
7. botão "Entrar em contato" habilitado
```

### O que o portal verifica no bundle

- Assinatura Ed25519 válida
- Integridade do conteúdo (hash)
- Versão do engine compatível
- Estado do bundle: `verificado` ou `desatualizado`

A verificação é local ao browser via Web Crypto API — sem chamada adicional ao backend.

---

## 6. Conta de empresa

### Auth

Magic link — o recrutador informa o email cadastrado, recebe link de uso único (validade: 30 min), clica e autentica. Sem senha armazenada.

### Campos obrigatórios no cadastro

| Campo | Tipo |
|-------|------|
| Nome da empresa | texto |
| Email corporativo | email |

### Campos contextuais (preenchidos por upload)

| Campo | Tipo | Obrigatório |
|-------|------|-------------|
| Cargo da vaga | texto livre | não |
| Área de interesse | texto livre | não |

Campos por upload — a mesma empresa pode verificar devs para vagas diferentes com contextos diferentes.

### Acesso ao diretório

Empresas com conta têm acesso ao diretório pesquisável. O diretório retorna apenas devs com estado `encontravel` ativo.

---

## 7. Notificações

### Condição para gerar notificação

Todos os critérios devem ser atendidos:

1. Recrutador está logado com conta de empresa
2. Dev tem watch ativo
3. Bundle verificado pertence ao dev (fingerprint reconhecido)

Se qualquer condição falhar — sem notificação.

### O que a notificação exibe no dashboard do dev

```
Empresa verificou seu perfil

Acme Corp                    26/05/2026 · 14h32
Engenharia Backend · São Paulo
```

Apenas dado bruto. Sem copy celebratório.

### Canais

| Canal | Prioridade | Configuração |
|-------|------------|--------------|
| Portal (dashboard) | primário | automático quando watch ativo |
| Email | secundário | campo opcional em configurações |
| Webhook | terciário | URL configurável em configurações |

---

## 8. Diretório pesquisável

### Quem aparece

Devs com `encontravel = true` na conta e bundle não-revogado. Bundle desatualizado ainda aparece — badge visível.

### Filtros de busca (lado empresa)

| Filtro | Fonte do dado |
|--------|---------------|
| Linguagens dominantes | L2 sessions |
| Ecosystems | L1 + L2 |
| Test ratio (range) | L2 sessions |
| Janela de atividade | L2 sessions |
| Estado do perfil | `verificado` / `desatualizado` |

Busca por sinais reais — não por palavras-chave de CV.

### O que a empresa vê no resultado

- Nome / handle do dev
- Linguagens e ecosystems dominantes
- Test ratio
- Última atividade (mês/ano — não data exata)
- Estado do bundle
- Link para perfil público

O email do dev nunca aparece nos resultados. Contato é mediado pelo portal.

---

## 9. Contato mediado

O portal é a camada de matchmaking — conectou, sai do caminho.

### Fluxo — empresa envia mensagem

```
Empresa (logada) visualiza perfil do dev
→ clica "Entrar em contato"
→ formulário:
   Cargo da vaga    [___________________]
   Mensagem         [___________________]
→ Enviar
```

### Fluxo — dev recebe e responde

O dev vê no dashboard, seção Mensagens:

```
Acme Corp quer conversar

Engenharia Backend              26/05/2026 · 14h35
"Vimos seu perfil. Temos uma vaga de backend Python
em São Paulo. Interesse em conversar?"

→ Responder    → Ignorar
```

Ao clicar "Responder", o portal envia automaticamente para a empresa:

```
De: <handle do dev> (via beheld)

"Sim, tenho interesse. Meus contatos:

  email    dev@exemplo.com
  telefone +55 11 99999-9999"
```

Mensagem fixa — o dev não escreve nada, apenas confirma interesse. A partir daqui a conversa segue fora do portal.

### Regras do canal

| Regra | Motivo |
|-------|--------|
| Apenas empresas com conta podem enviar mensagem | evita spam anônimo |
| Dev responde ou ignora — sem obrigação | controle total do dev |
| Email e telefone do dev nunca expostos antes do "Responder" | privacidade |
| Histórico de mensagens recebidas visível no dashboard | registro completo |
| Histórico de respostas enviadas visível no dashboard | dev sabe o que foi compartilhado e com quem |

---

## 10. Modelo de dados

### Tabelas principais (portal — Rails)

```
accounts
  id                  uuid pk
  fingerprint         string unique     # chave pública Ed25519
  email_recovery      string nullable   # recuperação de conta
  email_contact       string nullable   # exposto ao responder
  phone_contact       string nullable   # exposto ao responder
  directory           boolean default false
  watch               boolean default false
  created_at          datetime

bundles
  id                  uuid pk
  account_id          uuid fk accounts
  url_slug            string unique     # /v/:slug
  published_at        datetime
  last_bundle_at      datetime          # atualizado a cada novo publish
  revoked_at          datetime nullable
  status              enum: verified | outdated | revoked

verifications
  id                  uuid pk
  bundle_id           uuid fk bundles
  company_id          uuid nullable fk companies
  job_title           string nullable
  area                string nullable
  verified_at         datetime

companies
  id                  uuid pk
  name                string
  email               string unique
  created_at          datetime

messages
  id                  uuid pk
  company_id          uuid fk companies
  account_id          uuid fk accounts
  job_title           string nullable
  body                text
  sent_at             datetime
  responded_at        datetime nullable
  ignored_at          datetime nullable
```

### Status do bundle (derivado)

```
status =
  revoked_at present               → revoked
  now - last_bundle_at > 30 days   → outdated
  otherwise                        → verified
```

---

## 11. Backlog por feature

### P7 — Publish flow

| ID | Item | Status |
|----|------|--------|
| P7.1 | `beheld --share` — upload bundle para portal | ⬜ |
| P7.2 | Prompt pós-geração explícito opt-in | ⬜ |
| P7.3 | Prompt de email de recuperação no primeiro publish | ⬜ |
| P7.4 | Falha de upload graciosa — bundle local preservado | ⬜ |
| P7.5 | URL pública gerada: `beheld.dev/v/<slug>` | ⬜ |
| P7.6 | Criação automática de conta no primeiro publish | ⬜ |

### P8 — Autenticação dev

| ID | Item | Status |
|----|------|--------|
| P8.1 | `beheld auth` — challenge/response com chave privada | ⬜ |
| P8.2 | Sessão estabelecida → redirect para dashboard | ⬜ |
| P8.3 | Fluxo de recuperação via email (`beheld.dev/recover`) | ⬜ |
| P8.4 | Rotação de chave — nova chave associada, antiga revogada | ⬜ |

### P9 — Dashboard dev

| ID | Item | Status |
|----|------|--------|
| P9.1 | Lista de bundles publicados com estado e contagem | ⬜ |
| P9.2 | Toggle de visibilidade por bundle | ⬜ |
| P9.3 | Toggle de diretório (por conta) | ⬜ |
| P9.4 | Toggle de watch (por conta) | ⬜ |
| P9.5 | Feed de notificações de verificação | ⬜ |
| P9.6 | Feed de mensagens recebidas + histórico de respostas | ⬜ |
| P9.7 | Configuração: email/telefone de contato obrigatórios | ⬜ |
| P9.8 | Configuração: email e webhook de notificação opcionais | ⬜ |
| P9.9 | Revogar bundle | ⬜ |
| P9.10 | Estado desabilitado do botão "Responder" sem contato configurado | ⬜ |

### P10 — Upload recrutador

| ID | Item | Status |
|----|------|--------|
| P10.1 | `beheld.dev/verify` — página pública de upload | ⬜ |
| P10.2 | Verificação Ed25519 no browser via Web Crypto API | ⬜ |
| P10.3 | Renderização do perfil pós-verificação | ⬜ |
| P10.4 | Campos contextuais opcionais para empresa logada | ⬜ |
| P10.5 | Registro do evento de verificação | ⬜ |
| P10.6 | Botão "Entrar em contato" habilitado após upload com conta | ⬜ |

### P11 — Conta de empresa

| ID | Item | Status |
|----|------|--------|
| P11.1 | Cadastro de empresa (nome + email) | ⬜ |
| P11.2 | Auth via magic link (validade 30 min) | ⬜ |
| P11.3 | Acesso ao diretório pesquisável | ⬜ |

### P12 — Notificações

| ID | Item | Status |
|----|------|--------|
| P12.1 | Geração de notificação no upload com conta identificada | ⬜ |
| P12.2 | Exibição no dashboard: empresa, cargo, área, data | ⬜ |
| P12.3 | Dispatch por email (se configurado) | ⬜ |
| P12.4 | Dispatch por webhook (se configurado) | ⬜ |

### P13 — Diretório

| ID | Item | Status |
|----|------|--------|
| P13.1 | Índice de devs encontráveis | ⬜ |
| P13.2 | Filtros: linguagens, ecosystems, test ratio, atividade, estado | ⬜ |
| P13.3 | Resultado sem expor email ou telefone do dev | ⬜ |
| P13.4 | Badge `desatualizado` visível nos resultados | ⬜ |

### P14 — Perfil público

| ID | Item | Status |
|----|------|--------|
| P14.1 | `beheld.dev/v/:slug` — renderização do bundle | ⬜ |
| P14.2 | Badge `verificado` / `desatualizado` dinâmico | ⬜ |
| P14.3 | 404 para bundle revogado | ⬜ |

### P15 — Contato mediado

| ID | Item | Status |
|----|------|--------|
| P15.1 | Formulário de contato (empresa → dev) | ⬜ |
| P15.2 | Entrega da mensagem no dashboard do dev | ⬜ |
| P15.3 | Ação "Responder" — envia email + telefone para empresa | ⬜ |
| P15.4 | Ação "Ignorar" — registra estado, sem notificação à empresa | ⬜ |
| P15.5 | Histórico de mensagens recebidas no dashboard | ⬜ |
| P15.6 | Histórico de respostas enviadas no dashboard | ⬜ |

---

## 12. Stop-and-ask conditions

O agente implementador deve parar e perguntar antes de prosseguir se:

- O modelo de dados precisar de migração destrutiva em tabelas existentes
- A lógica de status do bundle (`verified` / `outdated` / `revoked`) divergir do definido em §10
- O fluxo de recuperação de conta exigir armazenar a chave privada em qualquer forma
- Qualquer feature tentar expor email ou telefone do dev antes da ação "Responder"
- O prompt pós-geração for alterado para opt-out ou automático
- Qualquer mecanismo de cobrança for introduzido no lado do dev
- A mensagem de resposta do dev for alterada para texto livre (deve ser fixa)

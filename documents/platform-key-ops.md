# Platform Key — Operações de Segurança

> Esse documento descreve como a chave privada da plataforma Beheld —
> usada exclusivamente pra assinar attestations de identidade — é gerada,
> armazenada, rotacionada, e em quais condições migra pra infraestrutura
> mais robusta.
>
> Última atualização: 2026-05-19
> Owner atual: founder. Successor: ler doc inteiro antes de tocar qualquer chave.

---

## Propósito da chave

A platform key é um keypair Ed25519 dedicado, separado das chaves dos
desenvolvedores. Função única: assinar attestations que ligam uma public
key de dev a um GitHub username verificado via OAuth.

A chave NUNCA é usada pra:
- Assinar bundles de devs (cada dev tem sua própria chave)
- Autenticar requests HTTP entre serviços
- Cifrar dados (cifragem é responsabilidade do TLS na borda)

Se você está pensando em usar essa chave pra outra coisa, NÃO USE. Crie
uma chave nova com propósito separado. A separação de propósitos é o que
permite rotacionar uma sem afetar as outras.

---

## Estado atual (decisões em vigor)

| Item | Decisão | Quando revisar |
|------|---------|----------------|
| Algoritmo | Ed25519 | Quando NIST recomendar substituto (não previsto) |
| Armazenamento | Env var em produção + backup em password manager pessoal | Em cada trigger de upgrade (ver `Triggers de upgrade`) |
| Naming | `beheld-platform-{YYYY}-{Q1-4}` | Próxima rotação |
| Cadência de revisão | Trimestral | Continuamente |
| Public key publication | Commitada em `web/source/backend/keys/platform/` (fonte) + snapshot em `packages/cli/src/embedded-keys/` (offline verify). Exposta via `GET /api/platform-keys` | Permanente |
| Múltiplas chaves ativas | Suportado simultaneamente | Necessário pra janela de rotação |

Decisões explicitamente NÃO tomadas (e o porquê):

- **KMS (AWS/GCP)** — overkill pra MVP solo. Adiciona custo mensal,
  dependência cloud, e complexidade operacional que não compra nada
  enquanto o produto tem zero/poucos usuários. Migrar quando o trigger
  bater (ver abaixo).
- **HashiCorp Vault** — mesma análise do KMS, com adicional de
  auto-hospedagem que é trabalho desnecessário agora.
- **Sigstore Fulcio (signing certs efêmeros)** — opção "correta" no
  longo prazo, mas exige integração com OIDC e infraestrutura de CA.
  Considerar quando o produto for crítico o suficiente pra justificar.
- **HSM físico** — fora de escopo permanente pra MVP.
- **GitHub Actions secret** — inadequado: attestation é assinada em
  runtime (cada OAuth callback de dev), não em build time. A chave
  precisa estar viva no host de produção.

---

## Geração de uma nova chave

Executar em máquina pessoal confiável (não em servidor compartilhado,
não em VM efêmera de CI).

```sh
# Definir o key_id da rotação corrente
KEY_ID="beheld-platform-2026-q2"

# Gerar keypair Ed25519
openssl genpkey -algorithm Ed25519 -out "${KEY_ID}.priv.pem"

# Extrair public key
openssl pkey -in "${KEY_ID}.priv.pem" -pubout -out "${KEY_ID}.pub.pem"

# Converter pra raw bytes base64 (formato usado nas env vars e no commit)
openssl pkey -in "${KEY_ID}.priv.pem" -outform DER \
  | tail -c 32 | base64 > "${KEY_ID}.priv.b64"
openssl pkey -in "${KEY_ID}.pub.pem" -pubin -outform DER \
  | tail -c 32 | base64 > "${KEY_ID}.pub.b64"

# Calcular fingerprint pra referência
openssl pkey -in "${KEY_ID}.pub.pem" -pubin -outform DER \
  | tail -c 32 | openssl dgst -sha256 -hex
```

Validar com um teste de assinatura:

```sh
echo "test" | openssl pkeyutl -sign -inkey "${KEY_ID}.priv.pem" \
  | openssl pkeyutl -verify -pubin -inkey "${KEY_ID}.pub.pem" \
                    -sigfile /dev/stdin
# Esperar: "Signature Verified Successfully"
```

Imediatamente após gerar:

1. Apagar o terminal history que possa conter conteúdo dos arquivos:
   `history -c && history -w`
2. Mover os 4 arquivos pra pasta criptografada local
3. Backup imediato (ver seção `Backup`)

---

## Deployment inicial

**1. Commit da public key**

```sh
mkdir -p keys/platform
cp "${KEY_ID}.pub.b64" "keys/platform/${KEY_ID}.pub"
```

Adicionar `keys/platform/${KEY_ID}.info.json`:

```json
{
  "key_id": "beheld-platform-2026-q2",
  "algorithm": "ed25519",
  "created_at": "2026-05-19T14:00:00Z",
  "active": true,
  "revoked": false,
  "rotated_at": null
}
```

Garantir `.gitignore` em `keys/platform/`:

```
*.priv
*.priv.pem
*.priv.b64
*.key
```

Commit:

```sh
git add keys/platform/beheld-platform-2026-q2.pub
git add keys/platform/beheld-platform-2026-q2.info.json
git commit -m "feat(platform-key): rotate to beheld-platform-2026-q2"
```

**2. Configuração no backend de produção**

> **Deploy target — TBD (2026-05-19):** o host de produção do Rails ainda
> não foi escolhido (VPS próprio, provedor a definir). Os comandos abaixo
> são exemplos genéricos — substituir pelo mecanismo do host real assim
> que decidido (provavelmente `ssh` + arquivo de env vars persistido).

Definir env vars no host de produção:

```
BEHELD_PLATFORM_KEY_ID=beheld-platform-2026-q2
BEHELD_PLATFORM_PRIVATE_KEY=<conteúdo de beheld-platform-2026-q2.priv.b64>
```

Para um host genérico via SSH (ajustar caminho do env file conforme deploy):

```sh
ssh deploy@<host> "cat >> /etc/beheld/backend.env" <<EOF
BEHELD_PLATFORM_KEY_ID=beheld-platform-2026-q2
BEHELD_PLATFORM_PRIVATE_KEY=$(cat beheld-platform-2026-q2.priv.b64)
EOF
ssh deploy@<host> "systemctl restart beheld-backend"
```

**3. Validação pós-deploy**

```sh
# Verificar que o backend carregou a chave e public key bate
curl https://beheld.info/api/platform-keys | jq

# Esperar resposta incluindo:
# {
#   "key_id": "beheld-platform-2026-q2",
#   "public_key": "ed25519-pub:<conteúdo de .pub.b64>",
#   "active": true,
#   ...
# }
```

A `public_key` retornada DEVE bater com o conteúdo de `.pub.b64`. Se não
bater, ABORTAR e investigar — algo está errado na configuração.

---

## Backup da chave privada

Dois locais obrigatórios, ambos criptografados:

**Local 1 — Password manager pessoal**

- 1Password / Bitwarden / pass / equivalente
- Entry name: `Beheld Platform Key — {key_id}`
- Campo "password": conteúdo de `.priv.b64`
- Campo "notes": data de geração, fingerprint, hosts onde está deployada
- Sharing: NUNCA compartilhada (até existir co-founder com mesmo nível
  de acesso)

**Local 2 — Storage offline (recommended para MVP)**

- Pendrive criptografado guardado em local físico seguro
- Conteúdo: `.priv.pem` + `.pub.pem` + `info.json`
- Atualizar a cada rotação

NUNCA fazer:

- Backup em Google Drive / Dropbox sem cifra adicional
- Backup em repositório git (mesmo privado)
- Compartilhar via e-mail / Slack / qualquer canal
- Tirar foto da chave / printscreen
- Colar no chat de qualquer ferramenta de AI

---

## Rotação programada

Trigger: quarterly review (no fim de cada trimestre) OU quando aparecer
um motivo (suspeita, upgrade de infra, mudança organizacional).

### Procedimento (cerca de 30 dias do início ao retiro da chave antiga)

**T+0 — Geração e deploy paralelo**

1. Gerar nova chave seguindo `Geração de uma nova chave`
2. Atualizar `info.json` da chave antiga: `"rotated_at": "<timestamp>"`,
   mantém `"active": true` por enquanto
3. Commit da nova public key
4. Deploy do backend com a NOVA chave como ativa pra signing, mas mantendo
   a antiga na lista de `/api/platform-keys` como `active: true` ainda
5. A partir desse momento: novas attestations usam a chave nova; antigas
   continuam verificáveis com a antiga

**T+0 a T+30 — Janela de coexistência**

- Ambas as chaves listadas em `/api/platform-keys`
- Verifiers em campo (CLIs antigos, builds antigos) ainda funcionam — eles
  consultam o endpoint e ambas as keys estão lá
- Nenhuma ação adicional, apenas observar

**T+30 — Marcar antiga como inactive**

1. Atualizar `info.json` da chave antiga: `"active": false`
2. Commit + deploy
3. Endpoint `/api/platform-keys` continua retornando a antiga, mas com
   `active: false` — verifiers continuam validando attestations antigas

**Permanente — Chave antiga nunca é deletada da lista**

Chaves antigas permanecem listadas pra sempre, pra que attestations
antigas continuem verificáveis indefinidamente. O endpoint retorna
todas. Apenas a flag `active` muda.

### Validação pós-rotação

```sh
# Antigas attestations ainda devem verificar
curl -X POST https://beheld.info/api/attestation/verify \
  -H 'Content-Type: application/json' \
  -d @attestation-old.json
# Esperar: {"valid": true, "revoked": false}

# Novas attestations devem ser assinadas pela chave nova
# (verificar platform_key_id no retorno do POST /api/attestation/issue)
```

---

## Resposta a incidente (chave comprometida)

Se você suspeita que a private key foi exposta — laptop perdido,
backup vazado, env var leaked em log, qualquer indício — EXECUTAR
IMEDIATAMENTE, em ordem:

**Hora 0 — Conter**

1. Gerar nova chave (não esperar próxima rotação)
2. Deploy do backend com a chave nova como ativa
3. Atualizar `info.json` da chave comprometida:
   - `"active": false`
   - `"revoked": true`
   - `"revoked_at": "<timestamp>"`
   - `"revoked_reason": "<descrição breve>"`
4. Commit + deploy

**Hora 1 — Comunicar**

5. Postar incident report em `/status` (ou equivalente) listando:
   - Qual key_id foi revogada
   - Quando ocorreu
   - O que foi feito
6. Notificar usuários que têm attestations da chave revogada via
   email/CLI warning na próxima sync

**Hora 4 a 24 — Reissuance**

7. Endpoint `/api/attestation/reissue` (precisa existir como fallback)
   permite que devs com attestations revogadas refaçam o OAuth flow
   e obtenham uma nova attestation com a chave nova
8. Verifier passa a tratar attestations da chave revogada como:
   `⚠ Attestation revogada — pedir reissuance`
9. Atestações revogadas NÃO desaparecem do log do Rekor — Sigstore é
   append-only. O que muda é o status no `/api/attestation/verify`.

**Pós-incidente — Aprender**

10. Post-mortem: como a chave foi exposta, o que mudar pra não
    repetir, se o trigger de upgrade pra KMS deve ser adiantado.
11. Atualizar este documento com as lições.

---

## Diferença entre `active: false` e `revoked: true`

| Estado | Significado | Comportamento do verifier |
|--------|-------------|---------------------------|
| `active: true, revoked: false` | Chave atual, assinando novas attestations | Aceita normalmente |
| `active: false, revoked: false` | Aposentada por rotação programada | Aceita attestations antigas (chave era boa quando assinou) |
| `active: false, revoked: true` | Comprometida | ⚠ Avisa o verifier que attestations dessa chave precisam de reissuance |

Importante: rotação programada NÃO é revogação. Atestações de chaves
rotacionadas continuam válidas — apenas não emitimos mais com elas.
Atestações de chaves revogadas exigem ação do dev (reissuance).

### Cascade automática (F5.6.1)

Atestações **não** carregam `revoked` no próprio registro. O status é
derivado em tempo de verificação a partir do `info.json` da chave que
assinou:

| Estado da chave em `info.json` | `key_status` reportado pelo `/api/attestation/verify` |
|--------------------------------|-------------------------------------------------------|
| `active: true`                 | `active`                                              |
| `active: false, revoked: false`| `rotated`                                             |
| `active: false, revoked: true` | `revoked` (+ `revoked_reason`)                        |
| chave ausente do registro      | `unknown`                                             |

Conclusão operacional: pra revogar **todas** as atestações sob uma
chave comprometida, basta editar o `info.json` da chave (`active: false`,
`revoked: true`, `revoked_at`, `revoked_reason`), commitar e deployar.
A próxima chamada de `/verify` em qualquer atestação dessa chave já
reportará `key_status: revoked` sem nenhuma migration ou update bulk no
banco.

Pra inspecionar o impacto antes ou depois da edição, rodar no backend:

```sh
bin/rails platform_key:list_revoked_attestations
```

Lista cada chave revogada + GitHub login / user_id / fingerprint do dev
de cada atestação afetada — útil pra comunicar reissuance aos usuários.

---

## Triggers de upgrade de infra

Quando algum desses triggers bater, revisar este documento e considerar
migração pra KMS (AWS/GCP) ou Sigstore Fulcio:

1. **Volume**: > 10.000 attestations emitidas / mês
2. **Receita**: primeiro contrato Enterprise (>$1k/mês) assinado
3. **Time**: segundo engenheiro com acesso a produção
4. **Compliance**: cliente exigindo SOC 2 ou similar
5. **Risco**: qualquer suspeita de tentativa de comprometer a chave
6. **Tempo**: 12 meses desde a primeira chave em produção, mesmo sem
   nenhum dos triggers acima — pra evitar drift

Migração pra KMS, quando ocorrer, segue uma rotação especial:

- Gerar a próxima chave dentro do KMS (não localmente)
- Backend passa a assinar via KMS API em vez de env var
- Env var é removida do backend
- A chave nova nunca sai do KMS — backups passam a ser responsabilidade
  do provider cloud (com KMS automatic key rotation se disponível)
- Antigas chaves locais continuam em `/api/platform-keys` como
  `active: false` pra verificação histórica

---

## Audit trail

O que existe hoje pra acompanhar uso da chave:

- Log de cada `POST /api/attestation/issue` no backend (request log + response)
- Tabela `attestations` no banco com timestamp, fingerprint do dev,
  github_username
- `GET /api/platform-keys` mostra todas as chaves (histórico permanente)

O que NÃO existe ainda (e quando passa a ser obrigatório):

- HSM/KMS provider audit log (passa a existir automaticamente quando
  migrar pra KMS)
- Alertas em volume anormal de `POST /api/attestation/issue` (criar quando
  volume passar de 100/dia, pra detectar abuso/automação maliciosa)
- Detecção de fingerprints repetidos com múltiplos github_usernames
  (criar quando o produto for público o suficiente pra atrair tentativas)

---

## Checklist operacional

Para o owner atual da chave, revisar trimestralmente:

```
[ ] Public key publicada em GET /api/platform-keys (https://beheld.info/api/platform-keys) bate com web/source/backend/keys/platform/{key_id}.pub
[ ] Backup em password manager pessoal está atualizado
[ ] Backup offline (pendrive) está atualizado
[ ] Nenhum trigger de upgrade foi disparado
[ ] Nenhum incidente desde a última revisão
[ ] Próxima rotação programada está no calendário (90 dias)
[ ] Sucessor (se houver) tem acesso documentado
[ ] Este documento está atualizado com práticas correntes
```

---

## Para o sucessor (futuro)

Se você está lendo isso depois de assumir responsabilidade pela
plataforma Beheld e o owner anterior não está mais disponível
pra orientar:

1. Não rotacione a chave imediatamente sem entender. Atestações
   existentes precisam continuar verificáveis.
2. Acesse o backend de produção e confirme qual `key_id` está ativo
   (env var `BEHELD_PLATFORM_KEY_ID`).
3. Confirme que esse key_id existe em `web/source/backend/keys/platform/`
   do repo `beheld-web` com `active: true` em `info.json`.
4. Localize o backup da private key no password manager pessoal do
   owner anterior — esse acesso DEVE ter sido transferido como parte
   da sucessão. Se não foi, considere a chave atual potencialmente
   comprometida e siga `Resposta a incidente`.
5. Atualize este documento com a sua identidade como owner antes de
   fazer qualquer mudança operacional.

A continuidade da plataforma depende de você. A confiança que os devs
depositam no Beheld é construída em camadas, e a platform key é
uma dessas camadas. Trata com o cuidado que ela merece.

# Subdivisão: cli

- **Caminho**: `packages/cli`
- **Pacote**: `@beheld/cli` v0.4.1
- **Propósito**: o binário `beheld` que o dev instala — orquestra onboarding, geração de snapshot
  assinado, publicação no portal, e gestão de chaves Ed25519 e identidade GitHub.

## Stack interna

- Bun como runtime e bundler (`bun build src/index.ts --compile --outfile ../../dist/beheld`).
- `commander@12` (parser de comandos, `src/index.ts`), `@sigstore/sign@4` (attestation/Rekor),
  `qrcode-terminal`. Código próprio em `src/{auth,bundle,keys,install,config,supervisor,ui,storage,
  client,commands,i18n,lib,util}`.

## Comandos (de `src/index.ts`)

`bootstrap`, `init`, `harness {list,install}`, `start`, `stop`, `restart`, `status`, `doctor`,
`self-heal`, `view`, `attest`, `identity {link,status}`, `snapshot`, `list`, `share`, `auth`,
`verify <file>`, `keys {show,import,rotate}`, `import [url]`, `update`, `delete`, `migrate-legacy`,
`server` (inicia o MCP server — interno). `defaultDispatch` (`src/index.ts:359`) decide entre
`bootstrap` e `help` sem args.

## Entradas e saídas

- **Entrada**: argv; eventos JSONL em `~/.beheld/`; chaves Ed25519 locais; repos git (via `import`).
- **Saída**: `.beheld`/`.dpbundle` assinado; HTML de snapshot (`src/ui/snapshot-html.ts`);
  `POST /api/v1/bundles` (via `src/bundle/share.ts`); instala hooks/slash-commands nos harnesses.

## Dependências

- **→ engine**: embute o binário `beheld-engine` em `assets/beheld-engine`; fala HTTP `127.0.0.1:7338`.
  Extrai/cura via `src/engine-extractor.ts`.
- **→ mcp-server**: subcomando `beheld server`.
- **→ backend (repo `web`)**: publica bundles, autentica (`beheld auth` → challenge/response Ed25519).
- **Externas**: Sigstore Rekor (`BEHELD_REKOR_URL`); GitHub OAuth (via backend); harnesses locais.

## Estado de implementação: **Implementado**

Evidência: 34 arquivos de teste (`tests/`) cobrindo bootstrap, attestation, snapshot, share, keys,
identity, doctor, self-heal, e tails por harness. ~25 comandos.

### Débito visível

- `src/ui/snapshot-html.ts:1138` — `// TODO: real Ed25519 + sha256 verification using Web Crypto`:
  o HTML de snapshot standalone ainda **não** faz verificação cripto real (a real está no `web/frontend`).
- `assets/beheld-engine` é binário versionado dentro do package (whitelisted no `.gitignore`).

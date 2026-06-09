# Questões Abertas — daemon (decisão humana)

## 1. (ALTO) Versionamento sem fonte única de verdade
cli 0.4.1 / mcp-server 0.4.0 / engine pyproject 0.4.1 mas `packages/engine/src/api.py` VERSION
"0.1.1". **Decisão**: qual a versão "real"? A divergência engine 0.4.1 vs 0.1.1 parece bug de
atualização esquecida. Definir como as versões dos 3 runtimes do bundle se relacionam.

## 2. (ALTO) `packages/cli/assets/beheld-engine` — binário versionado no CLI
É o engine PyInstaller buildado, whitelisted no `.gitignore` (`!packages/cli/assets/beheld-engine`),
copiado por `scripts/build.sh`. **Decisão**: manter versionado (binário grande no git) ou buildar
sempre no CI? Hoje o build é local e pula silenciosamente se `pyinstaller` não estiver instalado.

## 3. (ALTO) Working tree parcialmente desmontado vs HEAD
O `git status` mostra ~30 arquivos rastreados **deletados do disco** (`README.md`, `package.json`,
`bun.lock`, `.gitignore`, `CHANGELOG.md`, `docs/`, `produto/`, `.github/workflows/`,
`beheld-refundacao-status.md`) e diretórios novos `app/`/`data/` como untracked. Como o `.gitignore`
sumiu do disco, artefatos (`node_modules/`, `.DS_Store`, `beheld-engine`) aparecem como untracked.
- `CLAUDE.md` foi **restaurado** de HEAD em 2026-06-09 (ver `CHANGELOG.md`).
**Decisão**: essa remoção foi intencional (refundação em andamento) ou acidental? Restaurar os
demais arquivos de HEAD (`git checkout HEAD -- .`) ou commitar a nova estrutura? **Não commitar
às cegas** — `git add -A` apagaria do repo todo o `docs/` e os meta-arquivos.

## 4. (MÉDIO) CI do daemon
Há `.github/workflows/{ci,release}.yml` em HEAD (deletados do disco). **Decisão**: confirmar que o
CI ainda roda `bun test` + pytest e build/release; restaurar os workflows se a remoção foi acidental.

## 5. (BAIXO) `app/` e `data/` na raiz do repo
`app/` está vazio (só `.DS_Store`); `data/` tem `state_store.db` + `stream_store/` (artefatos de
runtime do engine). **Decisão**: `app/` é resíduo a remover? `data/` deveria ser gitignored?

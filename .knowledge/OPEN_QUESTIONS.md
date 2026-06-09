# Questões Abertas — daemon (decisão humana)

## 1. (ALTO) Versionamento sem fonte única de verdade
cli 0.4.1 / mcp-server 0.4.0 / engine pyproject 0.4.1 mas `packages/engine/src/api.py` VERSION
"0.1.1". **Decisão**: qual a versão "real"? A divergência engine 0.4.1 vs 0.1.1 parece bug de
atualização esquecida. Definir como as versões dos 3 runtimes do bundle se relacionam.

## 2. (ALTO) `packages/cli/assets/beheld-engine` — binário versionado no CLI
É o engine PyInstaller buildado, whitelisted no `.gitignore` (`!packages/cli/assets/beheld-engine`),
copiado por `scripts/build.sh`. **Decisão**: manter versionado (binário grande no git) ou buildar
sempre no CI? Hoje o build é local e pula silenciosamente se `pyinstaller` não estiver instalado.

## 3. ~~(ALTO) Working tree parcialmente desmontado vs HEAD~~ — ✅ RESOLVIDO (2026-06-09)
**Resolvido pelo usuário: é uma REFUNDAÇÃO intencional em andamento, não acidente.** Os ~30
arquivos rastreados deletados do disco (`README.md`, `package.json`, `bun.lock`, `.gitignore`,
`CHANGELOG.md`, `docs/`, `produto/`, `.github/workflows/`, `beheld-refundacao-status.md`) foram
removidos de propósito; `app/` e `data/` são diretórios novos da estrutura sendo construída.
- **NÃO restaurar** de HEAD — a remoção é desejada.
- A nova estrutura será commitada pelo dono da refundação quando pronta. **Não commitar às cegas**
  (`git add -A` registraria as deleções antes da hora).
- ⚠️ O `CLAUDE.md` versionado (restaurado de HEAD) ainda descreve a estrutura **antiga**
  (`packages/` + `.github/` + `package.json` workspace Bun) — ficará desatualizado até a refundação
  concluir e ser re-documentada.

## 4. (MÉDIO) CI do daemon — sob a refundação (#3)
`.github/workflows/{ci,release}.yml` existem em HEAD mas foram removidos do disco como parte da
refundação. **Decisão**: a nova estrutura vai re-adicionar CI (`bun test` + pytest, build/release)?
Até lá, o repo público (HEAD) ainda carrega os workflows antigos.

## 5. (BAIXO) `app/` e `data/` na raiz do repo (parte da refundação — #3)
`app/` está vazio (só `.DS_Store`); `data/` tem `state_store.db` + `stream_store/` (artefatos de
runtime do engine). **Decisão**: na nova estrutura, `data/` deveria ser gitignored (são dados de runtime)?

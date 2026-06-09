# Changelog da Base de Conhecimento — daemon

## 2026-06-09 — Re-análise sob a refundação R1

Re-rodada a análise contra o estado atual (refundação R1 ativa). O `README.md` foi reescrito como
manifesto R1; usei-o como fonte de design e **verifiquei contra o código**:
- **Wire do bundle corrigido para `"7"`** (`models.py:234` + `cli/.../types.ts:18`; chaves
  `core`/`enrichment` + `capture_fidelity` por fonte). A versão anterior da `DOMAIN.md` dizia "v2".
- **Divergência de versão ampliada para 5 valores** (root 0.3.2 / cli 0.4.1 / mcp 0.4.0 / engine
  pyproject 0.4.1 / api.py 0.1.1) — `STATE.md` e `OPEN_QUESTIONS.md` #1.
- **Refundação mapeada**: mantido `README/package.json/packages/scripts`; removido (não-commitado)
  `docs/` (19), `produto/`, `.github/workflows`, `CHANGELOG.md`, `beheld-refundacao-status.md`.
- **Cruft novo**: `app/views/*` (pastas vazias, nomes do web backend) — `OPEN_QUESTIONS.md` #6.
- `OVERVIEW.md` ganhou a seção do modelo R1 (core/enrichment); `CLAUDE.md` ganhou banner R1.
- Subdivisões cli/engine/mcp-server seguem válidas (packages não mudaram estruturalmente).

## 2026-06-09 — Reorganização para dois repos

A base de conhecimento foi movida do nível guarda-chuva (`beheld-inc/.knowledge/`, que não era
repositório git) para **dentro do repo `daemon`**, refletindo a estrutura real: dois repositórios
independentes (`daemon` e `web`). O conteúdo web-específico foi para `web/.knowledge/`.

- Criada `daemon/.knowledge/` com escopo só do produto local: `OVERVIEW`, `SUBDIVISIONS`
  (cli, engine, mcp-server), `subdivisions/*`, `DOMAIN`, `CONFIG`, `STATE`, `OPEN_QUESTIONS`, `INDEX`.
- **`CLAUDE.md` restaurado de HEAD** (`git checkout HEAD -- CLAUDE.md`): o repo já tinha um guia de
  161 linhas que estava apagado do working tree. Mantido o original — não foi sobrescrito.
- Registrado em `OPEN_QUESTIONS.md` #3 o estado parcialmente desmontado do working tree (vários
  arquivos rastreados deletados do disco vs HEAD) — pendente de decisão humana, não commitar às cegas.

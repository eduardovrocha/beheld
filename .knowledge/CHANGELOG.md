# Changelog da Base de Conhecimento — daemon

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

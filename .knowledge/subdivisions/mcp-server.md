# Subdivisão: mcp-server

- **Caminho**: `packages/mcp-server`
- **Pacote**: `@beheld/mcp-server` v0.4.0
- **Propósito**: MCP server + daemon HTTP local que recebe hooks de telemetria de múltiplos
  harnesses de IA, sanitiza os eventos, e os grava em JSONL para o engine consumir. Expõe
  ferramentas MCP (`beheld`, `beheld_coach`, `beheld_status`) ao harness.

## Stack interna

- Bun/TS, `@modelcontextprotocol/sdk@1.29`. Dois modos: `server.ts` (HTTP daemon, `127.0.0.1`) e
  `stdio-server.ts` (transporte MCP via stdio).

## Ferramentas MCP (`server.ts`)

`beheld` (`tools/beheld-tool.ts`), `beheld_coach` (`tools/coach-tool.ts`), `beheld_status`
(`tools/status-tool.ts`). Protocolo: `initialize`, `tools/list`, `tools/call`.

## Hooks por harness (`src/hooks/`)

`claude-code`, `codex`, `continue`, `copilot-cli`, `copilot-vscode`, `cursor`, `gemini`,
`windsurf`. Endpoints: `POST /hook/{pre,post}-tool`, `/hook/gemini/{pre,post}-tool` (`server.ts:181-254`).

## Entradas e saídas

- **Entrada**: chamadas de hook dos harnesses (pre/post tool use) via HTTP local; requisições MCP `tools/call`.
- **Saída**: eventos JSONL via `writers/jsonl.ts` (consumidos pelo engine); dispara `/process`
  (`engine-trigger.ts`, `clients/engine-client.ts`); notificações (`notifications.ts`),
  contadores (`counters.ts`).
- **Sanitização**: `sanitizer.ts` remove dados sensíveis (comandos, paths) antes de gravar.

## Dependências

- **→ engine**: `clients/engine-client.ts` + `engine-trigger.ts`.
- **Quem depende**: `cli` (inicia via `beheld server`); os harnesses (via hooks instalados).
- **Externas**: filesystem (`~/.beheld/`, `BEHELD_DATA_DIR`); harnesses locais.

## Estado de implementação: **Implementado**

Evidência: 18 arquivos de teste cobrindo cada harness, sanitizer, counters, notifications, jsonl,
server, stdio-server, e as três tools.

### Débito visível

- Erros de tool engolidos com mensagem genérica `"Internal tool error"` (`server.ts:115`) —
  reduz observabilidade (decisão de privacidade).

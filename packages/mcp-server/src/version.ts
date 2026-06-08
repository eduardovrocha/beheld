/**
 * Single source of truth for the MCP server's version string.
 *
 * Importado por:
 *   - server.ts        → `serverInfo.version` no handshake MCP e payload de `/health`
 *   - stdio-server.ts  → `serverInfo.version` no transporte stdio
 *   - notifications.ts → comparação contra a versão mais recente vinda do
 *     backend (gatilho da notificação "update available")
 *
 * Bump no release: editar somente este arquivo. Mantém-se alinhado com
 * `packages/cli/src/version.ts` porque o `beheld doctor` reporta a versão
 * do CLI e a versão servida em `/health` lado a lado.
 */
export const VERSION = "0.4.1";

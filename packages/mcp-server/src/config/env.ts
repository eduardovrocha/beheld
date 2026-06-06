/**
 * Resolução de ambiente para o MCP server.
 *
 * Espelha `packages/cli/src/config/env.ts`. Mantido duplicado (em vez de
 * importar via path relativo cross-workspace) para preservar a fronteira
 * de workspace e poder publicar o MCP server independentemente no futuro.
 *
 * Comportamento idêntico:
 *   - BEHELD_ENV ∈ {production, development} (default production)
 *   - Overrides individuais: BEHELD_API_URL têm precedência
 */

export type BeheldEnv = "production" | "development";

const DEFAULTS = {
  production: { api: "https://beheld.dev" },
  development: { api: "http://localhost:3000" },
} as const;

function stripTrailing(url: string): string {
  return url.replace(/\/+$/, "");
}

export function getEnv(): BeheldEnv {
  const raw = process.env.BEHELD_ENV?.trim().toLowerCase();
  if (raw === "development" || raw === "dev" || raw === "local") {
    return "development";
  }
  return "production";
}

export function getApiBaseUrl(): string {
  const override = process.env.BEHELD_API_URL;
  if (override && override.trim() !== "") return stripTrailing(override);
  return DEFAULTS[getEnv()].api;
}

export function getApiUrl(): string {
  return `${getApiBaseUrl()}/api`;
}

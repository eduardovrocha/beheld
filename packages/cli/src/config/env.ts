/**
 * Resolução de ambiente para a CLI / MCP server.
 *
 * Uma variável global controla para qual backend remoto a CLI aponta:
 *
 *   BEHELD_ENV=production   → beheld.dev + rekor.sigstore.dev   (default)
 *   BEHELD_ENV=development  → localhost:3000 + rekor.sigstage.dev
 *
 * Default é `production` porque a CLI é distribuída via `curl | sh` para
 * devs externos — sem nenhuma config, ela precisa funcionar contra a
 * infra real. Apenas no desenvolvimento local (eu, o autor) é que se
 * exporta `BEHELD_ENV=development` para apontar ao Rails local.
 *
 * Overrides individuais por env continuam funcionando e têm precedência
 * sobre `BEHELD_ENV`:
 *
 *   process.env.BEHELD_API_URL    → sobrescreve API base
 *   process.env.BEHELD_PORTAL_URL → sobrescreve portal URL
 *   process.env.BEHELD_REKOR_URL  → sobrescreve Rekor URL
 *
 * Isso preserva todos os testes existentes que setam essas envs.
 *
 * Resolução é lazy (avaliada na chamada da função, não no top-level)
 * para que testes que setem env DEPOIS do import continuem funcionando.
 */

export type BeheldEnv = "production" | "development";

const DEFAULTS = {
  production: {
    api: "https://beheld.dev",
    portal: "https://beheld.dev",
    rekor: "https://rekor.sigstore.dev",
  },
  development: {
    api: "http://localhost:3000",
    portal: "http://localhost:3000",
    rekor: "https://rekor.sigstage.dev",
  },
} as const;

function stripTrailing(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Reads BEHELD_ENV from the environment. Defaults to `production`.
 *  Unknown values fall back to `production` silently so a typo never
 *  takes the CLI offline. */
export function getEnv(): BeheldEnv {
  const raw = process.env.BEHELD_ENV?.trim().toLowerCase();
  if (raw === "development" || raw === "dev" || raw === "local") {
    return "development";
  }
  return "production";
}

/** Base do backend Rails — install register, update, attest, delete,
 *  notifications, etc. Override por `BEHELD_API_URL`. */
export function getApiBaseUrl(): string {
  const override = process.env.BEHELD_API_URL;
  if (override && override.trim() !== "") return stripTrailing(override);
  return DEFAULTS[getEnv()].api;
}

/** Portal público (URLs de bundle, dashboard, auth). Geralmente igual à
 *  API base mas mantido separado para suportar split futuro. Override
 *  por `BEHELD_PORTAL_URL`. */
export function getPortalUrl(): string {
  const override = process.env.BEHELD_PORTAL_URL;
  if (override && override.trim() !== "") return stripTrailing(override);
  return DEFAULTS[getEnv()].portal;
}

/** Transparency log público. Override por `BEHELD_REKOR_URL`. */
export function getRekorUrl(): string {
  const override = process.env.BEHELD_REKOR_URL;
  if (override && override.trim() !== "") return stripTrailing(override);
  return DEFAULTS[getEnv()].rekor;
}

/** `<API>/api` — usado por subcomandos que falam com endpoints `/api/*`
 *  do Rails (update, install/register, notifications). */
export function getApiUrl(): string {
  return `${getApiBaseUrl()}/api`;
}

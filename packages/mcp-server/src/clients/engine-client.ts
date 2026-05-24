/**
 * Thin HTTP client for the local scoring engine, scoped to the surfaces the
 * MCP server needs. Kept narrow so each tool can wire only what it uses.
 *
 * The class shape exists so tests can construct an instance backed by a mock
 * `fetch` without monkey-patching globals.
 */

import type {
  ImportInitResponse,
  ImportStatusResponse,
} from "../types/import";
import type { StackResponse } from "../types/stack";

export const DEFAULT_ENGINE_URL =
  process.env.BEHELD_ENGINE_URL ?? "http://127.0.0.1:7338";

export interface EngineClientOptions {
  baseUrl?: string;
  /** Override `fetch` — primarily for testing. */
  fetchImpl?: typeof fetch;
}

export class EngineClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: EngineClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_ENGINE_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** GET /health — returns null if the engine is unreachable. */
  async health(): Promise<{ ok: boolean } | null> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (!res.ok) return null;
      return (await res.json()) as { ok: boolean };
    } catch {
      return null;
    }
  }

  /** POST /l1/import — kicks off ingestion and returns 202 immediately.
   *  Throws on non-2xx so the caller can surface a clear failure message. */
  async importRepository(
    repoUrl: string,
    authorEmail: string,
    pat: string | null,
  ): Promise<ImportInitResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/l1/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repo_url: repoUrl,
        author_email: authorEmail,
        pat: pat ?? null,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`engine POST /l1/import failed: ${res.status}`);
    }
    return (await res.json()) as ImportInitResponse;
  }

  /** GET /l1/import/status — single-slot, no job id. Throws on non-2xx. */
  async getImportStatus(): Promise<ImportStatusResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/l1/import/status`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      throw new Error(`engine GET /l1/import/status failed: ${res.status}`);
    }
    return (await res.json()) as ImportStatusResponse;
  }

  /** GET /l1/stack — language distribution + architecture patterns
   *  aggregated across all imported repos (F6.12b). Throws on non-2xx so the
   *  caller can fall back to an offline hint message. */
  async getStack(): Promise<StackResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/l1/stack`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      throw new Error(`engine GET /l1/stack failed: ${res.status}`);
    }
    return (await res.json()) as StackResponse;
  }
}

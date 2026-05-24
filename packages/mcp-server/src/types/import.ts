/**
 * Type contracts for the L1 repository import flow as exposed by the engine
 * (Phase 6, F6.4). The engine is a single-slot importer — there is no job_id;
 * progress is observable by polling `GET /l1/import/status`.
 *
 * These types are intentionally separate from the CLI's `L1ImportStatus` so the
 * MCP server stays self-contained and free of cross-package source coupling.
 */

/** Response to `POST /l1/import`. The engine returns 202 immediately and the
 *  rest of the lifecycle is observable via `getImportStatus()`. */
export interface ImportInitResponse {
  status: "processing";
  repo_url: string;
}

/** Terminal sub-status inside `ImportStatusResponse.result`. */
export type ImportResultStatus =
  | "imported"
  | "already_imported"
  | "author_not_found"
  | "needs_pat"
  | "clone_error";

/** Inner `result` payload — populated only when the import has reached a
 *  terminal state. Fields beyond `status` are best-effort; the formatter must
 *  treat them as optional. */
export interface ImportResult {
  status: ImportResultStatus;
  root_commit_hash?: string;
  commit_count?: number;
  detail?: string;
  ecosystems?: string[];
  test_ratio?: number;
  first_commit_at?: string;
  last_commit_at?: string;
}

/** Response to `GET /l1/import/status`. */
export interface ImportStatusResponse {
  status: "idle" | "processing" | "done" | "error";
  repo_url: string | null;
  progress_pct: number;
  result: ImportResult | null;
}

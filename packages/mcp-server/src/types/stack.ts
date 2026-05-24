/**
 * Type contracts for the L1 stack endpoint (F6.12b).
 *
 * Mirrors the shape returned by GET /l1/stack on the engine — see
 * packages/engine/src/storage/sqlite.py :: get_l1_stack(). Kept as a
 * dedicated module so the MCP server stays self-contained and the stack
 * formatter can import only what it needs.
 */

export interface LanguageEntry {
  language: string;
  commit_count: number;
  file_count: number;
  /** YYYY-MM only — the engine truncates the underlying ISO date. */
  first_seen: string;
  last_seen: string;
  /** Share of total_commits_analyzed, rounded to 1 decimal. */
  weight_pct: number;
}

export interface ArchitectureEntry {
  pattern: string;
  repo_count: number;
  confidence: "strong" | "weak";
}

export interface StackResponse {
  language_distribution: LanguageEntry[];
  architecture_patterns: ArchitectureEntry[];
  total_commits_analyzed: number;
  repos_analyzed: number;
}

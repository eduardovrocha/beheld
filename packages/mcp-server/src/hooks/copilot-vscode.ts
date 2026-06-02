/**
 * R2.5 — GitHub Copilot VS Code adapter (local_log_tail · tokens estimados).
 *
 * Copilot inside VS Code exposes no telemetry API. The adapter tails the
 * extension log directory:
 *
 *   macOS:  ~/Library/Application Support/Code/logs/.../exthost/GitHub.copilot/
 *   Linux:  ~/.config/Code/logs/.../exthost/GitHub.copilot/
 *
 * Each completion / inline-suggestion / chat-turn line becomes one
 * BeheldEvent. The CLI-side tail loop forwards parsed JSON to
 * `/hook/copilot-vscode/event`; this handler maps the four observable
 * event types — inline_suggestion, chat_request, code_completion,
 * session_end — into the canonical shape.
 *
 * TOKEN ESTIMATION:
 *   Copilot never echoes token counts. The adapter estimates them with a
 *   conservative chars/4 heuristic (roughly tokens for English source
 *   code; deliberately wrong-in-the-direction-of-too-low for non-Latin
 *   languages). The estimate goes into `metadata.tokens_estimated`
 *   alongside `metadata.estimated=true` so downstream classifiers can
 *   weight or discard. The prompt_length surfaced on the BeheldEvent is
 *   the raw character count — accurate, not estimated.
 *
 * Capture fidelity: `local_log_tail` (engine harness_registry.py). The
 * estimation caveat lives in per-event metadata, not the closed enum.
 *
 * Privacy invariants:
 *   - Logs may include suggestion/prompt fragments; the adapter ingests
 *     only counts (prompt_length, tokens_estimated) — never text.
 *   - File path → extension only.
 *   - Workspace folder hashed.
 */
import { createHash, randomUUID } from "crypto";
import { sanitize, sanitizeMetadata } from "../sanitizer";
import type { BeheldEvent } from "../types";

export interface CopilotVscodeEventPayload {
  /** "inline_suggestion" | "chat_request" | "code_completion" | "session_end". */
  event_type: string;
  session_id?: string;
  timestamp?: string;
  /** Raw character count of the user/prompt slice — never the text. */
  prompt_length?: number;
  /** Raw character count of the Copilot response — never the text. */
  response_length?: number;
  /** Path Copilot was suggesting against (extension extracted). */
  file_path?: string;
  /** VS Code workspace root absolute path (hashed). */
  workspace?: string;
  /** Round-trip duration for completions, when present in the log. */
  duration_ms?: number;
  /** Total chat turns at session end, when present. */
  total_turns?: number;
  /** Copilot model identifier, when the log carries it. */
  model?: string;
  metadata?: Record<string, unknown>;
}

function fileExtension(filePath?: string): string | undefined {
  if (!filePath || typeof filePath !== "string") return undefined;
  const parts = filePath.split(".");
  if (parts.length < 2) return undefined;
  const ext = parts[parts.length - 1];
  return ext.length > 0 && ext.length < 12 ? ext : undefined;
}

function cwdHash(cwd?: string): string | undefined {
  if (!cwd) return undefined;
  return createHash("sha256").update(cwd).digest("hex");
}

/**
 * Conservative chars/4 token estimate. Returns undefined when the input
 * char count is undefined or non-positive — never emits a fake zero.
 * Documented as ESTIMATED on every event via metadata.estimated=true.
 */
export function estimateTokens(chars: number | undefined): number | undefined {
  if (typeof chars !== "number" || chars <= 0) return undefined;
  // chars/4 is a well-known undercount for English source code (real
  // tokenisers average ~3.5 chars per token). Picking 4 keeps the
  // estimate conservative — better to under-report than over-report.
  return Math.max(1, Math.round(chars / 4));
}

/**
 * Maps a sanitised Copilot VS Code log line to a BeheldEvent.
 * Returns null on unknown event_types.
 */
export function handleCopilotVscodeEvent(body: unknown): BeheldEvent | null {
  const safe = sanitize(body) as CopilotVscodeEventPayload;
  if (!safe || typeof safe.event_type !== "string") return null;

  const base = {
    event_id: randomUUID(),
    session_id: safe.session_id ?? "copilot-vscode-session",
    source: "copilot-vscode" as const,
    timestamp: safe.timestamp ?? new Date().toISOString(),
    cwd_hash: cwdHash(safe.workspace),
  };

  // Annotate every event with the estimation caveat so downstream readers
  // can spot Copilot-VSC events without inspecting source strings.
  const estimationMeta: Record<string, unknown> = {
    estimated: true,
    estimation_method: "chars_div_4",
  };
  if (safe.model) estimationMeta.model = safe.model;

  switch (safe.event_type) {
    case "inline_suggestion": {
      const promptChars  = safe.prompt_length;
      const respChars    = safe.response_length;
      return {
        ...base,
        event_type: "inline_suggestion",
        file_extension: fileExtension(safe.file_path),
        prompt_length: promptChars,
        duration_ms: safe.duration_ms,
        metadata: {
          ...estimationMeta,
          tokens_estimated_prompt:   estimateTokens(promptChars),
          tokens_estimated_response: estimateTokens(respChars),
          ...sanitizeMetadata(safe.metadata ?? {}),
        },
      };
    }

    case "code_completion": {
      const promptChars = safe.prompt_length;
      const respChars   = safe.response_length;
      return {
        ...base,
        event_type: "code_completion",
        file_extension: fileExtension(safe.file_path),
        prompt_length: promptChars,
        duration_ms: safe.duration_ms,
        metadata: {
          ...estimationMeta,
          tokens_estimated_prompt:   estimateTokens(promptChars),
          tokens_estimated_response: estimateTokens(respChars),
          ...sanitizeMetadata(safe.metadata ?? {}),
        },
      };
    }

    case "chat_request": {
      const promptChars = safe.prompt_length;
      return {
        ...base,
        event_type: "chat_request",
        file_extension: fileExtension(safe.file_path),
        prompt_length: promptChars,
        duration_ms: safe.duration_ms,
        metadata: {
          ...estimationMeta,
          tokens_estimated_prompt: estimateTokens(promptChars),
          ...sanitizeMetadata(safe.metadata ?? {}),
        },
      };
    }

    case "session_end": {
      return {
        ...base,
        event_type: "stop",
        metadata: {
          ...estimationMeta,
          total_turns: safe.total_turns,
        },
      };
    }

    default:
      return null;
  }
}

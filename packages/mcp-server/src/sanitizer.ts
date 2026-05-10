const REDACTED = "<redacted>";

// Env vars with value — uses named backreference so closing quote matches opening
const ENV_VAR = /[A-Z_]{3,}=(?<q>["']?)[a-zA-Z0-9+/=_\-]{8,}\k<q>/g;
const ANTHROPIC_KEY = /sk-[a-zA-Z0-9]{32,}/g;
const GITHUB_TOKEN = /ghp_[a-zA-Z0-9]{36}/g;
const BEARER_TOKEN = /Bearer\s+[a-zA-Z0-9\-._~+/]+=*/g;
const PASSWORD = /password["']?\s*[:=]\s*["']?[^\s"']+/gi;
// Long "content" fields — replace key+value to preserve surrounding JSON structure
const CONTENT_FIELD = /"content"\s*:\s*"[^"]{50,}"/g;

const PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  { re: ENV_VAR, replacement: REDACTED },
  { re: ANTHROPIC_KEY, replacement: REDACTED },
  { re: GITHUB_TOKEN, replacement: REDACTED },
  { re: BEARER_TOKEN, replacement: REDACTED },
  { re: PASSWORD, replacement: REDACTED },
  // Keep the key intact so JSON stays valid; only the value is redacted
  { re: CONTENT_FIELD, replacement: `"content":"${REDACTED}"` },
];

function applyPatterns(s: string): string {
  let result = s;
  for (const { re, replacement } of PATTERNS) {
    result = result.replace(re, replacement);
  }
  return result;
}

/**
 * Sanitize any value.
 * Strings are sanitized in-place.
 * Numbers and booleans are returned unchanged.
 * Objects/arrays are serialized, sanitized, then re-parsed.
 */
export function sanitize(input: unknown): unknown {
  if (typeof input === "string") return applyPatterns(input);
  if (typeof input === "number" || typeof input === "boolean" || input === null) {
    return input;
  }
  try {
    const json = JSON.stringify(input);
    const sanitized = applyPatterns(json);
    return JSON.parse(sanitized);
  } catch {
    return input;
  }
}

/** Convenience wrapper for objects; returns the same type. */
export function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  return sanitize(obj) as Record<string, unknown>;
}

/** Hashes absolute paths and sanitizes secrets in a shell command string. */
export function sanitizeCommand(cmd: string): string {
  const withHashedPaths = cmd.replace(/\/[^\s"']+/g, (match) => {
    const filename = match.split("/").pop() ?? match;
    const hash = quickHash(match);
    return `[path:${hash}]/${filename}`;
  });
  return applyPatterns(withHashedPaths);
}

function quickHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).slice(0, 8);
}

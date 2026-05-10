const REDACTED = "[REDACTED]";

const REDACT_PATTERNS: RegExp[] = [
  /[A-Z_]{3,}=(?<q>["']?)[a-zA-Z0-9+/=_\-]{8,}\k<q>/g,
  /sk-[a-zA-Z0-9\-]{32,}/g,
  /ghp_[a-zA-Z0-9]{36}/g,
  /Bearer\s+[a-zA-Z0-9\-._~+/]+=*/g,
  /password["']?\s*[:=]\s*["']?[^\s"']+/gi,
];

export function sanitize(input: string): string {
  let result = input;
  for (const pattern of REDACT_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  return result;
}

export function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(sanitize(JSON.stringify(obj)));
}

export function sanitizeCommand(cmd: string): string {
  return sanitize(cmd.replace(/\/[^\s]+/g, (match) => {
    const parts = match.split("/");
    const filename = parts[parts.length - 1];
    const hash = hashPath(match);
    return `[path:${hash}]/${filename}`;
  }));
}

function hashPath(path: string): string {
  let h = 0;
  for (let i = 0; i < path.length; i++) {
    h = (Math.imul(31, h) + path.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).slice(0, 8);
}

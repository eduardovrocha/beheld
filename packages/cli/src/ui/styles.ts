// Shared visual vocabulary for CLI output. Every user-facing message line
// should compose with these helpers instead of hard-coding ANSI escapes —
// keeps the look consistent across commands and one place to swap themes.

export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const GREEN = "\x1b[32m";
export const RED = "\x1b[31m";
export const YELLOW = "\x1b[33m";
export const CYAN = "\x1b[36m";
export const BLUE = "\x1b[34m";

const ICON_OK = `${GREEN}✓${RESET}`;
const ICON_FAIL = `${RED}✗${RESET}`;
const ICON_WARN = `${YELLOW}⚠${RESET}`;
const ICON_ARROW = `${CYAN}→${RESET}`;
const ICON_DOT = `${GREEN}●${RESET}`;

/** Two-space leading indent + icon + message. */
export const ok = (msg: string): string => `  ${ICON_OK}  ${msg}`;
export const fail = (msg: string): string => `  ${ICON_FAIL}  ${msg}`;
export const warn = (msg: string): string => `  ${ICON_WARN}  ${msg}`;
export const arrow = (msg: string): string => `  ${ICON_ARROW}  ${msg}`;
export const dot = (msg: string): string => `  ${ICON_DOT}  ${msg}`;

/** Dim trailing annotation, e.g. `ok("MCP iniciado") + meta("porta 7337")`. */
export const meta = (text: string): string => `${DIM}${text}${RESET}`;
export const dim = meta; // alias — same wrapper, more readable in some contexts

/** Green inline text, e.g. for wizard checkmarks. */
export const green = (text: string): string => `${GREEN}${text}${RESET}`;

/**
 * Speaker mark — shown once at the top of every user-facing command so the
 * output reads as Beheld talking, not as anonymous CLI noise. The tagline
 * shifts the tone per command (e.g. "observando seu dia" for status,
 * "checando saúde" for doctor).
 *
 * Format: `  ▎ beheld  <tagline>` — bar in cyan, name in cyan bold,
 * tagline in dim.
 */
export const brand = (tagline: string): string =>
  `\n  ${CYAN}▎${RESET} ${CYAN}${BOLD}beheld${RESET}  ${DIM}${tagline}${RESET}\n`;


/** Section header — bold + blank line above. */
export const header = (title: string): string => `\n${BOLD}${title}${RESET}\n`;

/** A bold inline keyword inside otherwise-plain text. */
export const bold = (text: string): string => `${BOLD}${text}${RESET}`;

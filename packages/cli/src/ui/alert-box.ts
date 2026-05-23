import { YELLOW, BOLD, DIM, RESET } from "./styles";

const WIDTH = 56;

function visualLength(s: string): number {
  // Strip ANSI escape sequences for width calculation
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function pad(s: string, width: number): string {
  const visible = visualLength(s);
  return visible >= width ? s : s + " ".repeat(width - visible);
}

function line(content: string): string {
  return `│  ${pad(content, WIDTH - 4)}│`;
}

export interface Suggestion {
  label: string;
  command: string;
}

export interface AlertBoxOptions {
  title: string;
  body: string[];
  suggestions: Suggestion[];
}

export function renderAlertBox(opts: AlertBoxOptions): string {
  const top = "╭" + "─".repeat(WIDTH - 2) + "╮";
  const bot = "╰" + "─".repeat(WIDTH - 2) + "╯";
  const blank = line("");

  const out: string[] = [top, blank, line(`${YELLOW}⚠ ${BOLD}${opts.title}${RESET}`), blank];

  for (const ln of opts.body) {
    out.push(line(ln));
  }
  if (opts.suggestions.length > 0) {
    out.push(blank);
    const longest = Math.max(...opts.suggestions.map((s) => s.label.length));
    for (const s of opts.suggestions) {
      const padded = (s.label + ":").padEnd(longest + 2);
      out.push(line(`${DIM}${padded}${RESET}${BOLD}${s.command}${RESET}`));
    }
  }
  out.push(blank, bot);
  return out.join("\n");
}

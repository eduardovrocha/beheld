import { DIM, RESET } from "./styles";
import type { RemoteRepo } from "../types";

// ── public surface ──────────────────────────────────────────────────────────

export type SelectorKey =
  | "up"
  | "down"
  | "space"
  | "enter"
  | "a"
  | "n"
  | "q"
  | "ctrl-c";

export interface SelectorIO {
  write(s: string): void;
  /** Async iterator yielding one key event at a time. */
  keys(): AsyncIterator<SelectorKey>;
  setRawMode(enabled: boolean): void;
  /** Available rows on the terminal (rows below the prompt that we can paint). */
  rows(): number;
}

export interface SelectorDeps {
  io?: SelectorIO;
  /** URLs already in L1 — surfaced as [✓] and blocked from selection. */
  alreadyImportedUrls?: Set<string>;
}

/**
 * Interactive checkbox selector. Returns the URLs to clone (clone_url_ssh)
 * for repos the user confirmed. An empty array means: user cancelled (q) or
 * confirmed with nothing selected — caller decides what that means.
 *
 * Pure of side-effects beyond the injected IO; tests drive it with a fake.
 */
export async function selectRepos(
  repos: RemoteRepo[],
  deps: SelectorDeps = {},
): Promise<RemoteRepo[]> {
  const io = deps.io ?? defaultIO();
  const already = deps.alreadyImportedUrls ?? new Set<string>();

  const items = repos.map((r) => ({
    repo: r,
    selected: false,
    imported: already.has(r.clone_url_https) || already.has(r.clone_url_ssh),
  }));

  const availableCount = items.filter((i) => !i.imported).length;
  if (availableCount === 0) {
    io.write("Todos os repositórios já estão no L1.\n");
    return [];
  }

  io.setRawMode(true);
  try {
    let cursor = firstSelectable(items, 0);
    let scrollTop = 0;
    let cancelled = false;
    let confirmed = false;
    const keyIter = io.keys();

    paint(io, items, cursor, scrollTop);

    // Main loop — re-paint after each key event.
    while (!cancelled && !confirmed) {
      const next = await keyIter.next();
      if (next.done) break;
      const k = next.value;

      switch (k) {
        case "up": {
          const c = prevSelectable(items, cursor);
          if (c !== cursor) cursor = c;
          break;
        }
        case "down": {
          const c = nextSelectable(items, cursor);
          if (c !== cursor) cursor = c;
          break;
        }
        case "space": {
          const it = items[cursor];
          if (it && !it.imported) it.selected = !it.selected;
          break;
        }
        case "a":
          for (const it of items) if (!it.imported) it.selected = true;
          break;
        case "n":
          for (const it of items) it.selected = false;
          break;
        case "enter":
          confirmed = true;
          break;
        case "q":
        case "ctrl-c":
          cancelled = true;
          break;
      }

      const viewport = Math.max(1, io.rows() - 4);
      if (cursor < scrollTop) scrollTop = cursor;
      else if (cursor >= scrollTop + viewport) scrollTop = cursor - viewport + 1;

      paint(io, items, cursor, scrollTop);
    }

    io.write("\n");
    if (cancelled) return [];
    return items.filter((i) => i.selected && !i.imported).map((i) => i.repo);
  } finally {
    io.setRawMode(false);
  }
}

// ── cursor helpers ──────────────────────────────────────────────────────────

function firstSelectable(items: { imported: boolean }[], from: number): number {
  for (let i = from; i < items.length; i++) if (!items[i].imported) return i;
  for (let i = 0; i < from; i++) if (!items[i].imported) return i;
  return 0;
}

function nextSelectable(items: { imported: boolean }[], from: number): number {
  for (let i = from + 1; i < items.length; i++) if (!items[i].imported) return i;
  return from;
}

function prevSelectable(items: { imported: boolean }[], from: number): number {
  for (let i = from - 1; i >= 0; i--) if (!items[i].imported) return i;
  return from;
}

// ── rendering ───────────────────────────────────────────────────────────────

const CURSOR_HIDE = "[?25l";
const CURSOR_SHOW = "[?25h";

interface Row {
  repo: RemoteRepo;
  selected: boolean;
  imported: boolean;
}

function formatRow(r: Row, isCursor: boolean): string {
  const pointer = isCursor ? ">" : " ";
  const box = r.imported ? "[✓]" : r.selected ? "[x]" : "[ ]";
  const lang = r.repo.language ?? "—";
  const date = (r.repo.last_pushed_at ?? "").slice(0, 10) || "—";
  const lock = r.repo.is_private ? "🔒" : "  ";
  const name = r.repo.full_name.padEnd(40).slice(0, 40);
  const langPad = lang.padEnd(10).slice(0, 10);
  const tag = r.imported ? `  ${DIM}(já no L1)${RESET}` : "";
  const body = `${pointer} ${box} ${name} ${langPad} ${date} ${lock}${tag}`;
  return r.imported ? `${DIM}${body}${RESET}` : body;
}

let lastPaintHeight = 0;

function paint(
  io: SelectorIO,
  items: Row[],
  cursor: number,
  scrollTop: number,
): void {
  const viewport = Math.max(1, io.rows() - 4);
  const visible = items.slice(scrollTop, scrollTop + viewport);
  const totalSel = items.filter((i) => i.selected && !i.imported).length;
  const totalAvail = items.filter((i) => !i.imported).length;

  let buf = "";
  // Move the cursor up to overwrite the previous paint, then clear from
  // cursor to the end of screen — avoids ghost lines when the list shrinks.
  if (lastPaintHeight > 0) {
    buf += `[${lastPaintHeight}A`;
  }
  buf += "[0J";
  buf += CURSOR_HIDE;

  for (let i = 0; i < visible.length; i++) {
    const absoluteIndex = scrollTop + i;
    buf += formatRow(visible[i], absoluteIndex === cursor) + "\n";
  }
  const scrollHint =
    scrollTop > 0 || scrollTop + viewport < items.length
      ? `  ${DIM}(rolagem: ${scrollTop + 1}–${Math.min(items.length, scrollTop + viewport)} de ${items.length})${RESET}\n`
      : "";
  buf += scrollHint;
  buf +=
    `${DIM}↑↓ navegar · Espaço selecionar · a todos · n nenhum · Enter confirmar · q cancelar${RESET}\n`;
  buf += `${DIM}${totalSel} selecionados de ${totalAvail} disponíveis${RESET}\n`;
  buf += CURSOR_SHOW;

  io.write(buf);
  lastPaintHeight = visible.length + (scrollHint ? 1 : 0) + 2;
}

// ── default IO — real terminal ──────────────────────────────────────────────

function defaultIO(): SelectorIO {
  let rawSet = false;
  let listener: ((chunk: Buffer) => void) | null = null;
  let pending: SelectorKey[] = [];
  let resolveNext: ((k: IteratorResult<SelectorKey>) => void) | null = null;

  const decodeKey = (s: string): SelectorKey | null => {
    if (s === "") return "ctrl-c";
    if (s === "\r" || s === "\n") return "enter";
    if (s === " ") return "space";
    if (s === "q" || s === "Q") return "q";
    if (s === "a" || s === "A") return "a";
    if (s === "n" || s === "N") return "n";
    if (s === "k" || s === "K") return "up";
    if (s === "j" || s === "J") return "down";
    if (s === "[A") return "up";
    if (s === "[B") return "down";
    return null;
  };

  return {
    write(s: string): void {
      process.stdout.write(s);
    },
    rows(): number {
      const r = process.stdout.rows ?? 24;
      return r > 4 ? r : 24;
    },
    setRawMode(enabled: boolean): void {
      if (enabled && !rawSet) {
        process.stdin.setRawMode?.(true);
        process.stdin.resume();
        listener = (chunk: Buffer): void => {
          const s = chunk.toString("utf8");
          const key = decodeKey(s);
          if (key === null) return;
          if (resolveNext) {
            const r = resolveNext;
            resolveNext = null;
            r({ value: key, done: false });
          } else {
            pending.push(key);
          }
          if (key === "ctrl-c") {
            // Defensive: restore the terminal on Ctrl+C even if the caller
            // forgets to unwind cleanly.
            process.stdin.setRawMode?.(false);
            process.stdout.write(CURSOR_SHOW);
          }
        };
        process.stdin.on("data", listener);
        rawSet = true;
      } else if (!enabled && rawSet) {
        if (listener) process.stdin.off("data", listener);
        listener = null;
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdout.write(CURSOR_SHOW);
        rawSet = false;
      }
    },
    keys(): AsyncIterator<SelectorKey> {
      return {
        next(): Promise<IteratorResult<SelectorKey>> {
          if (pending.length > 0) {
            const k = pending.shift() as SelectorKey;
            return Promise.resolve({ value: k, done: false });
          }
          return new Promise((resolve) => {
            resolveNext = resolve;
          });
        },
      };
    },
  };
}

// ── exported test IO helper ─────────────────────────────────────────────────

/**
 * Build a SelectorIO that replays a scripted key sequence and captures all
 * writes into a buffer. Tests use this to drive the selector without a TTY.
 */
export function scriptedIO(
  keys: SelectorKey[],
  rows = 24,
): { io: SelectorIO; output: () => string; rawCalls: () => boolean[] } {
  let writes = "";
  const rawCalls: boolean[] = [];
  const queue = [...keys];

  const io: SelectorIO = {
    write(s: string): void {
      writes += s;
    },
    rows(): number {
      return rows;
    },
    setRawMode(enabled: boolean): void {
      rawCalls.push(enabled);
    },
    keys(): AsyncIterator<SelectorKey> {
      return {
        next(): Promise<IteratorResult<SelectorKey>> {
          if (queue.length === 0) {
            return Promise.resolve({ value: undefined as never, done: true });
          }
          const k = queue.shift() as SelectorKey;
          return Promise.resolve({ value: k, done: false });
        },
      };
    },
  };

  return { io, output: () => writes, rawCalls: () => rawCalls };
}

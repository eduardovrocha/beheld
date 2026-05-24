import { test, expect, describe } from "bun:test";

import {
  beheldTool,
  formatStackResponse,
  handleStack,
  type StackDeps,
} from "../src/tools/beheld-tool";
import type { EngineClient } from "../src/clients/engine-client";
import type {
  ArchitectureEntry,
  LanguageEntry,
  StackResponse,
} from "../src/types/stack";

// ── harness ──────────────────────────────────────────────────────────────────

interface MockEngineOpts {
  stack?: StackResponse | null;
  /** If true, getStack() throws — simulates engine offline. */
  stackThrows?: boolean;
}

interface MockEngine {
  client: StackDeps["engine"];
  stackCalls: number;
}

function makeEngine(opts: MockEngineOpts = {}): MockEngine {
  const m: MockEngine = {
    stackCalls: 0,
    client: {
      async getStack(): Promise<StackResponse> {
        m.stackCalls += 1;
        if (opts.stackThrows) throw new Error("network down");
        if (!opts.stack) {
          throw new Error("no stack configured in mock");
        }
        return opts.stack;
      },
    } as unknown as EngineClient,
  };
  return m;
}

const EMPTY_STACK: StackResponse = {
  language_distribution: [],
  architecture_patterns: [],
  total_commits_analyzed: 0,
  repos_analyzed: 0,
};

function lang(
  language: string,
  weight_pct: number,
  commit_count: number,
  opts: Partial<LanguageEntry> = {},
): LanguageEntry {
  return {
    language,
    commit_count,
    file_count: opts.file_count ?? commit_count * 4,
    first_seen: opts.first_seen ?? "2024-01",
    last_seen: opts.last_seen ?? "2026-05",
    weight_pct,
  };
}

function arch(
  pattern: string,
  confidence: "strong" | "weak",
  repo_count = 1,
): ArchitectureEntry {
  return { pattern, repo_count, confidence };
}

// ── handleStack ──────────────────────────────────────────────────────────────

describe("handleStack — wiring", () => {
  test("test_stack_action_calls_engine_get_stack", async () => {
    const engine = makeEngine({
      stack: {
        language_distribution: [lang("Ruby", 100, 5)],
        architecture_patterns: [],
        total_commits_analyzed: 5,
        repos_analyzed: 1,
      },
    });
    await handleStack({ engine: engine.client });
    expect(engine.stackCalls).toBe(1);
  });

  test("test_stack_action_engine_offline_returns_hint", async () => {
    const engine = makeEngine({ stackThrows: true });
    const out = await handleStack({ engine: engine.client });
    expect(out).toContain("Engine offline");
    expect(out).toContain("beheld start");
  });

  test("test_stack_action_no_repos_returns_import_hint", async () => {
    const engine = makeEngine({ stack: EMPTY_STACK });
    const out = await handleStack({ engine: engine.client });
    expect(out).toContain("Nenhum repositório importado");
    expect(out).toContain("/beheld import");
  });
});

// ── formatStackResponse ──────────────────────────────────────────────────────

describe("formatStackResponse — language table", () => {
  test("test_stack_format_renders_bar_proportionally", () => {
    const out = formatStackResponse({
      language_distribution: [
        lang("Ruby", 67, 1247),
        lang("Python", 22, 407),
        lang("TypeScript", 11, 198),
      ],
      architecture_patterns: [],
      total_commits_analyzed: 1852,
      repos_analyzed: 3,
    });

    // 67% of a 12-char bar → 8 filled blocks.
    const rubyMatch = out.match(/\| Ruby\s+\| (█+)(░+)/);
    expect(rubyMatch).not.toBeNull();
    expect(rubyMatch![1].length).toBe(8);
    expect(rubyMatch![2].length).toBe(4);

    // 11% → 1 filled block.
    const tsMatch = out.match(/\| TypeScript\s+\| (█+)(░+)/);
    expect(tsMatch).not.toBeNull();
    expect(tsMatch![1].length).toBe(1);
    expect(tsMatch![2].length).toBe(11);
  });

  test("test_stack_format_truncates_at_8_languages", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      lang(`Lang${i.toString().padStart(2, "0")}`, 10 - i * 0.5, 100 - i),
    );
    const out = formatStackResponse({
      language_distribution: many,
      architecture_patterns: [],
      total_commits_analyzed: 1000,
      repos_analyzed: 4,
    });

    // First 8 appear …
    for (let i = 0; i < 8; i++) {
      expect(out).toContain(`Lang${i.toString().padStart(2, "0")}`);
    }
    // 9th onwards do NOT appear in their own rows …
    expect(out).not.toContain("Lang08");
    expect(out).not.toContain("Lang11");
    // … but the overflow counter does.
    expect(out).toContain("e mais 4 linguagen");
  });

  test("test_stack_format_commits_formatted_with_thousand_separator", () => {
    const out = formatStackResponse({
      language_distribution: [lang("Ruby", 100, 1247)],
      architecture_patterns: [],
      total_commits_analyzed: 1247,
      repos_analyzed: 1,
    });
    // PT-BR uses "." as the thousands separator.
    expect(out).toContain("1.247");
    expect(out).not.toMatch(/\b1247\b/);
  });
});

describe("formatStackResponse — architecture section", () => {
  test("test_stack_format_strong_patterns_in_main_block", () => {
    const out = formatStackResponse({
      language_distribution: [lang("Go", 100, 50)],
      architecture_patterns: [
        arch("mvc", "strong", 4),
        arch("monorepo", "strong", 2),
        arch("ci_cd", "strong", 6),
      ],
      total_commits_analyzed: 50,
      repos_analyzed: 6,
    });

    // Strong labels — human-readable.
    expect(out).toContain("MVC");
    expect(out).toContain("Monorepo");
    expect(out).toContain("CI/CD");
    // Separated by · (middle dot).
    expect(out).toMatch(/MVC.*·.*Monorepo|Monorepo.*·.*MVC/);
    // Repo-count line cites the max across strong patterns (6).
    expect(out).toMatch(/Padrões detectados em 6 repositórios/);
  });

  test("test_stack_format_weak_patterns_in_secondary_block", () => {
    const out = formatStackResponse({
      language_distribution: [lang("Go", 100, 50)],
      architecture_patterns: [
        arch("mvc", "strong", 2),
        arch("serverless", "weak", 1),
        arch("event_driven", "weak", 1),
      ],
      total_commits_analyzed: 50,
      repos_analyzed: 2,
    });
    expect(out).toContain("MVC");
    expect(out).toContain("Indícios:");
    expect(out).toContain("Serverless");
    expect(out).toContain("Event-driven");
    // Weak labels must NOT appear in the main strong block.
    const indiciosIdx = out.indexOf("Indícios:");
    const serverlessIdx = out.indexOf("Serverless");
    expect(serverlessIdx).toBeGreaterThan(indiciosIdx);
  });

  test("test_stack_format_no_patterns_shows_fallback_message", () => {
    const out = formatStackResponse({
      language_distribution: [lang("Go", 100, 50)],
      architecture_patterns: [],
      total_commits_analyzed: 50,
      repos_analyzed: 1,
    });
    expect(out).toContain("Nenhum padrão de arquitetura identificado.");
    expect(out).not.toContain("Indícios:");
  });
});

// ── tool dispatch — backward compatibility ───────────────────────────────────

describe("beheldTool — action enum + dispatch", () => {
  test("test_action_enum_includes_stack", () => {
    const props = beheldTool.inputSchema.properties as Record<string, unknown>;
    const action = props.action as { enum: string[] };
    expect(action.enum).toContain("view");
    expect(action.enum).toContain("import");
    expect(action.enum).toContain("stack");
  });

  test("test_view_action_unaffected", () => {
    // The view enum and shape stay intact after the stack addition — schema
    // diffs catch a regression here.
    const props = beheldTool.inputSchema.properties as Record<string, unknown>;
    const view = props.view as { enum: string[] };
    expect(view.enum).toEqual(["summary", "scores", "insight", "full"]);
  });

  test("test_import_action_unaffected", () => {
    const props = beheldTool.inputSchema.properties as Record<string, unknown>;
    const url = props.url as { type: string };
    expect(url.type).toBe("string");
  });
});

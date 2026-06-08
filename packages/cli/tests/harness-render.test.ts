/**
 * Rendering tests for `beheld harness list` — covers the two-line layout
 * introduced after the user asked for an inline explanation per row
 * (commit 045cc7c). Companion to `harness-installer.test.ts`, which tests
 * the install/detect mechanics. Concerns split:
 *
 *   - harness-installer.test.ts → adapter registry shape + orchestration
 *   - harness-render.test.ts    → fidelity blurb + per-adapter description
 *                                 + composition of the dim explanation line
 */
import { test, expect, describe } from "bun:test";

import {
  buildHarnessRegistry,
  type CaptureFidelity,
  type HarnessAdapter,
} from "../src/lib/harness-installer";
import { __test as harnessInternals } from "../src/commands/harness";

const { FIDELITY_BLURB, explanationFor } = harnessInternals;

/** Strip ANSI so we can match against the literal copy. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Adapter factory for unit-testing the renderer. None of these dummies
 *  actually need install/uninstall; default the side-effect surface to
 *  no-ops and only override what the test cares about. */
function fakeAdapter(over: Partial<HarnessAdapter> & { fidelity: CaptureFidelity }): HarnessAdapter {
  return {
    name: "fake",
    label: "Fake",
    description: "fake adapter",
    isInstalled: () => false,
    install: () => ({ changed: false, wroteFile: false, requiresManualSetup: false }),
    uninstall: () => ({ changed: false }),
    ...over,
  };
}

// ── FIDELITY_BLURB exhaustiveness ────────────────────────────────────────

describe("FIDELITY_BLURB — generic explanation per fidelity tier", () => {
  // Closed enum mirrored from lib/harness-installer.ts. If a new value is
  // added to CaptureFidelity, this list MUST be updated AND FIDELITY_BLURB
  // must gain an entry — that's exactly the drift this test catches.
  const ALL_FIDELITIES: CaptureFidelity[] = [
    "native_hook",
    "editor_extension",
    "local_log_tail",
    "statusline",
    "inferred",
  ];

  test("declares a non-empty blurb for every CaptureFidelity value", () => {
    for (const f of ALL_FIDELITIES) {
      const blurb = FIDELITY_BLURB[f];
      expect(blurb).toBeDefined();
      expect(typeof blurb).toBe("string");
      expect(blurb.length).toBeGreaterThan(0);
    }
  });

  test("blurb has no leading/trailing whitespace (composition would break)", () => {
    for (const f of ALL_FIDELITIES) {
      const blurb = FIDELITY_BLURB[f];
      expect(blurb).toBe(blurb.trim());
    }
  });

  test("push vs pull semantics surface in the wording", () => {
    // Light contract — the blurb communicates whether the harness pushes
    // events OR the daemon pulls them. Caught regressions like copy/paste
    // mistakes that left two tiers with the same text.
    expect(FIDELITY_BLURB.native_hook).toContain("push");
    expect(FIDELITY_BLURB.editor_extension).toContain("push");
    expect(FIDELITY_BLURB.local_log_tail).toContain("pull");
    expect(FIDELITY_BLURB.statusline).toContain("pull");
  });
});

// ── explanationFor composition ────────────────────────────────────────────

describe("explanationFor — combines blurb + description", () => {
  test("description present → 'blurb · description', dim-wrapped, indented", () => {
    const adapter = fakeAdapter({
      fidelity: "native_hook",
      description: "PreToolUse/PostToolUse em ~/.claude/settings.json",
    });
    const raw = explanationFor(adapter);
    const clean = stripAnsi(raw);

    // Indent: six leading spaces — places the line under the row's name
    // column without crowding the table grid.
    expect(clean.startsWith("      ")).toBe(true);
    expect(clean).toContain(FIDELITY_BLURB.native_hook);
    expect(clean).toContain("PreToolUse/PostToolUse em ~/.claude/settings.json");
    expect(clean).toContain(" · ");
  });

  test("empty description → only the blurb (no trailing separator)", () => {
    const adapter = fakeAdapter({ fidelity: "local_log_tail", description: "" });
    const clean = stripAnsi(explanationFor(adapter));
    expect(clean).toContain(FIDELITY_BLURB.local_log_tail);
    expect(clean).not.toContain(" · ");
  });

  test("whitespace-only description → treated as empty", () => {
    const adapter = fakeAdapter({ fidelity: "statusline", description: "   \n  " });
    const clean = stripAnsi(explanationFor(adapter));
    expect(clean).toContain(FIDELITY_BLURB.statusline);
    expect(clean).not.toContain(" · ");
  });

  test("output is wrapped in ANSI dim — DIM marker present", () => {
    const adapter = fakeAdapter({ fidelity: "inferred" });
    const raw = explanationFor(adapter);
    // \x1b[2m is the DIM escape from ui/styles.ts. We assert presence —
    // exact ordering is a styling detail the test shouldn't pin down.
    expect(raw).toContain("\x1b[2m");
    expect(raw).toContain("\x1b[0m");
  });

  test("each fidelity value composes a distinct line (no silent fallthrough)", () => {
    // Regression for an early draft where FIDELITY_BLURB used `as const` and
    // a typo could let one fidelity inherit another's text.
    const lines = new Set<string>();
    for (const f of ["native_hook", "editor_extension", "local_log_tail", "statusline", "inferred"] as CaptureFidelity[]) {
      const adapter = fakeAdapter({ fidelity: f, description: "" });
      lines.add(stripAnsi(explanationFor(adapter)));
    }
    expect(lines.size).toBe(5);
  });
});

// ── Adapter description coverage — regression ─────────────────────────────

describe("HarnessAdapter.description — coverage in the registered registry", () => {
  // The point of this whole feature is that every row in `beheld harness
  // list` ships a sentence the user can read. If a future adapter is added
  // without a description, the type system enforces the field but doesn't
  // catch an empty string. This is the test that catches that.

  test("every registered adapter exposes a non-empty description", () => {
    const empty: string[] = [];
    for (const adapter of buildHarnessRegistry()) {
      if (adapter.description.trim().length === 0) empty.push(adapter.name);
    }
    expect(empty).toEqual([]);
  });

  test("description is plausibly informative — at least three words", () => {
    const tooShort: Array<{ name: string; description: string }> = [];
    for (const adapter of buildHarnessRegistry()) {
      const wordCount = adapter.description.trim().split(/\s+/).length;
      if (wordCount < 3) tooShort.push({ name: adapter.name, description: adapter.description });
    }
    expect(tooShort).toEqual([]);
  });

  test("descriptions are unique per adapter (no copy/paste of a sibling)", () => {
    const byDescription = new Map<string, string[]>();
    for (const adapter of buildHarnessRegistry()) {
      const list = byDescription.get(adapter.description) ?? [];
      list.push(adapter.name);
      byDescription.set(adapter.description, list);
    }
    const collisions = [...byDescription.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([desc, names]) => ({ desc, names }));
    expect(collisions).toEqual([]);
  });

  test("description does not leak ANSI escapes — styling lives in the renderer", () => {
    // The renderer wraps the description in DIM. If an adapter pre-applies
    // styling, the output gets doubled up. Keep the seam clean.
    const leaks: string[] = [];
    for (const adapter of buildHarnessRegistry()) {
      if (/\x1b\[/.test(adapter.description)) leaks.push(adapter.name);
    }
    expect(leaks).toEqual([]);
  });
});

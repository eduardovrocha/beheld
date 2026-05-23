import { test, expect, describe } from "bun:test";

import {
  BOOTSTRAP_PRIVACY_LINES,
  bootstrapScreen,
  type BootstrapScreenDeps,
} from "../src/ui/wizard";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeDeps(opts: {
  prompts?: string[];
  onImport?: (email: string) => void | Promise<void>;
}): {
  deps: BootstrapScreenDeps;
  logs: string[];
  importCalls: { email: string }[];
} {
  const prompts = [...(opts.prompts ?? [])];
  const logs: string[] = [];
  const importCalls: { email: string }[] = [];
  const deps: BootstrapScreenDeps = {
    async prompt(_q) {
      return prompts.shift() ?? "";
    },
    log(m) {
      logs.push(m);
    },
    async runImportLoop(authorEmail) {
      importCalls.push({ email: authorEmail });
      if (opts.onImport) await opts.onImport(authorEmail);
    },
  };
  return { deps, logs, importCalls };
}

// ── render + flow ────────────────────────────────────────────────────────────

describe("bootstrapScreen — Tela 3.5", () => {
  test("renders the screen after opt-in (header + three options)", async () => {
    const { deps, logs } = makeDeps({ prompts: ["3"] });
    await bootstrapScreen(deps);
    const out = logs.join("\n");
    expect(out).toContain("Beheld · Histórico git (opcional)");
    expect(out).toContain("[1] Importar agora");
    expect(out).toContain("[2] Importar depois");
    expect(out).toContain("[3] Pular");
  });

  test("includes both required privacy lines verbatim", async () => {
    const { deps, logs } = makeDeps({ prompts: ["3"] });
    await bootstrapScreen(deps);
    const out = logs.join("\n");
    for (const line of BOOTSTRAP_PRIVACY_LINES) {
      expect(out).toContain(line);
    }
  });

  test("option [1] asks for the commit email and enters the import loop", async () => {
    const { deps, logs, importCalls } = makeDeps({
      prompts: ["1", "dev@example.com"],
    });
    const result = await bootstrapScreen(deps);
    expect(result.choice).toBe("import_now");
    expect(result.author_email).toBe("dev@example.com");
    expect(importCalls).toEqual([{ email: "dev@example.com" }]);
    // No "execute depois" hint should show on [1].
    expect(logs.join("\n")).not.toContain("Execute beheld import quando quiser");
  });

  test("option [2] shows the 'execute later' message without importing", async () => {
    const { deps, logs, importCalls } = makeDeps({ prompts: ["2"] });
    const result = await bootstrapScreen(deps);
    expect(result.choice).toBe("later");
    expect(result.author_email).toBeUndefined();
    expect(importCalls.length).toBe(0);
    expect(logs.join("\n")).toContain("Ok. Execute beheld import quando quiser.");
  });

  test("option [3] skips silently (no later-hint, no import)", async () => {
    const { deps, logs, importCalls } = makeDeps({ prompts: ["3"] });
    const result = await bootstrapScreen(deps);
    expect(result.choice).toBe("skip");
    expect(result.author_email).toBeUndefined();
    expect(importCalls.length).toBe(0);
    expect(logs.join("\n")).not.toContain("Execute beheld import quando quiser");
  });

  test("empty / unrecognized input falls back to skip", async () => {
    const { deps, importCalls } = makeDeps({ prompts: [""] });
    const result = await bootstrapScreen(deps);
    expect(result.choice).toBe("skip");
    expect(importCalls.length).toBe(0);
  });

  test("option [1] without an email aborts and falls back to skip", async () => {
    const { deps, logs, importCalls } = makeDeps({ prompts: ["1", "   "] });
    const result = await bootstrapScreen(deps);
    expect(result.choice).toBe("skip");
    expect(importCalls.length).toBe(0);
    expect(logs.join("\n")).toContain("Email não informado");
  });
});

// ── coordination with the final config (author_email handoff) ────────────────

describe("bootstrapScreen — author_email handoff", () => {
  test("option [1] returns the email so initCommand can persist it", async () => {
    const { deps } = makeDeps({ prompts: ["1", "alice@example.com"] });
    const result = await bootstrapScreen(deps);
    expect(result.author_email).toBe("alice@example.com");
  });

  test("option [2] does not return any email (handoff stays empty)", async () => {
    const { deps } = makeDeps({ prompts: ["2"] });
    const result = await bootstrapScreen(deps);
    expect(result.author_email).toBeUndefined();
  });

  test("option [3] does not return any email (handoff stays empty)", async () => {
    const { deps } = makeDeps({ prompts: ["3"] });
    const result = await bootstrapScreen(deps);
    expect(result.author_email).toBeUndefined();
  });
});

import { test, expect, describe } from "bun:test";
import type { Step } from "../../src/install/types";
import type { Lang } from "../../src/i18n/install";

function captureWriter(): { write: (s: string) => void; out: () => string } {
  const buf: string[] = [];
  return {
    write: (s) => buf.push(s),
    out: () => buf.join(""),
  };
}

function mkStep(
  section: "preflight" | "install" | "verify",
  labelKey: string,
  isAction: boolean,
  ok: boolean,
  detail?: string,
  errorReason?: string,
): Step {
  return {
    section,
    labelKey,
    isAction,
    run: async () => ({ ok, detail, errorReason }),
  };
}

function envFor(lang: Lang, tty: boolean) {
  return { tty, color: false, lang, termWidth: 80 };
}

// ── Append-only: garantir que NÃO há redraw, alt buffer, ou cursor magic ────

describe("runInstall — append-only", () => {
  test("não emite nenhum escape de redraw ou alt buffer", async () => {
    const { runInstall } = await import("../../src/install/runner");
    const w = captureWriter();
    const steps = [
      mkStep("preflight", "install.preflight.platform", true, true),
      mkStep("install", "install.install.engine", true, true),
      mkStep("verify", "install.verify.mcp", false, true),
    ];
    await runInstall(steps, envFor("en", true), w);
    const out = w.out();
    // Sem clear screen, sem cursor home, sem alt buffer enter/leave,
    // sem cursor up. Output é puramente append-only.
    expect(out).not.toContain("\x1b[2J");
    expect(out).not.toContain("\x1b[0;0H");
    expect(out).not.toContain("\x1b[?1049h");
    expect(out).not.toContain("\x1b[?1049l");
    expect(out).not.toMatch(/\x1b\[\d+A/); // cursor up por N
  });

  test("opener aparece UMA vez (não é reprintado por step)", async () => {
    const { runInstall } = await import("../../src/install/runner");
    const w = captureWriter();
    const steps = [
      mkStep("preflight", "install.preflight.platform", true, true),
      mkStep("install", "install.install.engine", true, true),
      mkStep("verify", "install.verify.mcp", false, true),
    ];
    await runInstall(steps, envFor("en", true), w);
    const matches = w.out().match(/My name is B3H31D/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  test("section header impresso só na primeira ocorrência da seção", async () => {
    const { runInstall } = await import("../../src/install/runner");
    const w = captureWriter();
    const steps = [
      mkStep("preflight", "install.preflight.platform", true, true),
      mkStep("preflight", "install.preflight.dataDir", true, true),
      mkStep("install", "install.install.engine", true, true),
      mkStep("install", "install.install.start", true, true),
    ];
    await runInstall(steps, envFor("en", true), w);
    const preflightHeaders = w.out().match(/· pre-flight/g);
    const installHeaders = w.out().match(/· install/g);
    expect(preflightHeaders!.length).toBe(1);
    expect(installHeaders!.length).toBe(1);
  });

  test("cada step gera uma linha visível", async () => {
    const { runInstall } = await import("../../src/install/runner");
    const w = captureWriter();
    const steps = [
      mkStep("preflight", "install.preflight.platform", true, true, "darwin arm64"),
      mkStep("install", "install.install.engine", true, true, "(2.1s)"),
      mkStep("verify", "install.verify.mcp", false, true),
    ];
    await runInstall(steps, envFor("en", true), w);
    const out = w.out();
    expect(out).toContain("✓ platform");
    expect(out).toContain("darwin arm64");
    expect(out).toContain("✓ engine binary extracted");
    expect(out).toContain("(2.1s)");
    expect(out).toContain("✓ MCP server");
  });
});

// ── lang ─────────────────────────────────────────────────────────────────────

describe("runInstall — lang", () => {
  test("--lang pt-br produz PT-BR", async () => {
    const { runInstall } = await import("../../src/install/runner");
    const w = captureWriter();
    const steps = [
      mkStep("preflight", "install.preflight.platform", true, true),
      mkStep("verify", "install.verify.mcp", false, true),
    ];
    await runInstall(steps, envFor("pt-br", true), w);
    const out = w.out();
    expect(out).toContain("Meu nome é B3H31D");
    expect(out).toContain("pré-flight");
    expect(out).toContain("verificação");
    expect(out).toContain("Pronto. Estou de olho.");
  });

  test("default EN", async () => {
    const { runInstall } = await import("../../src/install/runner");
    const w = captureWriter();
    const steps = [mkStep("preflight", "install.preflight.platform", true, true)];
    await runInstall(steps, envFor("en", true), w);
    const out = w.out();
    expect(out).toContain("My name is B3H31D");
    expect(out).toContain("pre-flight");
    expect(out).toContain("Done. I'm watching.");
  });
});

// ── Short-circuit em pré-flight / install ────────────────────────────────────

describe("runInstall — short-circuit", () => {
  test("falha em pré-flight aborta steps subsequentes de install", async () => {
    const { runInstall } = await import("../../src/install/runner");
    let installRan = false;
    const steps: Step[] = [
      mkStep("preflight", "install.preflight.platform", true, true),
      {
        section: "preflight",
        labelKey: "install.preflight.dataDir",
        isAction: true,
        run: async () => ({ ok: false, errorReason: "EACCES" }),
      },
      {
        section: "install",
        labelKey: "install.install.engine",
        isAction: true,
        run: async () => {
          installRan = true;
          return { ok: true };
        },
      },
    ];
    const w = captureWriter();
    const report = await runInstall(steps, envFor("en", true), w);
    expect(installRan).toBe(false);
    expect(report.succeeded).toBe(false);
    expect(report.errors).toHaveLength(1);
    // Como install não rodou, o header de install nem aparece.
    expect(w.out()).not.toContain("· install\n");
  });

  test("verify NÃO aborta na primeira falha — todos rodam até o fim", async () => {
    const { runInstall } = await import("../../src/install/runner");
    let v2Ran = false;
    let v3Ran = false;
    const steps: Step[] = [
      {
        section: "verify",
        labelKey: "install.verify.mcp",
        isAction: false,
        run: async () => ({ ok: false, errorReason: "timeout" }),
      },
      {
        section: "verify",
        labelKey: "install.verify.engine",
        isAction: false,
        run: async () => {
          v2Ran = true;
          return { ok: true };
        },
      },
      {
        section: "verify",
        labelKey: "install.verify.autostart",
        isAction: false,
        run: async () => {
          v3Ran = true;
          return { ok: true };
        },
      },
    ];
    const w = captureWriter();
    const report = await runInstall(steps, envFor("en", true), w);
    expect(v2Ran).toBe(true);
    expect(v3Ran).toBe(true);
    expect(report.errors).toHaveLength(1);
    expect(report.succeeded).toBe(false);
  });
});

// ── Closer ───────────────────────────────────────────────────────────────────

describe("runInstall — closer", () => {
  test("succeeded → closer de sucesso", async () => {
    const { runInstall } = await import("../../src/install/runner");
    const w = captureWriter();
    await runInstall(
      [mkStep("preflight", "install.preflight.platform", true, true)],
      envFor("en", true),
      w,
    );
    expect(w.out()).toContain("Done. I'm watching.");
    expect(w.out()).not.toContain("reported error");
  });

  test("error parcial → closer com label do primeiro error", async () => {
    const { runInstall } = await import("../../src/install/runner");
    const w = captureWriter();
    const steps: Step[] = [
      {
        section: "verify",
        labelKey: "install.verify.engine",
        isAction: false,
        run: async () => ({ ok: false, errorReason: "timeout :7338" }),
      },
    ];
    await runInstall(steps, envFor("en", true), w);
    expect(w.out()).toContain("Scoring engine reported error");
  });
});

// ── overrideLabel ────────────────────────────────────────────────────────────

describe("overrideLabel", () => {
  test("substitui o label padrão sem concatenação", async () => {
    const { runInstall } = await import("../../src/install/runner");
    const w = captureWriter();
    const steps: Step[] = [
      {
        section: "install",
        labelKey: "install.install.start",
        isAction: true,
        run: async () => ({ ok: true, overrideLabel: "Daemons já em execução" }),
      },
    ];
    await runInstall(steps, envFor("pt-br", true), w);
    expect(w.out()).toContain("Daemons já em execução");
    expect(w.out()).not.toContain("daemons iniciados Daemons");
  });
});

// ── InstallReport ────────────────────────────────────────────────────────────

describe("runInstall — InstallReport", () => {
  test("errors lista step states em ordem", async () => {
    const { runInstall } = await import("../../src/install/runner");
    const steps: Step[] = [
      {
        section: "verify",
        labelKey: "install.verify.mcp",
        isAction: false,
        run: async () => ({ ok: false, errorReason: "A" }),
      },
      mkStep("verify", "install.verify.engine", false, true),
      {
        section: "verify",
        labelKey: "install.verify.autostart",
        isAction: false,
        run: async () => ({ ok: false, errorReason: "B" }),
      },
    ];
    const w = captureWriter();
    const report = await runInstall(steps, envFor("en", true), w);
    expect(report.errors.length).toBe(2);
    expect(report.errors[0]!.step.labelKey).toBe("install.verify.mcp");
    expect(report.errors[1]!.step.labelKey).toBe("install.verify.autostart");
  });
});

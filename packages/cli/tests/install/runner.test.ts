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

// ── Sequência de escritas (não-TTY mode) ─────────────────────────────────────

describe("runInstall — non-TTY", () => {
  test("uma linha por step + opener + closer", async () => {
    const { runInstall } = await import("../../src/install/runner");
    const w = captureWriter();
    const steps = [
      mkStep("preflight", "install.preflight.platform", true, true),
      mkStep("install", "install.install.engine", true, true, "(1.2s)"),
      mkStep("verify", "install.verify.mcp", false, true),
    ];
    const report = await runInstall(steps, envFor("en", false), w);
    const lines = w.out().split("\n").filter((l) => l.length > 0);
    // Opener + header + 3 step lines + closer = 6
    expect(lines.length).toBeGreaterThanOrEqual(5);
    expect(w.out()).toContain("My name is B3H31D");
    expect(w.out()).toContain("[1/3]");
    expect(w.out()).toContain("[2/3]");
    expect(w.out()).toContain("[3/3]");
    expect(report.succeeded).toBe(true);
  });

  test("--lang pt-br produz PT-BR", async () => {
    const { runInstall } = await import("../../src/install/runner");
    const w = captureWriter();
    const steps = [mkStep("preflight", "install.preflight.platform", true, true)];
    await runInstall(steps, envFor("pt-br", false), w);
    expect(w.out()).toContain("Meu nome é B3H31D");
    expect(w.out()).toContain("pré-flight");
    expect(w.out()).toContain("instalado");
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
    const report = await runInstall(steps, envFor("en", false), w);
    expect(installRan).toBe(false);
    expect(report.succeeded).toBe(false);
    expect(report.errors).toHaveLength(1);
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
    const report = await runInstall(steps, envFor("en", false), w);
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
      envFor("en", false),
      w,
    );
    expect(w.out()).toContain("installed.");
    expect(w.out()).not.toContain("with errors");
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
    await runInstall(steps, envFor("en", false), w);
    expect(w.out()).toContain("with errors");
  });
});

// ── TTY mode — cursor magic ─────────────────────────────────────────────────

describe("runInstall — TTY mode", () => {
  test("emite full-screen clear + cursor home entre redraws", async () => {
    const { runInstall } = await import("../../src/install/runner");
    const w = captureWriter();
    const steps = [
      mkStep("preflight", "install.preflight.platform", true, true),
      mkStep("install", "install.install.engine", true, true),
    ];
    await runInstall(steps, envFor("en", true), w);
    // \x1b[2J = clear screen, \x1b[0;0H = cursor home. Aparece N+1 vezes
    // (initial draw + 1 por step). Garante reinício do viewport a cada redraw.
    const matches = w.out().match(/\x1b\[2J\x1b\[0;0H/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(steps.length + 1);
  });

  test("opener é reprintado a cada redraw (vive no clear-screen loop)", async () => {
    const { runInstall } = await import("../../src/install/runner");
    const w = captureWriter();
    const steps = [
      mkStep("preflight", "install.preflight.platform", true, true),
      mkStep("install", "install.install.engine", true, true),
    ];
    await runInstall(steps, envFor("en", true), w);
    const openerMatches = w.out().match(/My name is B3H31D/g);
    // Initial draw + 2 redraws (1 por step) = 3
    expect(openerMatches).not.toBeNull();
    expect(openerMatches!.length).toBe(steps.length + 1);
  });

  test("TTY com lang pt-br ainda usa voz B3 PT-BR", async () => {
    const { runInstall } = await import("../../src/install/runner");
    const w = captureWriter();
    await runInstall(
      [mkStep("preflight", "install.preflight.platform", true, true)],
      envFor("pt-br", true),
      w,
    );
    expect(w.out()).toContain("Meu nome é B3H31D");
    expect(w.out()).toContain("Pronto. Estou de olho.");
  });
});

// ── InstallReport ────────────────────────────────────────────────────────────

describe("runInstall — InstallReport", () => {
  test("errors lista step states com status=error em ordem", async () => {
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
    const report = await runInstall(steps, envFor("en", false), w);
    expect(report.errors.length).toBe(2);
    expect(report.errors[0]!.step.labelKey).toBe("install.verify.mcp");
    expect(report.errors[1]!.step.labelKey).toBe("install.verify.autostart");
  });
});

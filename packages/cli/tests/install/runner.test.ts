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
  test("entra e sai do alternate screen buffer no caminho TTY", async () => {
    const { runInstall } = await import("../../src/install/runner");
    const w = captureWriter();
    const steps = [mkStep("preflight", "install.preflight.platform", true, true)];
    await runInstall(steps, envFor("en", true), w);
    const out = w.out();
    // Enter alt: \x1b[?1049h, esconde cursor: \x1b[?25l
    expect(out).toContain("\x1b[?1049h");
    expect(out).toContain("\x1b[?25l");
    // Sai do alt: \x1b[?1049l, mostra cursor: \x1b[?25h
    expect(out).toContain("\x1b[?1049l");
    expect(out).toContain("\x1b[?25h");
    // Ordem: enter precede leave
    expect(out.indexOf("\x1b[?1049h")).toBeLessThan(out.indexOf("\x1b[?1049l"));
  });

  test("scrollback fica com UMA ocorrência do snapshot final, não N", async () => {
    const { runInstall } = await import("../../src/install/runner");
    const w = captureWriter();
    const steps = [
      mkStep("preflight", "install.preflight.platform", true, true),
      mkStep("install", "install.install.engine", true, true),
      mkStep("verify", "install.verify.mcp", false, true),
    ];
    await runInstall(steps, envFor("en", true), w);
    const out = w.out();
    // O snapshot final + closer são escritos APÓS o leave-alt-buffer.
    // Pegamos só o que vem depois do leave — isso é o que vai pro scrollback.
    const leaveIdx = out.indexOf("\x1b[?1049l");
    expect(leaveIdx).toBeGreaterThan(-1);
    const postLeave = out.slice(leaveIdx);
    // Opener aparece UMA vez no scrollback (o final summary).
    const openerMatches = postLeave.match(/My name is B3H31D/g);
    expect(openerMatches).not.toBeNull();
    expect(openerMatches!.length).toBe(1);
  });

  test("dentro do alt buffer, opener é reprintado a cada redraw", async () => {
    const { runInstall } = await import("../../src/install/runner");
    const w = captureWriter();
    const steps = [
      mkStep("preflight", "install.preflight.platform", true, true),
      mkStep("install", "install.install.engine", true, true),
    ];
    await runInstall(steps, envFor("en", true), w);
    const out = w.out();
    // Total ocorrências do opener: initial draw + N steps redraws + final
    // summary no buffer normal = N + 2.
    const matches = out.match(/My name is B3H31D/g);
    expect(matches!.length).toBe(steps.length + 2);
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

// ── overrideLabel ────────────────────────────────────────────────────────────

describe("overrideLabel", () => {
  test("substitui o label padrão do step quando o run retorna overrideLabel", async () => {
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
    await runInstall(steps, envFor("pt-br", false), w);
    expect(w.out()).toContain("Daemons já em execução");
    // O label padrão NÃO deve aparecer junto.
    expect(w.out()).not.toContain("daemons iniciados Daemons já em execução");
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

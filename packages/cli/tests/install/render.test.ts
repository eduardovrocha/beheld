import { test, expect, describe } from "bun:test";

// ── renderActionStep (pure) ──────────────────────────────────────────────────

describe("renderActionStep", () => {
  test("ok + detail (no color)", async () => {
    const { renderActionStep } = await import("../../src/install/render");
    expect(
      renderActionStep({ ok: true, label: "engine binary extracted", detail: "(2.1s)", color: false }),
    ).toBe("    ✓ engine binary extracted (2.1s)");
  });

  test("error (no color)", async () => {
    const { renderActionStep } = await import("../../src/install/render");
    expect(
      renderActionStep({ ok: false, label: "LaunchAgent registration failed", color: false }),
    ).toBe("    ✗ LaunchAgent registration failed");
  });

  test("pending (null) → ellipsis (no color)", async () => {
    const { renderActionStep } = await import("../../src/install/render");
    expect(
      renderActionStep({ ok: null, label: "engine binary extracted", color: false }),
    ).toBe("    … engine binary extracted");
  });

  test("ok with color includes BRONZE escape and RESET", async () => {
    const { renderActionStep, BRONZE } = await import("../../src/install/render");
    const out = renderActionStep({ ok: true, label: "ok", color: true });
    expect(out).toContain(BRONZE);
    expect(out).toContain("\x1b[0m");
  });
});

// ── renderSectionHeader ──────────────────────────────────────────────────────

describe("renderSectionHeader", () => {
  test("sem cor", async () => {
    const { renderSectionHeader } = await import("../../src/install/render");
    expect(renderSectionHeader("pre-flight", false)).toBe("  · pre-flight");
  });

  test("com cor usa bronze no dot", async () => {
    const { renderSectionHeader, BRONZE } = await import("../../src/install/render");
    const out = renderSectionHeader("pre-flight", true);
    expect(out).toContain(BRONZE);
    expect(out).toContain("pre-flight");
  });
});

// ── renderStepCompletion ─────────────────────────────────────────────────────

describe("renderStepCompletion", () => {
  test("step ok → 1 linha", async () => {
    const { renderStepCompletion } = await import("../../src/install/render");
    const state = {
      step: {
        section: "install" as const,
        labelKey: "install.install.engine",
        isAction: true,
        run: async () => ({ ok: true }),
      },
      status: "ok" as const,
      result: { ok: true, detail: "(2.1s)" },
    };
    const lines = renderStepCompletion(state, { tty: true, color: false, lang: "en", termWidth: 80 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("✓");
    expect(lines[0]).toContain("engine binary extracted");
    expect(lines[0]).toContain("(2.1s)");
  });

  test("step error com reason → 2 linhas", async () => {
    const { renderStepCompletion } = await import("../../src/install/render");
    const state = {
      step: {
        section: "verify" as const,
        labelKey: "install.verify.engine",
        isAction: false,
        run: async () => ({ ok: false }),
      },
      status: "error" as const,
      result: { ok: false, errorReason: "/health timeout :7338" },
    };
    const lines = renderStepCompletion(state, { tty: true, color: false, lang: "en", termWidth: 80 });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("✗");
    expect(lines[1]).toContain("reason: /health timeout :7338");
  });

  test("step error com reason + seeAlso → 3 linhas", async () => {
    const { renderStepCompletion } = await import("../../src/install/render");
    const state = {
      step: {
        section: "verify" as const,
        labelKey: "install.verify.engine",
        isAction: false,
        run: async () => ({ ok: false }),
      },
      status: "error" as const,
      result: { ok: false, errorReason: "A", errorSeeAlso: "~/.beheld/install.log" },
    };
    const lines = renderStepCompletion(state, { tty: true, color: false, lang: "en", termWidth: 80 });
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("reason: A");
    expect(lines[2]).toContain("see:");
    expect(lines[2]).toContain("~/.beheld/install.log");
  });

  test("overrideLabel substitui labelKey", async () => {
    const { renderStepCompletion } = await import("../../src/install/render");
    const state = {
      step: {
        section: "install" as const,
        labelKey: "install.install.start",
        isAction: true,
        run: async () => ({ ok: true }),
      },
      status: "ok" as const,
      result: { ok: true, overrideLabel: "Daemons já em execução" },
    };
    const lines = renderStepCompletion(state, { tty: true, color: false, lang: "pt-br", termWidth: 80 });
    expect(lines[0]).toContain("Daemons já em execução");
    expect(lines[0]).not.toContain("daemons iniciados");
  });
});

// ── i18n t() ─────────────────────────────────────────────────────────────────

describe("i18n t()", () => {
  test("opener EN", async () => {
    const { t } = await import("../../src/i18n/install");
    expect(t("install.opener", "en")).toContain("My name is B3H31D");
    expect(t("install.opener", "en")).toContain("beheld.dev");
  });

  test("opener PT-BR", async () => {
    const { t } = await import("../../src/i18n/install");
    expect(t("install.opener", "pt-br")).toContain("Meu nome é B3H31D");
    expect(t("install.opener", "pt-br")).toContain("beheld.dev");
  });

  test("closer.partial interpolates {label}", async () => {
    const { t } = await import("../../src/i18n/install");
    const out = t("install.closer.partial.l1", "en", { label: "Scoring engine" });
    expect(out).toContain("Scoring engine reported error");
  });

  test("isLang validator", async () => {
    const { isLang } = await import("../../src/i18n/install");
    expect(isLang("en")).toBe(true);
    expect(isLang("pt-br")).toBe(true);
    expect(isLang("fr")).toBe(false);
    expect(isLang("")).toBe(false);
  });

  test("unknown key returns the key (visible em revisão)", async () => {
    const { t } = await import("../../src/i18n/install");
    expect(t("install.does.not.exist", "en")).toBe("install.does.not.exist");
  });

  test("nenhuma menção a IP de terceiros (R2D2, K-2SO, LEGO)", async () => {
    const { t } = await import("../../src/i18n/install");
    const keys = [
      "install.opener",
      "install.closer.ok.l1",
      "install.closer.ok.l2",
      "install.closer.ok.l3",
      "install.closer.partial.l1",
      "install.closer.partial.l2",
      "install.closer.signoff",
    ];
    for (const k of keys) {
      for (const lang of ["en", "pt-br"] as const) {
        const text = t(k, lang);
        expect(text).not.toMatch(/R2D2|K-?2SO|LEGO/i);
      }
    }
  });
});

// ── detectRenderEnv ──────────────────────────────────────────────────────────

describe("detectRenderEnv", () => {
  test("NO_COLOR=1 desliga cor mesmo em TTY", async () => {
    const orig = process.env.NO_COLOR;
    const origTty = process.stdout.isTTY;
    try {
      process.env.NO_COLOR = "1";
      Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
      const { detectRenderEnv } = await import("../../src/install/render");
      const env = detectRenderEnv({ lang: "en" });
      expect(env.tty).toBe(true);
      expect(env.color).toBe(false);
    } finally {
      if (orig === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = orig;
      Object.defineProperty(process.stdout, "isTTY", { value: origTty, configurable: true });
    }
  });

  test("não-TTY → color=false", async () => {
    const origTty = process.stdout.isTTY;
    try {
      Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
      const { detectRenderEnv } = await import("../../src/install/render");
      const env = detectRenderEnv({ lang: "pt-br" });
      expect(env.tty).toBe(false);
      expect(env.color).toBe(false);
      expect(env.lang).toBe("pt-br");
    } finally {
      Object.defineProperty(process.stdout, "isTTY", { value: origTty, configurable: true });
    }
  });
});

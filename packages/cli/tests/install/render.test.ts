import { test, expect, describe } from "bun:test";

// ── renderProgressBar (pure) ─────────────────────────────────────────────────

describe("renderProgressBar", () => {
  test("0/10 → empty bar", async () => {
    const { renderProgressBar } = await import("../../src/install/render");
    expect(renderProgressBar(0, 10, 20)).toBe("[                    ] 0/10 · 0%");
  });

  test("6/10 → 12/20 fill", async () => {
    const { renderProgressBar } = await import("../../src/install/render");
    expect(renderProgressBar(6, 10, 20)).toBe("[████████████        ] 6/10 · 60%");
  });

  test("10/10 → full bar", async () => {
    const { renderProgressBar } = await import("../../src/install/render");
    expect(renderProgressBar(10, 10, 20)).toBe("[████████████████████] 10/10 · 100%");
  });

  test("clamps done > total", async () => {
    const { renderProgressBar } = await import("../../src/install/render");
    expect(renderProgressBar(15, 10, 20)).toBe("[████████████████████] 10/10 · 100%");
  });

  test("clamps done < 0", async () => {
    const { renderProgressBar } = await import("../../src/install/render");
    expect(renderProgressBar(-5, 10, 20)).toBe("[                    ] 0/10 · 0%");
  });
});

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

// ── renderVerifyLine (pure) ──────────────────────────────────────────────────

describe("renderVerifyLine", () => {
  test("working (no color)", async () => {
    const { renderVerifyLine } = await import("../../src/install/render");
    expect(
      renderVerifyLine({
        status: "working",
        label: "MCP server",
        statusText: "working",
        labelColumnWidth: 16,
        color: false,
      }),
    ).toBe("    MCP server       [working]");
  });

  test("error (no color)", async () => {
    const { renderVerifyLine } = await import("../../src/install/render");
    expect(
      renderVerifyLine({
        status: "error",
        label: "Scoring engine",
        statusText: "error",
        labelColumnWidth: 16,
        color: false,
      }),
    ).toBe("    Scoring engine   [error]");
  });

  test("pending shows ellipsis", async () => {
    const { renderVerifyLine } = await import("../../src/install/render");
    expect(
      renderVerifyLine({
        status: "pending",
        label: "Autostart",
        statusText: "…",
        labelColumnWidth: 16,
        color: false,
      }),
    ).toBe("    Autostart        […]");
  });

  test("error with color uses RED", async () => {
    const { renderVerifyLine, RED } = await import("../../src/install/render");
    const out = renderVerifyLine({
      status: "error",
      label: "X",
      statusText: "error",
      labelColumnWidth: 4,
      color: true,
    });
    expect(out).toContain(RED);
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

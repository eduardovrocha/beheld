import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

let tmpDir: string;
const origDataDir = process.env.BEHELD_DATA_DIR;
const origNoTel = process.env.BEHELD_NO_TELEMETRY;
const origApiUrl = process.env.BEHELD_API_URL;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beheld-counter-"));
  process.env.BEHELD_DATA_DIR = tmpDir;
  fs.mkdirSync(path.join(tmpDir, ".beheld"), { recursive: true, mode: 0o700 });
  delete process.env.BEHELD_NO_TELEMETRY;
  delete process.env.BEHELD_API_URL;
});

afterEach(() => {
  if (origDataDir === undefined) delete process.env.BEHELD_DATA_DIR;
  else process.env.BEHELD_DATA_DIR = origDataDir;
  if (origNoTel === undefined) delete process.env.BEHELD_NO_TELEMETRY;
  else process.env.BEHELD_NO_TELEMETRY = origNoTel;
  if (origApiUrl === undefined) delete process.env.BEHELD_API_URL;
  else process.env.BEHELD_API_URL = origApiUrl;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── isFirstInstall ───────────────────────────────────────────────────────────

describe("isFirstInstall", () => {
  test("true quando install-id ausente", async () => {
    const { isFirstInstall } = await import("../../src/install/counter");
    expect(isFirstInstall()).toBe(true);
  });

  test("false quando install-id presente", async () => {
    fs.writeFileSync(path.join(tmpDir, ".beheld", "install-id"), "some-uuid");
    const { isFirstInstall } = await import("../../src/install/counter");
    expect(isFirstInstall()).toBe(false);
  });
});

// ── isOptedOut ───────────────────────────────────────────────────────────────

describe("isOptedOut", () => {
  test("true para BEHELD_NO_TELEMETRY=1, true, yes", async () => {
    const { isOptedOut } = await import("../../src/install/counter");
    for (const v of ["1", "true", "TRUE", "yes", "YES"]) {
      process.env.BEHELD_NO_TELEMETRY = v;
      expect(isOptedOut()).toBe(true);
    }
  });

  test("false para unset, '0', 'false', '' (string vazia)", async () => {
    const { isOptedOut } = await import("../../src/install/counter");
    delete process.env.BEHELD_NO_TELEMETRY;
    expect(isOptedOut()).toBe(false);
    process.env.BEHELD_NO_TELEMETRY = "";
    expect(isOptedOut()).toBe(false);
    process.env.BEHELD_NO_TELEMETRY = "0";
    expect(isOptedOut()).toBe(false);
    process.env.BEHELD_NO_TELEMETRY = "false";
    expect(isOptedOut()).toBe(false);
  });
});

// ── getRegisterPayload ───────────────────────────────────────────────────────

describe("getRegisterPayload", () => {
  test("retorna payload válido com id v4, os, version", async () => {
    const { getRegisterPayload, getOsTag } = await import("../../src/install/counter");
    const osTag = getOsTag();
    if (osTag === null) return; // skip on unsupported platforms
    const payload = getRegisterPayload("0.3.2");
    expect(payload).not.toBeNull();
    expect(payload!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(payload!.os).toBe(osTag);
    expect(payload!.version).toBe("0.3.2");
  });

  test("ids são únicos entre chamadas", async () => {
    const { getRegisterPayload } = await import("../../src/install/counter");
    const a = getRegisterPayload("0.3.2");
    const b = getRegisterPayload("0.3.2");
    if (a && b) expect(a.id).not.toBe(b.id);
  });
});

// ── registerFirstInstall ─────────────────────────────────────────────────────

describe("registerFirstInstall", () => {
  const validPayload = {
    id: "550e8400-e29b-41d4-a716-446655440000" as const,
    os: "macos" as const,
    version: "0.3.2",
  };

  test("grava install-id MESMO quando POST falha", async () => {
    const { registerFirstInstall, installIdPath } = await import(
      "../../src/install/counter"
    );
    const fakeFetch = async () => {
      throw new Error("network down");
    };
    const result = await registerFirstInstall(validPayload, { fetchImpl: fakeFetch as never });
    expect(result.sent).toBe(false);
    expect(fs.existsSync(installIdPath())).toBe(true);
    expect(fs.readFileSync(installIdPath(), "utf8")).toBe(validPayload.id);
  });

  test("grava install-id quando POST retorna 5xx", async () => {
    const { registerFirstInstall, installIdPath } = await import(
      "../../src/install/counter"
    );
    const fakeFetch = async () =>
      ({ ok: false, status: 503 } as Response);
    const result = await registerFirstInstall(validPayload, { fetchImpl: fakeFetch as never });
    expect(result.sent).toBe(false);
    expect(result.reason).toContain("503");
    expect(fs.existsSync(installIdPath())).toBe(true);
  });

  test("POST 204 → sent:true, arquivo gravado", async () => {
    const { registerFirstInstall, installIdPath } = await import(
      "../../src/install/counter"
    );
    const fakeFetch = async () =>
      ({ ok: true, status: 204 } as Response);
    const result = await registerFirstInstall(validPayload, { fetchImpl: fakeFetch as never });
    expect(result.sent).toBe(true);
    expect(fs.existsSync(installIdPath())).toBe(true);
  });

  test("POST 429 (rate limit) → tratado como sucesso silencioso", async () => {
    const { registerFirstInstall } = await import("../../src/install/counter");
    const fakeFetch = async () =>
      ({ ok: false, status: 429 } as Response);
    const result = await registerFirstInstall(validPayload, { fetchImpl: fakeFetch as never });
    expect(result.sent).toBe(true);
  });

  test("arquivo install-id tem mode 0o600", async () => {
    const { registerFirstInstall, installIdPath } = await import(
      "../../src/install/counter"
    );
    const fakeFetch = async () => ({ ok: true, status: 204 } as Response);
    await registerFirstInstall(validPayload, { fetchImpl: fakeFetch as never });
    const stats = fs.statSync(installIdPath());
    expect(stats.mode & 0o777).toBe(0o600);
  });

  test("payload enviado é exatamente { id, os, version } — nada além", async () => {
    const { registerFirstInstall } = await import("../../src/install/counter");
    let capturedBody: string | undefined;
    const fakeFetch = async (_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return { ok: true, status: 204 } as Response;
    };
    await registerFirstInstall(validPayload, { fetchImpl: fakeFetch as never });
    expect(capturedBody).toBeTruthy();
    const parsed = JSON.parse(capturedBody!);
    // Lista fixa, ordem irrelevante. Chave extra = falha de privacidade.
    expect(Object.keys(parsed).sort()).toEqual(["id", "os", "version"]);
    expect(parsed.id).toBe(validPayload.id);
    expect(parsed.os).toBe(validPayload.os);
    expect(parsed.version).toBe(validPayload.version);
  });

  test("Content-Type é application/json", async () => {
    const { registerFirstInstall } = await import("../../src/install/counter");
    let capturedHeaders: HeadersInit | undefined;
    const fakeFetch = async (_url: string, init: RequestInit) => {
      capturedHeaders = init.headers;
      return { ok: true, status: 204 } as Response;
    };
    await registerFirstInstall(validPayload, { fetchImpl: fakeFetch as never });
    const headers = capturedHeaders as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

// ── BEHELD_API_URL override ──────────────────────────────────────────────────

describe("getApiBase / registerUrl", () => {
  test("default → beheld.dev", async () => {
    const { getApiBase, registerUrl } = await import("../../src/install/counter");
    expect(getApiBase()).toBe("https://beheld.dev");
    expect(registerUrl()).toBe("https://beheld.dev/api/install/register");
  });

  test("override via BEHELD_API_URL", async () => {
    process.env.BEHELD_API_URL = "http://localhost:3000";
    const { getApiBase, registerUrl } = await import("../../src/install/counter");
    expect(getApiBase()).toBe("http://localhost:3000");
    expect(registerUrl()).toBe("http://localhost:3000/api/install/register");
  });

  test("trailing slash no override é removida", async () => {
    process.env.BEHELD_API_URL = "http://localhost:3000///";
    const { registerUrl } = await import("../../src/install/counter");
    expect(registerUrl()).toBe("http://localhost:3000/api/install/register");
  });

  test("BEHELD_API_URL vazio cai pro default", async () => {
    process.env.BEHELD_API_URL = "";
    const { getApiBase } = await import("../../src/install/counter");
    expect(getApiBase()).toBe("https://beheld.dev");
  });

  test("POST usa a URL derivada do BEHELD_API_URL", async () => {
    process.env.BEHELD_API_URL = "http://localhost:3000";
    const { registerFirstInstall } = await import("../../src/install/counter");
    let capturedUrl: string | undefined;
    const fakeFetch = async (url: string) => {
      capturedUrl = url;
      return { ok: true, status: 204 } as Response;
    };
    await registerFirstInstall(
      { id: "550e8400-e29b-41d4-a716-446655440000", os: "macos", version: "0.3.2" },
      { fetchImpl: fakeFetch as never },
    );
    expect(capturedUrl).toBe("http://localhost:3000/api/install/register");
  });
});

// ── invariants de privacidade ────────────────────────────────────────────────

describe("privacy invariants (cláusula pétrea)", () => {
  test("source do counter.ts não referencia process.env além do BEHELD_*", async () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "..", "src", "install", "counter.ts"),
      "utf8",
    );
    // Permitido: process.env.BEHELD_DATA_DIR e BEHELD_NO_TELEMETRY.
    // Proibido: tudo mais (HOSTNAME, USER, SHELL, etc — fingerprinting).
    const envRefs = src.match(/process\.env\.\w+/g) ?? [];
    for (const ref of envRefs) {
      expect(ref).toMatch(/^process\.env\.BEHELD_/);
    }
  });

  test("payload type tem apenas 3 campos", async () => {
    // RegisterPayload tem id, os, version — qualquer expansão precisa
    // bumpar o disclosure em /compromisso + tests do servidor.
    const src = fs.readFileSync(
      path.join(__dirname, "..", "..", "src", "install", "counter.ts"),
      "utf8",
    );
    expect(src).toMatch(
      /export interface RegisterPayload\s*\{\s*id:\s*string;\s*os:\s*"macos"\s*\|\s*"linux";\s*version:\s*string;\s*\}/,
    );
  });
});

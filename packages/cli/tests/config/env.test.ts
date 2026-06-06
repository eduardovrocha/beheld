import { describe, test, expect, beforeEach, afterEach } from "bun:test";

import {
  getEnv,
  getApiBaseUrl,
  getPortalUrl,
  getRekorUrl,
  getApiUrl,
} from "../../src/config/env";

const ENV_KEYS = [
  "BEHELD_ENV",
  "BEHELD_API_URL",
  "BEHELD_PORTAL_URL",
  "BEHELD_REKOR_URL",
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("getEnv", () => {
  test("default → production", () => {
    expect(getEnv()).toBe("production");
  });
  test("BEHELD_ENV=production", () => {
    process.env.BEHELD_ENV = "production";
    expect(getEnv()).toBe("production");
  });
  test("BEHELD_ENV=development", () => {
    process.env.BEHELD_ENV = "development";
    expect(getEnv()).toBe("development");
  });
  test("BEHELD_ENV=dev (alias)", () => {
    process.env.BEHELD_ENV = "dev";
    expect(getEnv()).toBe("development");
  });
  test("BEHELD_ENV=local (alias)", () => {
    process.env.BEHELD_ENV = "local";
    expect(getEnv()).toBe("development");
  });
  test("BEHELD_ENV with whitespace and casing", () => {
    process.env.BEHELD_ENV = "  Development  ";
    expect(getEnv()).toBe("development");
  });
  test("unknown value → production silently", () => {
    process.env.BEHELD_ENV = "staging";
    expect(getEnv()).toBe("production");
  });
});

describe("getApiBaseUrl", () => {
  test("default (production) → beheld.dev", () => {
    expect(getApiBaseUrl()).toBe("https://beheld.dev");
  });
  test("BEHELD_ENV=development → localhost:3000", () => {
    process.env.BEHELD_ENV = "development";
    expect(getApiBaseUrl()).toBe("http://localhost:3000");
  });
  test("BEHELD_API_URL override wins over BEHELD_ENV", () => {
    process.env.BEHELD_ENV = "production";
    process.env.BEHELD_API_URL = "http://localhost:9999";
    expect(getApiBaseUrl()).toBe("http://localhost:9999");
  });
  test("BEHELD_API_URL strips trailing slash", () => {
    process.env.BEHELD_API_URL = "http://localhost:3000///";
    expect(getApiBaseUrl()).toBe("http://localhost:3000");
  });
  test("empty BEHELD_API_URL falls back to env default", () => {
    process.env.BEHELD_API_URL = "";
    expect(getApiBaseUrl()).toBe("https://beheld.dev");
  });
});

describe("getPortalUrl", () => {
  test("default → beheld.dev", () => {
    expect(getPortalUrl()).toBe("https://beheld.dev");
  });
  test("BEHELD_ENV=development → localhost:3000", () => {
    process.env.BEHELD_ENV = "development";
    expect(getPortalUrl()).toBe("http://localhost:3000");
  });
  test("BEHELD_PORTAL_URL override", () => {
    process.env.BEHELD_PORTAL_URL = "http://example.local";
    expect(getPortalUrl()).toBe("http://example.local");
  });
});

describe("getRekorUrl", () => {
  test("default → sigstore.dev", () => {
    expect(getRekorUrl()).toBe("https://rekor.sigstore.dev");
  });
  test("development → sigstage.dev", () => {
    process.env.BEHELD_ENV = "development";
    expect(getRekorUrl()).toBe("https://rekor.sigstage.dev");
  });
  test("BEHELD_REKOR_URL override", () => {
    process.env.BEHELD_REKOR_URL = "https://custom.example/";
    expect(getRekorUrl()).toBe("https://custom.example");
  });
});

describe("getApiUrl", () => {
  test("production → beheld.dev/api", () => {
    expect(getApiUrl()).toBe("https://beheld.dev/api");
  });
  test("development → localhost:3000/api", () => {
    process.env.BEHELD_ENV = "development";
    expect(getApiUrl()).toBe("http://localhost:3000/api");
  });
});

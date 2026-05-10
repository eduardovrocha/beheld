import { test, expect, describe } from "bun:test";
import { sanitize, sanitizeCommand, sanitizeObject } from "../src/sanitizer";

describe("sanitize — string inputs", () => {
  test("redacts Anthropic API keys", () => {
    const result = sanitize("key=sk-abcdef1234567890abcdef1234567890abcdef12") as string;
    expect(result).not.toContain("sk-abcdef");
    expect(result).toContain("<redacted>");
  });

  test("redacts GitHub tokens", () => {
    const result = sanitize("TOKEN=ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345678901") as string;
    expect(result).not.toContain("ghp_");
    expect(result).toContain("<redacted>");
  });

  test("redacts Bearer tokens", () => {
    const result = sanitize("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9") as string;
    expect(result).not.toContain("eyJhbGciOi");
    expect(result).toContain("<redacted>");
  });

  test("redacts env var values", () => {
    const result = sanitize("DATABASE_URL=postgresql://user:pass@localhost/mydb") as string;
    expect(result).not.toContain("postgresql://user");
    expect(result).toContain("<redacted>");
  });

  test("redacts passwords", () => {
    const result = sanitize('password: "mysecretpassword123"') as string;
    expect(result).not.toContain("mysecretpassword123");
    expect(result).toContain("<redacted>");
  });

  test("redacts long content fields", () => {
    const longText = "a".repeat(60);
    const input = `{"content":"${longText}"}`;
    const result = sanitize(input) as string;
    expect(result).not.toContain(longText);
    expect(result).toContain("<redacted>");
  });

  test("does not redact short content fields (< 50 chars)", () => {
    const input = `{"content":"short text"}`;
    const result = sanitize(input) as string;
    expect(result).toContain("short text");
  });

  test("preserves non-sensitive content", () => {
    const input = "Running tests with rspec spec/models";
    expect(sanitize(input)).toBe(input);
  });

  test("preserves empty string", () => {
    expect(sanitize("")).toBe("");
  });
});

describe("sanitize — non-string primitives are passed through unchanged", () => {
  test("numbers are unchanged", () => {
    expect(sanitize(42)).toBe(42);
    expect(sanitize(3.14)).toBe(3.14);
  });

  test("booleans are unchanged", () => {
    expect(sanitize(true)).toBe(true);
    expect(sanitize(false)).toBe(false);
  });

  test("null is unchanged", () => {
    expect(sanitize(null)).toBeNull();
  });
});

describe("sanitize — objects", () => {
  test("redacts secrets inside nested objects", () => {
    const obj = {
      session_id: "abc123",
      metadata: { env: "API_KEY=sk-abc1234567890abcdef1234567890abcdef1234" },
    };
    const result = sanitize(obj) as typeof obj;
    expect(JSON.stringify(result)).not.toContain("sk-abc");
    expect((result as Record<string, unknown>).session_id).toBe("abc123");
  });

  test("numeric and boolean fields inside objects are preserved", () => {
    const obj = { count: 42, active: true, score: 99.5 };
    const result = sanitize(obj) as typeof obj;
    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
    expect(result.score).toBe(99.5);
  });

  test("sanitizeObject returns same type", () => {
    const obj = { key: "DATABASE_URL=secretvalue123456789" };
    const result = sanitizeObject(obj);
    expect(result.key).toContain("<redacted>");
  });
});

describe("sanitizeCommand", () => {
  test("hashes absolute paths but keeps filename", () => {
    const result = sanitizeCommand("cat /Users/john/project/src/main.ts");
    expect(result).not.toContain("/Users/john/project");
    expect(result).toContain("main.ts");
  });

  test("redacts secrets in commands", () => {
    const result = sanitizeCommand(
      "curl -H 'Bearer eyJhbGciOiJSUzI1NiJ9abc' https://api.example.com",
    );
    expect(result).toContain("<redacted>");
  });

  test("preserves plain commands without paths or secrets", () => {
    const result = sanitizeCommand("npm test");
    expect(result).toBe("npm test");
  });
});

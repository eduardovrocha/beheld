import { test, expect, describe } from "bun:test";
import { sanitize, sanitizeObject, sanitizeCommand } from "../src/sanitizer";

describe("sanitize", () => {
  test("redacts Anthropic API keys", () => {
    const input = "key=sk-abcdef1234567890abcdef1234567890abcdef12";
    const result = sanitize(input);
    expect(result).not.toContain("sk-abcdef");
    expect(result).toContain("[REDACTED]");
  });

  test("redacts GitHub personal access tokens", () => {
    const input = "TOKEN=ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345678901";
    const result = sanitize(input);
    expect(result).not.toContain("ghp_");
    expect(result).toContain("[REDACTED]");
  });

  test("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
    const result = sanitize(input);
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(result).toContain("[REDACTED]");
  });

  test("redacts env var values", () => {
    const input = "DATABASE_URL=postgresql://user:pass@localhost/mydb";
    const result = sanitize(input);
    expect(result).not.toContain("postgresql://user:pass");
    expect(result).toContain("[REDACTED]");
  });

  test("redacts passwords", () => {
    const input = 'password: "mysecretpassword123"';
    const result = sanitize(input);
    expect(result).not.toContain("mysecretpassword123");
    expect(result).toContain("[REDACTED]");
  });

  test("preserves non-sensitive content", () => {
    const input = "Running tests with rspec spec/models";
    expect(sanitize(input)).toBe(input);
  });

  test("preserves empty string", () => {
    expect(sanitize("")).toBe("");
  });
});

describe("sanitizeObject", () => {
  test("redacts secrets inside nested objects", () => {
    const obj = {
      session_id: "abc123",
      metadata: {
        env: "API_KEY=sk-abc1234567890abcdef1234567890abcdef1234",
      },
    };
    const result = sanitizeObject(obj);
    expect(JSON.stringify(result)).not.toContain("sk-abc");
    expect(result.session_id).toBe("abc123");
  });
});

describe("sanitizeCommand", () => {
  test("hashes absolute paths but keeps filename", () => {
    const cmd = "cat /Users/john/project/src/main.ts";
    const result = sanitizeCommand(cmd);
    expect(result).not.toContain("/Users/john");
    expect(result).toContain("main.ts");
  });

  test("redacts secrets in commands", () => {
    const cmd = "curl -H 'Bearer eyJhbGciOiJSUzI1NiJ9abc' https://api.example.com";
    const result = sanitizeCommand(cmd);
    expect(result).toContain("[REDACTED]");
  });
});

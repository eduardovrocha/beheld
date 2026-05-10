import { test, expect, describe } from "bun:test";
import { VERSION } from "../src/index";

describe("CLI", () => {
  test("VERSION follows semver format", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("--version flag prints version and exits 0", async () => {
    const proc = Bun.spawn(["bun", "run", "packages/cli/src/index.ts", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    expect(exit).toBe(0);
    expect(output.trim()).toBe(`devprofile ${VERSION}`);
  });

  test("-v flag prints version and exits 0", async () => {
    const proc = Bun.spawn(["bun", "run", "packages/cli/src/index.ts", "-v"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    expect(exit).toBe(0);
    expect(output.trim()).toBe(`devprofile ${VERSION}`);
  });

  test("no args prints help and exits 0", async () => {
    const proc = Bun.spawn(["bun", "run", "packages/cli/src/index.ts"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    expect(exit).toBe(0);
    expect(output).toContain("Usage:");
    expect(output).toContain("init");
    expect(output).toContain("view");
  });

  test("unknown command exits 1", async () => {
    const proc = Bun.spawn(["bun", "run", "packages/cli/src/index.ts", "unknown-cmd"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exit = await proc.exited;
    expect(exit).toBe(1);
  });
});

/**
 * D-02 fix — default-dispatch unit tests.
 *
 * The root program's no-subcommand path now checks for the canonical
 * signing keys and dispatches `beheld bootstrap` when they're missing,
 * restoring the `npx beheld` L1-first low-friction onboarding promise.
 *
 * Tests inject `hasIdentity` and `runBootstrap` so we exercise only the
 * dispatch logic — no fs, no commander parsing, no real keystore.
 */
import { test, expect, describe } from "bun:test";
import { defaultDispatch } from "../src/index";

describe("defaultDispatch — D-02 fix", () => {
  test("missing identity → dispatches bootstrap, returns 'bootstrap'", async () => {
    let bootstrapCalled = false;
    let helpCalled = false;
    const out = await defaultDispatch({
      hasIdentity: () => false,
      runBootstrap: async () => { bootstrapCalled = true; },
      showHelp: () => { helpCalled = true; },
    });
    expect(out).toBe("bootstrap");
    expect(bootstrapCalled).toBe(true);
    expect(helpCalled).toBe(false);
  });

  test("identity present → shows help, returns 'help'", async () => {
    let bootstrapCalled = false;
    let helpCalled = false;
    const out = await defaultDispatch({
      hasIdentity: () => true,
      runBootstrap: async () => { bootstrapCalled = true; },
      showHelp: () => { helpCalled = true; },
    });
    expect(out).toBe("help");
    expect(bootstrapCalled).toBe(false);
    expect(helpCalled).toBe(true);
  });

  test("identity check is awaited only once per dispatch", async () => {
    let checks = 0;
    await defaultDispatch({
      hasIdentity: () => { checks++; return true; },
      showHelp: () => {},
    });
    expect(checks).toBe(1);
  });

  test("bootstrap path does NOT call showHelp", async () => {
    let helpCalled = false;
    await defaultDispatch({
      hasIdentity: () => false,
      runBootstrap: async () => {},
      showHelp: () => { helpCalled = true; },
    });
    expect(helpCalled).toBe(false);
  });
});

# Integration tests

End-to-end tests that boot real subprocesses (MCP server + a stub engine) on
isolated ports against a fresh `BEHELD_DATA_DIR`, drive traffic through
the HTTP hooks the same way Claude Code does, and verify the system survives
restarts and process kills.

These exist as a regression gate for the bug class we hit: PID-based liveness
detection drifting from reality, in-memory counters being lost on restart,
log spam from uncoalesced retries, and silent degradation when the engine
is offline. A single test (`long-running.test.ts`) covers the scenario that
would have caught all of them.

## Running locally

```bash
# Just the integration test (~2s)
bun test packages/cli/tests/integration/

# Skip integration when iterating on unrelated code
SKIP_INTEGRATION=1 bun test packages/cli/tests/
```

The test owns ports `27337` (MCP) and `27338` (fake engine) — well above the
default `7337` / `7338` to avoid colliding with a running production daemon.

## What's stubbed and why

The scoring engine is replaced by `fake-engine.ts`, a Bun script that responds
to `/health`, `/status`, and `/process` only. The real engine is a Python
FastAPI app bundled via PyInstaller — building it adds minutes to CI and isn't
necessary here, because:

- The Python engine has its own pytest suite under `packages/engine/tests/`.
- The contracts this test cares about (HTTP liveness, counter rebuild, doctor
  output, view alerts) live entirely on the MCP / CLI side.
- A stub gives us deterministic spawn/kill semantics that the real engine
  binary doesn't.

## What "tudo verde" means in this env

The test env spawns MCP and the fake engine directly, bypassing
`beheld start`. So the PID file under `~/.beheld/daemon.pid` is never
written and on macOS the codesign check finds no engine binary. Both surface
as warnings in `beheld doctor` — they're env noise, not regressions.

The test asserts the lines that matter in production:

- both daemons report healthy on `/health`
- the engine PID echoed by doctor matches the actual `lsof -i :27338`
- no `Não responde em /health` line is present

## Adding more scenarios

If you add another bug class that should be caught here (e.g. hook ordering,
event sanitization edge case), prefer adding a fresh `describe` block in the
same file to a new test file — sharing the spawned MCP across blocks keeps the
suite fast. Each block should still leave `events_today` in a known state so
the next block can assert against it.

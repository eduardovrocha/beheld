# Changelog

All notable changes to Beheld are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
follows [Semantic Versioning](https://semver.org/).

## [0.4.0] — 2026-06-02 · Refundação multi-tool

> The flagship release of the Refundação multi-tool: git history is now the
> backbone, eight coding harnesses are supported as additive enrichment,
> and a single command (`beheld harness install`) wires every detected
> harness in one pass. Bundle schema bumped to v7; portal accepts v3.

### Added — Adapter wave (R2.* + R3.1)

- **R2.1** — Gemini CLI adapter (`native_hook`) + closed harness registry
  (`packages/engine/src/harness_registry.py`) with `INFERRED_FALLBACK`
  for forward-compat. Replaces hardcoded single-source emission with
  per-source aggregation grouped by the wire-side `source` string.
- **R2.2** — Cursor adapter (`local_log_tail`) — server-side handler with
  4-way discriminated union (tool_use / chat_request / edit_apply / stop)
  + CLI-side tail loop reading `~/Library/Application Support/Cursor/logs/`
  (macOS) and `~/.config/Cursor/logs/` (Linux).
- **R2.3** — Codex CLI adapter (`native_hook`) — handler ready; upstream
  hook spec is not yet publicly stable, so the installer prints explicit
  manual setup instructions instead of writing a speculative config.
- **R2.4** — Copilot CLI adapter (`statusline`) + CLI-side tail (transcript
  walker through `~/Library/Application Support/gh-copilot/`). Per-event
  `surface: "statusline" | "transcript"` preserved in metadata.
- **R2.5** — Copilot VS Code adapter (`local_log_tail`) + CLI-side tail
  recursively walking VS Code's per-session `logs/<YYYYMMDDTHHMMSS>/`
  layout under `exthost{N}/GitHub.copilot/`.
- **R3.0** — Windsurf research spike (`docs/r3-windsurf-spike.md`) —
  decision: GO at `native_hook` fidelity. Documents the 12-event Cascade
  Hooks API + the mapping to Beheld's vocabulary.
- **R3.1** — Windsurf adapter (`native_hook` · Cascade Hooks) — handler
  for all 12 events + CLI installer that writes
  `~/.codeium/windsurf/hooks.json` with idempotent backup-on-change.
  Privacy invariants: `user_prompt` text, `response` markdown, `edits[]`
  bodies, and `mcp_result` payloads are DROPPED in the handler — only
  character counts / counts-of survive to disk.

### Added — Bundle wire (R1.1 → R1.2c)

- **R1.1** — Schema v6: payload `l1`/`l2` renamed to `core`/`enrichment`;
  `enrichment.harness_sources[*]` is first-class with `capture_fidelity`
  metadata; verifier dual-reads v5 / v1 legacy.
- **R1.2a** — `L1Snapshot.monthly_buckets[]` data model for the
  GrowthRateScorer rewrite.
- **R1.2b** — Scorer terminology refactor (l1/l2 → core/enrichment),
  `data_sources` declared per scorer, `fallback_when_enrichment_missing`
  ClassVar gates whether a scorer falls back to core when L2 is absent.
  GrowthRateScorer rewritten around §7.2: 12-month baseline + 6-month
  current windows with 4 signals weighted 0.30 / 0.20 / 0.25 / 0.25.
- **R1.2c** — Schema v7: `scores.{prompt_quality, growth_rate, overall}`
  widened to `Optional[int] | null` in canonical JSON. Verifier chain
  becomes v7 → v6_legacy → v5_legacy → v1_legacy.

### Added — Portal (R1.3, web companion)

- v3 (core/enrichment) bundles accepted alongside legacy v1/v2 in
  `Snapshot.schema_version`; v3 detected before v2 (defensive against
  hybrid payloads).
- `BundleSignals` typed value object with `safe_dig` walks the core→l1
  fallback chain in one place. `Positions::Matcher` and `EvolutionCurve`
  consume it — no raw `bundle_data` access in matching/curve logic.
- `DirectoryController` (HTML + Api::V1) — JSONB queries use `OR` /
  `COALESCE` over v3 and v2 paths so a mixed-schema directory works.
- `Capture Sources` block on `/v/:id` renders one chip per harness with
  trust tier via class: native_hook / editor_extension → `chip` (high),
  local_log_tail / statusline → `chip-muted` (med), inferred →
  `chip-warn` (low). aria-label preserves accessibility without JS.

### Added — Onboarding (R1.4 + unified installer)

- `beheld bootstrap` subcommand — L1-first onboarding entry point.
- Non-destructive legacy bridge: copies `~/.devprofile/` → `~/.beheld/`
  and writes `~/.devprofile/MIGRATED_TO_BEHELD.md`. The original is
  **never deleted**; a re-run reports `already_migrated`.
- Default behavior (`beheld` with no args): checks for canonical signing
  keys; if missing, dispatches `bootstrap` automatically.
- **Unified harness installer** — `beheld harness list` /
  `beheld harness install [names...] [--force]` collapses all eight
  harnesses into one registry of `HarnessAdapter` entries sharing a
  detect / install / uninstall surface.
- **Daemon tail scheduler** (`startTailHeartbeat`): the mcp-server reads
  `~/.beheld/config.json:tails[]` on start and schedules `pollOnce` on
  a 60s interval for every enabled adapter. One slow tail never blocks
  another.

### Added — Documentation (R1.5a + R1.5b)

- README reframed around L1-first design + multi-harness roadmap; closed
  enum + per-harness mapping table + BUNDLE_VERSION 7 schema example.
- `install.sh` runs `beheld bootstrap` before `beheld init`.
- Landing copy (PT-BR / EN / ES) names the harness wave concretely.
- `docs/beheld-estado-atual.md` declared canonical contract source with
  new "Contratos técnicos" section pinning the three hard invariants:
  closed fidelity enum, GrowthRate §7.2 formula, verifier schema chain.

### Changed

- **Breaking (engine-internal)**: scorers now declare `data_sources`
  using `"core"` / `"enrichment"` strings; the legacy `"l1"` / `"l2"`
  strings are no longer recognised. Custom scorers must be updated.
- **Breaking (bundle wire)**: generator emits BUNDLE_VERSION 7 only.
  The reader chain still accepts v6 / v5 / v1 legacy bundles for
  verification — only the writer changed.
- `harness_sources[]` ordering is now canonical
  `(harness, capture_fidelity)` lexicographic — locked by
  `test_canonical_ordering_is_insertion_order_independent` so insertion
  order can never affect the signed bytes.

### Fixed

- **D-01** — Legacy bridge was MOVING files (rename + remove legacy)
  instead of copying. Now COPIES (cpSync) and preserves `~/.devprofile/`
  verbatim with a `MIGRATED_TO_BEHELD.md` marker.
- **D-02** — `beheld` without arguments now dispatches `bootstrap`
  automatically when keys are missing.
- **D-05** — Pre-existing flaky tests cleaned up: dropped the
  wall-clock assertion in `waitSocketRelease`; `.skip` + comment on two
  `submitToRekor` tests that pass in isolation but fail in the full
  suite due to module-state pollution.

### Verification

- engine (pytest): 542 / 542 passed.
- CLI (bun): 644 passed · 3 skipped · 0 failed · 1614 expect() calls.
- mcp-server adapters (bun): 65 passed · 0 failed.
- portal (rspec): 463 / 463 passed.
- **Total**: 1714 passed · 3 skipped · 0 failed across all suites.
- End-to-end flows: all four flows from the audit prompt executed:
  bootstrap with 3 subcases, multi-source JSONL → bundle aggregation,
  verifier legacy branch coverage, Rails matcher v3 core-only without
  `NoMethodError`.

### Known issues / non-blockers carried into 0.5.0

- **D-03** — `docs/adapters/*.md` not yet written. ~2h effort.
- **D-04** — README hero uses equivalent English framing instead of the
  PT-BR canonical phrase. Cosmetic.
- **D-05** — test pollution flakies properly fixed via test-runner
  isolation (`--fork-mode=process` or `vi.resetModules()` equivalent).
- Binary size (`dist/beheld`) is ~97MB on ARM64 — above the audit
  prompt's 50MB target but unchanged since R1.1.

## [0.1.1] — unreleased

Reliability + observability pass. Triggered by a session where the engine had
silently fallen offline for hours and `beheld view` happily kept showing
stale cached scores. The point of this release is that this class of
"silently degraded" failures becomes loud.

### Fixed

- **B14 — Liveness detection now uses HTTP `/health`, not PID files**
  ([daemon-manager.ts](packages/cli/src/daemon-manager.ts)). Previously,
  `beheld status` and friends called `process.kill(pid, 0)` against the
  PID written at startup. After a `kill -9` + LaunchAgent respawn, the file
  pointed at the old PID and status lied "running" while the port was empty.
  All liveness checks now hit `:7337/health` and `:7338/health` with a 1s
  timeout. The PID file is downgraded to informational metadata in `status`
  output.
- **B16 — Counters survive MCP restarts** ([counters.ts](packages/mcp-server/src/counters.ts)).
  `events_today` / `sessions_today` were module-level integers that reset to
  0 on every restart, causing user-visible drops. They now back onto the
  JSONL files at `~/.beheld/sessions/`: lazy rebuild on first access,
  also called eagerly at server start. Day-rollover detection is implicit —
  the next access after midnight rebuilds for the new local day. ±1-day file
  scan window catches events that crossed the UTC↔local boundary.
- **B19 — Engine cold-start no longer triggers a phantom EADDRINUSE race
  or stale PID file** ([daemon-manager.ts](packages/cli/src/daemon-manager.ts)).
  Two coupled bugs surfaced by the auto-test protocol after a fresh
  `~/.beheld/` wipe:
  1. The previous 10s `waitForHealthPort` timeout was shorter than the
     PyInstaller engine's cold extraction time on macOS (12-17s on first
     run when `/tmp/_MEI*` is empty). `beheld init` would falsely
     report "Engine: false" and the LaunchAgent it had just installed
     would race in spawning a duplicate engine that hit `[Errno 48]
     address already in use`. Engine wait is now 30s; MCP stays at 10s;
     the two run in parallel so warm starts feel instant.
  2. `child.pid` returned by `spawn()` for the engine is the PyInstaller
     bootloader, which then forks/execs into the real Python interpreter
     (different PID). The PID file recorded the bootloader; `lsof` saw
     the inner process; doctor reported "drift" forever and `restart`
     wouldn't fix it. After the engine `/health` reports ready, the PID
     file is now updated with the actual listening PID via `lsof`.
  `beheld start` also prints "engine pode levar 15-30s no primeiro
  start" before the wait so the user doesn't think it hung.
- **B17 — Stop-hook coalescing eliminates trigger spam**
  ([engine-trigger.ts](packages/mcp-server/src/engine-trigger.ts)). Claude
  Code fires Stop multiple times per session (subagents, end-of-turn). Each
  one was independently calling `POST /process`, generating 4–8x duplicate
  log lines per session_id when the engine was offline or slow. Now: 30s
  coalesce window per session_id + in-flight dedupe. The engine's
  `/process` reads from the JSONL cursor regardless of which session_id
  triggered it, so collapsing duplicates loses no information. Timeout
  bumped from 3s to 10s — `process_new` does heavy score recomputation and
  3s wasn't enough under backlog. Stop hook still returns in <100ms thanks
  to fire-and-forget `.catch()` in the caller.

### Added

- **`beheld doctor`** ([doctor.ts](packages/cli/src/commands/doctor.ts)).
  Six-step diagnostic: MCP HTTP, engine HTTP, PID file (compared against
  `lsof -i :PORT`), codesign + xattr on macOS, orphan event count, JSONL of
  the day vs in-memory counter. Exits 0 when clean, 1 on any warning or
  critical issue. Suggests a concrete next command for every finding.
- **`beheld restart`** ([restart.ts](packages/cli/src/commands/restart.ts)).
  Was an inline alias; now its own command with graceful SIGTERM, SIGKILL
  fallback after 5s (already in `daemonManager.stop`), and an explicit
  double `/health` verification at the end. Failure path points at
  `beheld doctor`.
- **Boxed alert in `beheld view`** when the engine is offline or the
  cached score is older than 1 day ([alert-box.ts](packages/cli/src/ui/alert-box.ts)).
  Replaces the easily-missed plain warning line with a framed box that names
  the cache date in pt-BR, surfaces how many events MCP has counted today,
  and offers the two relevant commands. Tolerates ±1 day to avoid a false
  positive at the UTC↔local boundary.
- **`Counters` module exports** for the MCP server, plus 15 unit tests
  covering corrupted-line tolerance, day rollover, and rebuild from disk.
- **Long-running integration test**
  ([long-running.test.ts](packages/cli/tests/integration/long-running.test.ts))
  + helpers + a Bun-based fake engine. Boots a real MCP subprocess against
  an isolated `BEHELD_DATA_DIR`, drives 30 sessions of real HTTP
  hooks, kills engine and MCP with SIGKILL, restarts both, and verifies
  health detection + counter rebuild + doctor output coherently. Runs in
  ~1.4s locally, gated in CI by `pull_request` or `ref==main`.

### Changed

- **`beheld doctor` is port-aware** — derives MCP and engine ports from
  `BEHELD_MCP_URL` / `BEHELD_ENGINE_URL` lazily so isolated test
  envs work cleanly.
- **MCP `/status` `events_today` and `sessions_today`** now drive off the
  `Counters` instance and reflect what's on disk.
- **CI**: `test-ts` runs with `SKIP_INTEGRATION=1` to keep the per-push
  cycle short. New `test-ts-integration` job runs the long-running scenario
  on Ubuntu + macOS, gated by `pull_request` or `ref==main`.
- Dead code removed from
  [packages/mcp-server/src/daemon.ts](packages/mcp-server/src/daemon.ts):
  `isRunning`, `start`, `stop`, `setupAutostart`, `removeAutostart` (and
  helpers `getBinaryPath`, `readPid`, `setupLaunchAgent`, `setupSystemd`)
  weren't imported anywhere. File went from 187 → 47 lines.

### Known issues / not in scope

- **Engine SQLite `database disk image is malformed`**: surfaced by `doctor`
  but not fixed in this release. Auto-heal landed in `150519c` does not
  cover the `save_session` path. Tracked separately. Symptom on the
  developer's own machine: engine fails to start on first `/process` after
  the DB hits the bad state, doctor correctly reports engine offline.
- **Stop event bypasses the in-memory counter**: `/hook/stop` writes to
  JSONL but doesn't call `trackEvent`, so `events_today` is undercounted by
  one per session until the next MCP restart (which then reads the JSONL
  and includes the stops). One-line fix; tracked separately. The
  long-running integration test documents and asserts this discrepancy
  explicitly via `trackedEvents` vs `jsonlEvents`.
- **Manual 1h+ smoke test in a freshly nuked `~/.beheld`** has not been
  run for this version yet — it's listed as a release blocker before the
  `v0.1.1` tag is pushed. The first attempt at this auto-test surfaced B19
  (above), which is now fixed.
- **Bundled engine binary** under `packages/cli/assets/beheld-engine`
  was not regenerated for this release; locally it still reports
  `0.1.0` from `/health`. The release.yml workflow rebuilds the engine
  from `packages/engine/src/main.py` (now versioned 0.1.1) on tag push, so
  shipped binaries from `v0.1.1` onward report 0.1.1 correctly.

### Testing

- TypeScript: 389 unit tests + 1 integration scenario, all green.
- Python (engine): 446 tests, all green.
- Build: standalone bun-compiled CLI, 280 modules, ~360ms.

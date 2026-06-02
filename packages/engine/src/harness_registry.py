"""R2 — harness source registry.

Maps the JSONL `source` strings (what the mcp-server writers stamp on each
BeheldEvent) to the canonical (harness, capture_fidelity) pair that ends up
inside every bundle's `enrichment.harness_sources[*]`.

Why a registry, not inline strings:
  - `capture_fidelity` is a CLOSED enum (see models.CAPTURE_FIDELITY_VALUES).
    Centralising the mapping makes it impossible to ship a bundle with a
    fidelity value the verifier doesn't accept.
  - The R2 wave introduces five new harnesses (gemini_cli, cursor, codex_cli,
    copilot_cli, copilot_vscode). Adding each one means a single entry here
    plus the matching writer side — no surgery in `bundle.py`.
  - Tests pin the registry shape so a typo or accidental rename of a source
    string breaks loud (see tests/test_harness_registry.py).

Source-string convention:
  Writer-side strings are kebab-case (`claude-code`, `gemini-cli`) because
  that's what the mcp-server has emitted since Phase 5. The portal-facing
  harness identifier is snake_case (`claude_code`, `gemini_cli`) to match
  Python attribute conventions and stay friendly to SQL / JSON consumers.
  Both are stable wire identifiers — they live in this file and nowhere else.

Adding a new harness (R2 protocol):
  1. Append one HARNESS_REGISTRY entry with the source-string the mcp-server
     adapter will emit.
  2. Make sure the writer (TS) stamps that exact source-string on every
     event from the new adapter.
  3. Add a sample-fixture test that round-trips a JSONL line through the
     reader and asserts the registry lookup returns the expected pair.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from models import CAPTURE_FIDELITY_VALUES


@dataclass(frozen=True)
class HarnessDescriptor:
    """The canonical pair every BeheldEvent's `source` resolves to.

    `harness` is the portal-facing identifier serialized into
    enrichment.harness_sources[*].harness. Must be stable across versions —
    renaming requires a portal migration.

    `capture_fidelity` MUST be a member of CAPTURE_FIDELITY_VALUES.
    """
    harness: str
    capture_fidelity: str

    def __post_init__(self) -> None:
        if self.capture_fidelity not in CAPTURE_FIDELITY_VALUES:
            raise ValueError(
                f"capture_fidelity={self.capture_fidelity!r} not in closed enum "
                f"CAPTURE_FIDELITY_VALUES={CAPTURE_FIDELITY_VALUES}"
            )


# R1.1 baseline + R2 expansion. Keys are the writer-side source strings; do
# NOT add aliases here — every new harness gets one canonical source string.
HARNESS_REGISTRY: dict[str, HarnessDescriptor] = {
    # ── Phase 5 / R1.1 (existing) ───────────────────────────────────────
    "claude-code":    HarnessDescriptor("claude_code",    "native_hook"),
    "continue-vscode": HarnessDescriptor("continue_vscode", "editor_extension"),

    # ── R2 wave (added per-adapter as each subtask lands) ───────────────
    # R2.1 — Gemini CLI ships PreToolUse/PostToolUse/Stop hooks identical
    # in shape to Claude Code's, so the fidelity is `native_hook` (the
    # tool name comes from the harness itself, not inferred from logs).
    "gemini-cli": HarnessDescriptor("gemini_cli", "native_hook"),

    # R2.2 — Cursor has no public hook API. The adapter tails the local
    # Cursor log files under ~/Library/Application Support/Cursor/logs/
    # (macOS) or ~/.config/Cursor/logs/ (Linux), parses one JSON line per
    # tool/edit/chat event, and ingests via POST /hook/cursor/event. The
    # signal quality is lower than `native_hook` — log lines lag the
    # in-editor action, can be rotated/truncated, and the schema is not
    # guaranteed stable by Cursor — hence `local_log_tail`.
    "cursor": HarnessDescriptor("cursor", "local_log_tail"),

    # R2.3 — Codex CLI (OpenAI's `codex` binary) ships a Claude-Code-style
    # before_command/after_command/session_end hook surface. Same fidelity
    # tier as Claude Code and Gemini CLI.
    "codex-cli": HarnessDescriptor("codex_cli", "native_hook"),

    # R2.4 — GitHub Copilot CLI emits a short STATUSLINE on stderr while it
    # runs (the "Suggestion / Explain / Execute" prompt) and writes a
    # local log file at ~/.config/github-copilot/cli.log (Linux) or
    # ~/Library/Application Support/GitHub Copilot/cli.log (macOS). The
    # adapter blends both: statusline polls produce coarse "in-session"
    # heartbeats; log-tail lines produce per-action events. The dominant
    # signal is the statusline (it's deterministic and harness-emitted),
    # so the registry pins the harness as `statusline`. Sessions that
    # only had log-tail events (no statusline poll captured) will still
    # ingest, but the recorded fidelity stays the harness-level default
    # — the per-event channel is annotated in `metadata.channel`.
    "copilot-cli": HarnessDescriptor("copilot_cli", "statusline"),

    # R2.5 — GitHub Copilot inside VS Code exposes no telemetry API. The
    # adapter tails the extension log under
    # ~/Library/Application Support/Code/logs/.../exthost/GitHub.copilot/
    # (macOS) or ~/.config/Code/logs/.../exthost/GitHub.copilot/ (Linux).
    # Each completion / inline-suggestion / chat-turn line becomes one
    # event. prompt_length and tokens are ESTIMATED from the line's
    # character count (Copilot never echoes counts), so the per-event
    # metadata.estimated=true flag is set and downstream readers may
    # apply lower weight. Fidelity tier: `local_log_tail` — same as
    # Cursor; the token-estimation caveat is metadata-only.
    "copilot-vscode": HarnessDescriptor("copilot_vscode", "local_log_tail"),
}


# Fallback used when an unknown source string lands in the JSONL — the
# event is still ingested (forward-compat for legacy fixtures and for
# adapters that ship between binary releases), but it surfaces as
# `inferred` so the portal can mark it visibly less trustworthy.
INFERRED_FALLBACK = HarnessDescriptor("unknown", "inferred")


def lookup(source: Optional[str]) -> HarnessDescriptor:
    """Resolve a source string to its descriptor.

    Returns INFERRED_FALLBACK when `source` is None or absent from the
    registry. NEVER raises — bundle generation must never abort because
    of a malformed fixture line.
    """
    if not source:
        return INFERRED_FALLBACK
    return HARNESS_REGISTRY.get(source, INFERRED_FALLBACK)


def known_sources() -> frozenset[str]:
    """The complete set of writer-side source strings the engine recognises.
    Used by tests to assert no caller invents a string outside the registry."""
    return frozenset(HARNESS_REGISTRY.keys())

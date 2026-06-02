"""R2 — harness_registry tests.

Pins the closed mapping from JSONL source-strings to (harness, capture_fidelity)
pairs. Every R2.x adapter that lands MUST add one test in the
`test_known_descriptors_*` group to cover the round-trip — if a new source
string is added without a test, this suite stays honest by failing the
"complete coverage" assertion at the bottom.
"""
import pytest

from harness_registry import (
    HARNESS_REGISTRY,
    HarnessDescriptor,
    INFERRED_FALLBACK,
    known_sources,
    lookup,
)
from models import CAPTURE_FIDELITY_VALUES


# ── HarnessDescriptor constructor invariants ───────────────────────────

def test_harness_descriptor_rejects_invalid_capture_fidelity():
    """The closed enum gate fires at construction so a typo can never
    land in HARNESS_REGISTRY without the test suite immediately failing."""
    with pytest.raises(ValueError, match="not in closed enum"):
        HarnessDescriptor(harness="x", capture_fidelity="bogus_fidelity")


def test_every_registered_descriptor_has_valid_fidelity():
    """Belt + suspenders — the dataclass already raises, but a test on
    the live registry catches the case where someone bypasses __post_init__
    by mutating the dict at runtime."""
    for src, desc in HARNESS_REGISTRY.items():
        assert desc.capture_fidelity in CAPTURE_FIDELITY_VALUES, (
            f"{src} -> {desc.capture_fidelity!r} not in closed enum"
        )


# ── lookup() — happy paths per known source ────────────────────────────

def test_known_descriptors_claude_code():
    """Phase 5 baseline — must remain stable across refundações."""
    d = lookup("claude-code")
    assert d.harness == "claude_code"
    assert d.capture_fidelity == "native_hook"


def test_known_descriptors_continue_vscode():
    """Phase 5 baseline — Continue.dev as editor extension."""
    d = lookup("continue-vscode")
    assert d.harness == "continue_vscode"
    assert d.capture_fidelity == "editor_extension"


def test_known_descriptors_gemini_cli():
    """R2.1 — Gemini CLI registers as native_hook."""
    d = lookup("gemini-cli")
    assert d.harness == "gemini_cli"
    assert d.capture_fidelity == "native_hook"


def test_known_descriptors_cursor():
    """R2.2 — Cursor registers as local_log_tail."""
    d = lookup("cursor")
    assert d.harness == "cursor"
    assert d.capture_fidelity == "local_log_tail"


def test_known_descriptors_codex_cli():
    """R2.3 — Codex CLI registers as native_hook."""
    d = lookup("codex-cli")
    assert d.harness == "codex_cli"
    assert d.capture_fidelity == "native_hook"


def test_known_descriptors_copilot_cli():
    """R2.4 — Copilot CLI registers as statusline (blend with log_tail
    annotated at the per-event metadata level, not the harness level)."""
    d = lookup("copilot-cli")
    assert d.harness == "copilot_cli"
    assert d.capture_fidelity == "statusline"


def test_known_descriptors_copilot_vscode():
    """R2.5 — Copilot VS Code registers as local_log_tail. Token-estimation
    caveat lives in per-event metadata, not the closed enum."""
    d = lookup("copilot-vscode")
    assert d.harness == "copilot_vscode"
    assert d.capture_fidelity == "local_log_tail"


# ── lookup() — fallback ───────────────────────────────────────────────

def test_lookup_unknown_source_returns_inferred_fallback():
    """Unknown source strings must NEVER abort bundle generation —
    they fall through to the `inferred` fidelity so the portal can
    surface lower trust visibly."""
    d = lookup("future-harness-not-yet-registered")
    assert d is INFERRED_FALLBACK
    assert d.capture_fidelity == "inferred"
    assert d.harness == "unknown"


def test_lookup_none_or_empty_returns_inferred_fallback():
    """Empty / None source strings (corrupted JSONL line) also fall
    back rather than raising."""
    assert lookup(None) is INFERRED_FALLBACK
    assert lookup("") is INFERRED_FALLBACK


# ── Registry coverage — every entry must have a happy-path test ───────

def test_every_known_source_is_explicitly_tested():
    """Every key in HARNESS_REGISTRY must have a matching
    test_known_descriptors_* function above. Catches adapters added
    silently without test coverage."""
    tested_sources = {
        "claude-code",
        "continue-vscode",
        "gemini-cli",
        "cursor",
        "codex-cli",
        "copilot-cli",
        "copilot-vscode",
    }
    missing = known_sources() - tested_sources
    assert not missing, (
        f"sources without test_known_descriptors_* coverage: {sorted(missing)}. "
        f"Add a test in test_harness_registry.py before the entry can land."
    )

"""R2/R3 — bundle wire validation, end-to-end.

Exercises the complete JSONL→engine→bundle pipeline for every registered
harness source, asserting that:

  1. Sessions inserted with different `source` strings are correctly
     **grouped** into a single HarnessSource per (harness, capture_fidelity).
  2. The `sessions` count reflects the grouping (one count per group, not
     per individual session).
  3. The `harness_sources[]` array is **sorted** by (harness, fidelity)
     so canonical bytes stay stable across insertion orders.
  4. The closed `capture_fidelity` enum holds for every entry.
  5. An unknown source string surfaces as
     (harness="unknown", capture_fidelity="inferred") — the INFERRED_FALLBACK
     path — instead of aborting bundle generation.
  6. An entirely empty session list still produces a valid single-entry
     fallback (R1.1 back-compat guarantee).

The DB layer is hit with the real `BeheldDB` against a temp file —
the integration value is in catching any silent drift between the writer
sources, the registry, and the bundle aggregator.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from bundle import build_bundle_payload
from harness_registry import HARNESS_REGISTRY, lookup
from models import CAPTURE_FIDELITY_VALUES, Scores, Session
from storage.sqlite import BeheldDB  # actual class name (alias of SQLiteStorage)


# ── helpers ────────────────────────────────────────────────────────────

def _mk_session(session_id: str, source: str, started: str = "2026-06-01T10:00:00+00:00") -> Session:
    return Session(
        session_id=session_id,
        source=source,
        started_at=datetime.fromisoformat(started),
        ended_at=datetime.fromisoformat(started),
        duration_minutes=10.0,
        event_count=5,
    )


@pytest.fixture
def db(tmp_path: Path) -> BeheldDB:
    """Fresh on-disk DB per test. init_schema() runs the SQL + migrations
    (the constructor only opens the path; init must be called explicitly)."""
    d = BeheldDB(tmp_path / "test.db")
    d.init_schema()
    return d


def _seed_scores(db: BeheldDB) -> None:
    """Bundle build refuses to run without scores — provide minimal ones."""
    db.save_scores(Scores(
        date="2026-06-01",
        prompt_quality=70, test_maturity=50, tech_breadth=60,
        growth_rate=45, overall=55, sessions_analyzed=1,
    ))


# ── R2.1–R2.5 + R3.1 — every registered source resolves cleanly ────────

def test_every_registered_source_groups_correctly(db: BeheldDB) -> None:
    """One session per registered source — bundle should emit one
    HarnessSource per descriptor with sessions=1 each."""
    _seed_scores(db)
    for i, source_str in enumerate(HARNESS_REGISTRY.keys()):
        db.save_session(_mk_session(f"s-{i}", source_str))

    payload = build_bundle_payload(db, beheld_version="0.4.0")
    hs = payload.enrichment.harness_sources

    # 8 currently registered sources → 8 distinct harnesses.
    expected = sorted(
        (desc.harness, desc.capture_fidelity)
        for desc in HARNESS_REGISTRY.values()
    )
    actual = [(h.harness, h.capture_fidelity) for h in hs]
    assert actual == expected, (
        f"harness_sources should be sorted by (harness, fidelity); got {actual}"
    )

    # Each group carries sessions=1 because we inserted exactly one per source.
    for entry in hs:
        assert entry.sessions == 1, f"{entry.harness} should aggregate to 1 session"


def test_grouping_aggregates_session_counts_per_descriptor(db: BeheldDB) -> None:
    """Multiple sessions from the same source roll up into one
    HarnessSource with the correct count — not one entry per session."""
    _seed_scores(db)
    for i in range(3):
        db.save_session(_mk_session(f"cc-{i}", "claude-code"))
    for i in range(2):
        db.save_session(_mk_session(f"gem-{i}", "gemini-cli"))
    db.save_session(_mk_session("cur-1", "cursor"))

    payload = build_bundle_payload(db, beheld_version="0.4.0")
    hs = {h.harness: h for h in payload.enrichment.harness_sources}

    assert hs["claude_code"].sessions == 3
    assert hs["gemini_cli"].sessions == 2
    assert hs["cursor"].sessions == 1
    assert hs["claude_code"].capture_fidelity == "native_hook"
    assert hs["gemini_cli"].capture_fidelity == "native_hook"
    assert hs["cursor"].capture_fidelity == "local_log_tail"


def test_unknown_source_falls_back_to_inferred(db: BeheldDB) -> None:
    """An adapter that ships ahead of the engine binary writes a source
    string the registry hasn't seen. Bundle generation must keep
    working — the entry surfaces as inferred instead of crashing."""
    _seed_scores(db)
    db.save_session(_mk_session("future-1", "future-harness-2027"))
    db.save_session(_mk_session("future-2", "future-harness-2027"))

    payload = build_bundle_payload(db, beheld_version="0.4.0")
    hs = payload.enrichment.harness_sources
    assert len(hs) == 1
    assert hs[0].harness == "unknown"
    assert hs[0].capture_fidelity == "inferred"
    assert hs[0].sessions == 2


def test_mixed_known_and_unknown_emit_separate_entries(db: BeheldDB) -> None:
    """A known and an unknown source side-by-side must produce two
    entries — one routed via the registry, one via INFERRED_FALLBACK.
    Both should pass the closed capture_fidelity enum check."""
    _seed_scores(db)
    db.save_session(_mk_session("cc", "claude-code"))
    db.save_session(_mk_session("future", "future-harness-2027"))

    payload = build_bundle_payload(db, beheld_version="0.4.0")
    hs = payload.enrichment.harness_sources
    assert len(hs) == 2
    harnesses = {h.harness for h in hs}
    assert harnesses == {"claude_code", "unknown"}
    for entry in hs:
        assert entry.capture_fidelity in CAPTURE_FIDELITY_VALUES


def test_empty_session_list_emits_back_compat_fallback(db: BeheldDB) -> None:
    """Zero sessions → R1.1 back-compat: one claude_code/native_hook
    entry with sessions=0 so downstream readers that expect at least
    one HarnessSource don't break."""
    _seed_scores(db)
    payload = build_bundle_payload(db, beheld_version="0.4.0")
    hs = payload.enrichment.harness_sources
    assert len(hs) == 1
    assert hs[0].harness == "claude_code"
    assert hs[0].capture_fidelity == "native_hook"
    assert hs[0].sessions == 0


def test_canonical_ordering_is_insertion_order_independent(db: BeheldDB) -> None:
    """Reordering save_session calls must NOT change the bundle's
    harness_sources order — canonical bytes depend on this."""
    _seed_scores(db)
    db.save_session(_mk_session("z1", "windsurf"))
    db.save_session(_mk_session("z2", "claude-code"))
    db.save_session(_mk_session("z3", "cursor"))

    payload = build_bundle_payload(db, beheld_version="0.4.0")
    actual = [(h.harness, h.capture_fidelity) for h in payload.enrichment.harness_sources]
    assert actual == sorted(actual), "harness_sources must be sorted lexicographically"


# ── per-registered-source sanity check (defensive against silent drift) ─

@pytest.mark.parametrize("source_str", list(HARNESS_REGISTRY.keys()))
def test_each_registered_source_round_trips_to_its_descriptor(
    db: BeheldDB, source_str: str
) -> None:
    """Smoke test parametrised over every registered source: a single
    session with that source string MUST round-trip to the registry's
    expected (harness, capture_fidelity) pair in the bundle."""
    _seed_scores(db)
    db.save_session(_mk_session(f"sid-{source_str}", source_str))

    payload = build_bundle_payload(db, beheld_version="0.4.0")
    hs = payload.enrichment.harness_sources
    assert len(hs) == 1, f"expected one HarnessSource for {source_str}, got {len(hs)}"

    expected = lookup(source_str)
    assert hs[0].harness == expected.harness
    assert hs[0].capture_fidelity == expected.capture_fidelity
    assert hs[0].sessions == 1

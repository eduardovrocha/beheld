"""Regression coverage for build_signals_minimal (identity_adapter).

Pre-F6.12 the ecosystem rollup silently produced empty `dominant` for every
dev because the `_EXT_TO_ECOSYSTEM` lookup keys had a leading dot (`.py`,
`.ts`) but the L1 extractor stored bare extensions (`py`, `ts`). Every
match missed, so the HTML retrato showed "Linguagem dominante: —" no matter
how much code the dev had imported. This file pins both shapes."""

from __future__ import annotations

from collections import Counter
from pathlib import Path

import pytest

from identity_adapter import (
    _classify_ecosystems,
    _ecosystems_from_extensions,
    build_signals_minimal,
)
from storage.sqlite import BeheldDB


@pytest.fixture
def db(tmp_path: Path) -> BeheldDB:
    d = BeheldDB(tmp_path / "profile.db")
    d.init_schema()
    yield d
    d.close()


# ── _ecosystems_from_extensions — the bug surface ─────────────────────────


def test_extensions_with_or_without_dot() -> None:
    """Both ".py" and "py" (and case variants) must map to "python".

    The L1 extractor strips the dot at storage time; the dev-facing
    ecosystem map writes with dots for human readability. The lookup
    bridges both — silently dropping either form is the original bug."""
    without_dot = _ecosystems_from_extensions(Counter({"py": 100, "ts": 50}))
    assert without_dot["python"] == 100
    assert without_dot["node"] == 50

    with_dot = _ecosystems_from_extensions(Counter({".py": 100, ".ts": 50}))
    assert with_dot == without_dot

    upper = _ecosystems_from_extensions(Counter({"PY": 7, ".TS": 3}))
    assert upper["python"] == 7
    assert upper["node"] == 3


def test_unknown_extensions_silently_dropped() -> None:
    """Extensions outside the map are ignored — md/json/lock shouldn't
    inflate any ecosystem."""
    out = _ecosystems_from_extensions(Counter({
        "md": 200, "json": 100, "lock": 50, "py": 10,
    }))
    assert out == Counter({"python": 10})


# ── _classify_ecosystems — buckets ───────────────────────────────────────


def test_classify_promotes_top_above_25pct_to_dominant() -> None:
    """Threshold is 25% share. Top-2 above threshold both promote."""
    out = _classify_ecosystems(Counter({"python": 600, "node": 400}))
    # 60% + 40% — both above 25%, both dominant.
    assert out["dominant"] == ["python", "node"]
    assert out["secondary"] == []


def test_classify_keeps_below_threshold_in_secondary() -> None:
    """A 20% share doesn't qualify as dominant — falls to secondary."""
    out = _classify_ecosystems(Counter({"python": 800, "node": 200}))
    assert out["dominant"] == ["python"]      # 80% — dominant
    assert "node" in out["secondary"]          # 20% — below 25%, secondary


def test_classify_keeps_small_shares_as_secondary() -> None:
    out = _classify_ecosystems(Counter({
        "node": 900, "python": 80, "go": 20,
    }))
    assert out["dominant"] == ["node"]      # 90%
    assert "python" in out["secondary"]      # 8% → secondary
    assert "go" in out["secondary"]          # 2% → secondary


def test_classify_empty_counter_returns_empty_buckets() -> None:
    out = _classify_ecosystems(Counter())
    assert out == {"dominant": [], "secondary": [], "emerging": [], "declining": []}


# ── build_signals_minimal — end-to-end against a seeded DB ────────────────


def test_build_signals_minimal_dominant_not_empty_after_l1_import(
    db: BeheldDB,
) -> None:
    """Seed a repo with TypeScript-heavy file_extensions in the bare/no-dot
    shape the extractor actually emits — `dominant` MUST come out populated
    (this is the precise regression the HTML retrato exposed)."""
    db.save_l1_repository("hash1", "2026-05-24T00:00:00+00:00", 100, "eh")
    db.save_l1_signals(
        root_commit_hash="hash1",
        file_extensions={"ts": 800, "tsx": 50, "py": 100, "md": 200},
        ecosystems={"node": True, "python": True},
        platforms={"github": True, "docker": True},
        test_ratio=0.1,
        timing={},
        first_commit_at="2026-01-01T00:00:00+00:00",
        last_commit_at="2026-05-20T00:00:00+00:00",
    )

    signals = build_signals_minimal(db)
    eco = signals["ecosystems"]
    # node = .ts(800) + .tsx is "react" — let me check map. .tsx → "react"
    # so for THIS fixture: node=800, react=50, python=100 → node dominant.
    assert eco["dominant"], "dominant must not be empty when L1 has TypeScript"
    assert "node" in eco["dominant"]


def test_build_signals_minimal_empty_db_returns_empty_buckets(db: BeheldDB) -> None:
    """Empty DB shouldn't crash and shouldn't fabricate ecosystems."""
    signals = build_signals_minimal(db)
    eco = signals["ecosystems"]
    assert eco["dominant"] == []
    assert eco["secondary"] == []

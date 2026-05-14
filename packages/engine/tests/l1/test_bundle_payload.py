"""F6.8 — Bundle payload integration tests.

Asserts that the .dpbundle payload built by `build_bundle_payload` exposes
L1 and L2 as separate top-level keys, with L1 staying empty (but present)
when no repository has been imported."""

from __future__ import annotations

import dataclasses

import pytest

from bundle import build_bundle_payload
from models import Scores, WorkflowMetrics
from storage.sqlite import DevProfileDB


@pytest.fixture
def db_with_scores() -> DevProfileDB:
    """A minimal DB that build_bundle_payload accepts (it requires at least
    one scores row — otherwise it raises ValueError)."""
    db = DevProfileDB(":memory:")
    db.init_schema()
    db.save_scores(Scores(
        date="2026-05-14",
        prompt_quality=50, test_maturity=20, tech_breadth=40,
        growth_rate=30, overall=35, sessions_analyzed=10,
    ))
    db.save_workflow_metrics(WorkflowMetrics(test_after_ratio=0.6), 30, 10)
    yield db
    db.close()


def _payload_dict(db: DevProfileDB) -> dict:
    return dataclasses.asdict(build_bundle_payload(db, "0.1.0"))


# ── L1 presence ──────────────────────────────────────────────────────────────


def test_payload_includes_l1_section(db_with_scores: DevProfileDB) -> None:
    db_with_scores.save_l1_repository("hash-1", "2026-05-14T00:00:00+00:00", 100, "email-hash")
    db_with_scores.save_l1_signals(
        "hash-1",
        file_extensions={"py": 200},
        ecosystems={"python": True},
        platforms={"docker": True},
        test_ratio=0.42,
        timing={"peak_hours": [10, 11]},
        first_commit_at="2024-01-01T00:00:00+00:00",
        last_commit_at="2026-05-10T00:00:00+00:00",
    )
    p = _payload_dict(db_with_scores)
    assert "l1" in p
    assert p["l1"]["total_repos"] == 1
    assert p["l1"]["total_commits"] == 100
    assert p["l1"]["ecosystems"] == {"python": True}
    assert p["l1"]["platforms"] == {"docker": True}
    assert p["l1"]["avg_test_ratio"] == pytest.approx(0.42)


def test_payload_l1_empty_when_no_bootstrap(db_with_scores: DevProfileDB) -> None:
    """The L1 key is ALWAYS present in v2 payloads — empty, not absent."""
    p = _payload_dict(db_with_scores)
    assert "l1" in p
    assert p["l1"]["total_repos"] == 0
    assert p["l1"]["total_commits"] == 0
    assert p["l1"]["earliest_commit"] is None
    assert p["l1"]["latest_commit"] is None
    assert p["l1"]["ecosystems"] == {}
    assert p["l1"]["platforms"] == {}
    assert p["l1"]["avg_test_ratio"] == 0.0
    assert p["l1"]["root_commit_hashes"] == []


def test_payload_l1_contains_root_commit_hashes(db_with_scores: DevProfileDB) -> None:
    db_with_scores.save_l1_repository("hash-A", "2026-05-14T00:00:00+00:00", 10, "e")
    db_with_scores.save_l1_signals("hash-A", {}, {}, {}, 0.0, {}, None, None)
    db_with_scores.save_l1_repository("hash-B", "2026-05-14T00:00:00+00:00", 20, "e")
    db_with_scores.save_l1_signals("hash-B", {}, {}, {}, 0.0, {}, None, None)

    p = _payload_dict(db_with_scores)
    assert sorted(p["l1"]["root_commit_hashes"]) == ["hash-A", "hash-B"]


def test_payload_l1_root_commit_hashes_are_sorted(db_with_scores: DevProfileDB) -> None:
    """Canonical JSON requires deterministic ordering — the list itself is
    pre-sorted so the bundle hash is reproducible regardless of import order."""
    db_with_scores.save_l1_repository("zzz", "2026-05-14T00:00:00+00:00", 1, "e")
    db_with_scores.save_l1_signals("zzz", {}, {}, {}, 0.0, {}, None, None)
    db_with_scores.save_l1_repository("aaa", "2026-05-14T00:00:00+00:00", 1, "e")
    db_with_scores.save_l1_signals("aaa", {}, {}, {}, 0.0, {}, None, None)

    p = _payload_dict(db_with_scores)
    assert p["l1"]["root_commit_hashes"] == ["aaa", "zzz"]


# ── privacy: only opaque values ──────────────────────────────────────────────


def test_payload_l1_contains_no_text_fields(db_with_scores: DevProfileDB) -> None:
    """No URLs, names, paths, or commit messages — only hashes, booleans,
    numbers, and ISO timestamps."""
    db_with_scores.save_l1_repository("hash-1", "2026-05-14T00:00:00+00:00", 100, "email-hash")
    db_with_scores.save_l1_signals(
        "hash-1",
        file_extensions={"py": 5, "rb": 3},
        ecosystems={"python": True, "rails": True},
        platforms={"docker": True},
        test_ratio=0.3,
        timing={"peak_hours": [10]},
        first_commit_at="2024-01-01T00:00:00+00:00",
        last_commit_at="2026-05-10T00:00:00+00:00",
    )
    l1 = _payload_dict(db_with_scores)["l1"]

    # All values must be: number, bool, str-hash, str-iso, list of hashes, or
    # dict whose values are bool/number.
    iso_keys = {"earliest_commit", "latest_commit"}
    bool_dict_keys = {"ecosystems", "platforms"}
    hash_list_key = "root_commit_hashes"

    for key, value in l1.items():
        if key in iso_keys:
            assert value is None or "T" in value
        elif key in bool_dict_keys:
            assert isinstance(value, dict)
            for v in value.values():
                assert isinstance(v, bool)
        elif key == hash_list_key:
            assert isinstance(value, list)
            for h in value:
                # Hashes are opaque tokens — no spaces, no slashes, no @.
                assert isinstance(h, str)
                assert " " not in h and "/" not in h and "@" not in h
        else:
            # Remaining fields are numeric counts / ratios.
            assert isinstance(value, (int, float))


# ── L2 continuity from Phase 5 ───────────────────────────────────────────────


def test_payload_l2_section_unchanged_from_phase5(db_with_scores: DevProfileDB) -> None:
    """The L2 section preserves the exact shape that `signals` had in Phase 5
    so existing scoring and rendering code keeps working."""
    p = _payload_dict(db_with_scores)
    assert "l2" in p
    expected_keys = {
        "platforms", "ecosystems", "workflow_distribution",
        "project_categories", "workflow_metrics",
        "sessions_analyzed", "period_days",
    }
    assert expected_keys <= set(p["l2"].keys())


# ── separation invariant ─────────────────────────────────────────────────────


def test_payload_l1_and_l2_are_separate_keys(db_with_scores: DevProfileDB) -> None:
    """L1 and L2 are distinct top-level objects — never merged or duplicated."""
    db_with_scores.save_l1_repository("hash-1", "2026-05-14T00:00:00+00:00", 10, "e")
    db_with_scores.save_l1_signals(
        "hash-1",
        file_extensions={},
        ecosystems={"python": True},
        platforms={"docker": True},
        test_ratio=0.0,
        timing={},
        first_commit_at=None,
        last_commit_at=None,
    )
    p = _payload_dict(db_with_scores)
    assert isinstance(p["l1"], dict)
    assert isinstance(p["l2"], dict)
    # No shared identity (different dicts).
    assert id(p["l1"]) != id(p["l2"])
    # The L1 ecosystem dict (booleans) is structurally different from L2's
    # (counts), confirming they're populated independently.
    if p["l1"]["ecosystems"]:
        for v in p["l1"]["ecosystems"].values():
            assert isinstance(v, bool)
    for v in p["l2"]["ecosystems"].values():
        assert isinstance(v, int) and not isinstance(v, bool)


# ── legacy key is removed ────────────────────────────────────────────────────


def test_payload_no_legacy_signals_key(db_with_scores: DevProfileDB) -> None:
    """`signals` was the Phase 5 name. v2 payloads must use `l2` instead."""
    p = _payload_dict(db_with_scores)
    assert "signals" not in p

from __future__ import annotations

import json

import pytest

from storage.sqlite import BeheldDB


@pytest.fixture
def db() -> BeheldDB:
    instance = BeheldDB(":memory:")
    instance.init_schema()
    yield instance
    instance.close()


# ── repositories ─────────────────────────────────────────────────────────────


def test_save_l1_repository_inserts_correctly(db: BeheldDB) -> None:
    created = db.save_l1_repository(
        root_commit_hash="a" * 40,
        imported_at="2026-05-14T10:00:00+00:00",
        commit_count=312,
        author_email_hash="b" * 64,
    )
    assert created is True
    row = db.connect().execute(
        "SELECT * FROM l1_repositories WHERE root_commit_hash = ?", ("a" * 40,)
    ).fetchone()
    assert row is not None
    assert row["commit_count"] == 312
    assert row["author_email_hash"] == "b" * 64
    assert row["imported_at"] == "2026-05-14T10:00:00+00:00"


def test_save_l1_repository_idempotent(db: BeheldDB) -> None:
    first = db.save_l1_repository("h1", "2026-05-14T10:00:00+00:00", 10, "e1")
    second = db.save_l1_repository("h1", "2026-05-14T11:00:00+00:00", 99, "e1")
    assert first is True
    assert second is False
    # Original row must remain untouched.
    row = db.connect().execute(
        "SELECT commit_count, imported_at FROM l1_repositories WHERE root_commit_hash = ?",
        ("h1",),
    ).fetchone()
    assert row["commit_count"] == 10
    assert row["imported_at"] == "2026-05-14T10:00:00+00:00"


# ── signals ──────────────────────────────────────────────────────────────────


def test_save_l1_signals_stores_json_fields(db: BeheldDB) -> None:
    db.save_l1_repository("h1", "2026-05-14T10:00:00+00:00", 50, "e1")
    db.save_l1_signals(
        root_commit_hash="h1",
        file_extensions={"py": 312, "rb": 88},
        ecosystems={"rails": True, "python": True},
        platforms={"docker": True, "github": True},
        test_ratio=0.42,
        timing={"peak_hours": [9, 10], "avg_duration_min": 42},
        first_commit_at="2024-01-01T00:00:00+00:00",
        last_commit_at="2026-05-13T00:00:00+00:00",
    )
    row = db.connect().execute(
        "SELECT * FROM l1_signals WHERE root_commit_hash = ?", ("h1",)
    ).fetchone()
    assert row is not None
    assert json.loads(row["file_extensions"]) == {"py": 312, "rb": 88}
    assert json.loads(row["ecosystems"]) == {"rails": True, "python": True}
    assert json.loads(row["platforms"]) == {"docker": True, "github": True}
    assert row["test_ratio"] == pytest.approx(0.42)
    assert json.loads(row["timing"]) == {"peak_hours": [9, 10], "avg_duration_min": 42}
    assert row["first_commit_at"] == "2024-01-01T00:00:00+00:00"
    assert row["last_commit_at"] == "2026-05-13T00:00:00+00:00"


def test_save_l1_signals_replaces_existing(db: BeheldDB) -> None:
    """Re-importing a repo should overwrite stale signals, not duplicate them."""
    db.save_l1_repository("h1", "2026-05-14T10:00:00+00:00", 50, "e1")
    db.save_l1_signals("h1", {"py": 1}, {}, {}, 0.1, {}, None, None)
    db.save_l1_signals("h1", {"rb": 5}, {"rails": True}, {}, 0.5, {}, None, None)
    rows = db.connect().execute(
        "SELECT * FROM l1_signals WHERE root_commit_hash = ?", ("h1",)
    ).fetchall()
    assert len(rows) == 1
    assert json.loads(rows[0]["file_extensions"]) == {"rb": 5}


# ── summary view ─────────────────────────────────────────────────────────────


def test_get_l1_summary_empty_returns_zeros(db: BeheldDB) -> None:
    summary = db.get_l1_summary()
    assert summary["total_repos"] == 0
    assert summary["total_commits"] == 0
    assert summary["earliest_commit"] is None
    assert summary["latest_commit"] is None
    assert summary["ecosystems_merged"] == {}
    assert summary["platforms_merged"] == {}
    assert summary["extensions_merged"] == {}
    assert summary["avg_test_ratio"] == 0.0


def test_get_l1_summary_with_data(db: BeheldDB) -> None:
    db.save_l1_repository("h1", "2026-05-14T10:00:00+00:00", 100, "e1")
    db.save_l1_signals(
        "h1",
        file_extensions={"py": 200, "rb": 50},
        ecosystems={"python": True, "rails": True},
        platforms={"docker": True},
        test_ratio=0.30,
        timing={"peak_hours": [9, 10]},
        first_commit_at="2024-01-01T00:00:00+00:00",
        last_commit_at="2026-05-10T00:00:00+00:00",
    )

    db.save_l1_repository("h2", "2026-05-14T11:00:00+00:00", 200, "e1")
    db.save_l1_signals(
        "h2",
        file_extensions={"py": 100, "ts": 75},
        ecosystems={"python": True, "node": True},
        platforms={"github": True},
        test_ratio=0.50,
        timing={"peak_hours": [14, 15]},
        first_commit_at="2023-06-01T00:00:00+00:00",
        last_commit_at="2026-05-13T00:00:00+00:00",
    )

    s = db.get_l1_summary()
    assert s["total_repos"] == 2
    assert s["total_commits"] == 300
    assert s["earliest_commit"] == "2023-06-01T00:00:00+00:00"
    assert s["latest_commit"] == "2026-05-13T00:00:00+00:00"
    assert s["extensions_merged"] == {"py": 300, "rb": 50, "ts": 75}
    assert s["ecosystems_merged"] == {"python": True, "rails": True, "node": True}
    assert s["platforms_merged"] == {"docker": True, "github": True}
    assert s["avg_test_ratio"] == pytest.approx(0.40)


# ── listing ──────────────────────────────────────────────────────────────────


def test_get_l1_repositories_returns_list(db: BeheldDB) -> None:
    assert db.get_l1_repositories() == []
    db.save_l1_repository("h1", "2026-05-14T10:00:00+00:00", 10, "e1")
    db.save_l1_repository("h2", "2026-05-14T11:00:00+00:00", 20, "e1")
    repos = db.get_l1_repositories()
    assert len(repos) == 2
    hashes = {r["root_commit_hash"] for r in repos}
    assert hashes == {"h1", "h2"}
    for r in repos:
        assert set(r.keys()) == {"root_commit_hash", "imported_at", "commit_count", "first_seen_at"}


# ── deletion ─────────────────────────────────────────────────────────────────


def test_delete_l1_repository_removes_signals_cascade(db: BeheldDB) -> None:
    db.save_l1_repository("h1", "2026-05-14T10:00:00+00:00", 10, "e1")
    db.save_l1_signals("h1", {"py": 5}, {"python": True}, {}, 0.2, {}, None, None)

    removed = db.delete_l1_repository("h1")
    assert removed is True

    repo_row = db.connect().execute(
        "SELECT 1 FROM l1_repositories WHERE root_commit_hash = ?", ("h1",)
    ).fetchone()
    signal_row = db.connect().execute(
        "SELECT 1 FROM l1_signals WHERE root_commit_hash = ?", ("h1",)
    ).fetchone()
    assert repo_row is None
    assert signal_row is None


def test_delete_l1_repository_not_found_returns_false(db: BeheldDB) -> None:
    assert db.delete_l1_repository("does-not-exist") is False

"""Tests for R1.2a — L1 monthly_buckets data model.

Covers:
  - storage layer: save_l1_monthly_buckets idempotency, get_l1_monthly_buckets
    aggregation (commit_count sum, test_ratio weighted avg, ecosystems/platforms
    union, repo_hashes set).
  - L1Snapshot.from_summary deserializes monthly_buckets correctly.
  - L1Snapshot.total_history_months + buckets_in_range work as expected.
  - L1Snapshot.monthly_buckets is empty for legacy data (no rows in
    l1_monthly_buckets) — confirms the no-backfill stance.
  - delete_l1_repository cascades to monthly buckets.

R1.2b will exercise these from inside GrowthRateScorer.
"""
import pytest
from storage.sqlite import BeheldDB
from scorers.base import L1Snapshot, MonthlyBucket


@pytest.fixture
def db():
    return BeheldDB(":memory:").__class__(":memory:") if False else (
        lambda: (lambda d: (d.init_schema(), d)[1])(BeheldDB(":memory:"))
    )()


def _seed_repo(db, root, eco, plat, test_ratio, first_at, last_at):
    db.save_l1_repository(
        root_commit_hash=root,
        imported_at="2026-06-01T00:00:00+00:00",
        commit_count=sum(1 for _ in eco),
        author_email_hash="hash",
    )
    db.save_l1_signals(
        root_commit_hash=root,
        file_extensions={".py": 1},
        ecosystems=eco,
        platforms=plat,
        test_ratio=test_ratio,
        timing={},
        first_commit_at=first_at,
        last_commit_at=last_at,
    )


def test_save_and_get_monthly_buckets_single_repo(db):
    _seed_repo(
        db, "repo-a",
        eco={"python": True, "rails": True},
        plat={"docker": True},
        test_ratio=0.40,
        first_at="2024-01-15T00:00:00+00:00",
        last_at="2026-05-20T00:00:00+00:00",
    )
    db.save_l1_monthly_buckets("repo-a", {"2024-01": 3, "2024-02": 5, "2026-05": 2})
    buckets = db.get_l1_monthly_buckets()
    assert sorted(buckets.keys()) == ["2024-01", "2024-02", "2026-05"]
    assert buckets["2024-01"]["commit_count"] == 3
    assert buckets["2024-02"]["commit_count"] == 5
    assert buckets["2026-05"]["commit_count"] == 2
    # Single-repo: ecosystems/platforms/repo_hashes match the repo's globals.
    assert buckets["2024-01"]["ecosystems"] == ["python", "rails"]
    assert buckets["2024-01"]["platforms"] == ["docker"]
    assert buckets["2024-01"]["repo_hashes"] == ["repo-a"]
    # Single-repo test_ratio equals the repo's ratio.
    assert buckets["2024-01"]["test_ratio"] == pytest.approx(0.40)


def test_get_monthly_buckets_multi_repo_aggregates(db):
    _seed_repo(db, "repo-a", {"python": True}, {"docker": True}, 0.40,
               "2024-01-01T00:00:00+00:00", "2024-12-31T00:00:00+00:00")
    _seed_repo(db, "repo-b", {"rails": True}, {"github": True}, 0.80,
               "2024-06-01T00:00:00+00:00", "2024-12-31T00:00:00+00:00")
    db.save_l1_monthly_buckets("repo-a", {"2024-06": 4})  # 4 commits in repo-a at 0.40
    db.save_l1_monthly_buckets("repo-b", {"2024-06": 2})  # 2 commits in repo-b at 0.80
    buckets = db.get_l1_monthly_buckets()
    assert "2024-06" in buckets
    b = buckets["2024-06"]
    # commit_count = 4 + 2
    assert b["commit_count"] == 6
    # ecosystems = union, platforms = union, repo_hashes = set
    assert b["ecosystems"] == ["python", "rails"]
    assert b["platforms"] == ["docker", "github"]
    assert b["repo_hashes"] == ["repo-a", "repo-b"]
    # test_ratio commit-weighted: (0.40 * 4 + 0.80 * 2) / 6 = 3.2/6 = 0.5333...
    assert b["test_ratio"] == pytest.approx((0.40 * 4 + 0.80 * 2) / 6)


def test_save_monthly_buckets_is_idempotent_per_repo(db):
    _seed_repo(db, "repo-a", {"python": True}, {}, 0.5,
               "2024-01-01T00:00:00+00:00", "2024-03-31T00:00:00+00:00")
    db.save_l1_monthly_buckets("repo-a", {"2024-01": 3, "2024-02": 5})
    # Re-save with different values — must replace, not duplicate.
    db.save_l1_monthly_buckets("repo-a", {"2024-01": 10, "2024-03": 7})
    buckets = db.get_l1_monthly_buckets()
    assert sorted(buckets.keys()) == ["2024-01", "2024-03"]
    assert buckets["2024-01"]["commit_count"] == 10
    assert buckets["2024-03"]["commit_count"] == 7


def test_save_monthly_buckets_skips_zero_counts(db):
    _seed_repo(db, "repo-a", {"python": True}, {}, 0.0,
               "2024-01-01T00:00:00+00:00", "2024-01-31T00:00:00+00:00")
    db.save_l1_monthly_buckets("repo-a", {"2024-01": 5, "2024-02": 0, "2024-03": 3})
    buckets = db.get_l1_monthly_buckets()
    # Zero-count months are filtered before insert.
    assert "2024-02" not in buckets
    assert sorted(buckets.keys()) == ["2024-01", "2024-03"]


def test_save_monthly_buckets_empty_dict_clears_rows(db):
    _seed_repo(db, "repo-a", {"python": True}, {}, 0.0,
               "2024-01-01T00:00:00+00:00", "2024-03-31T00:00:00+00:00")
    db.save_l1_monthly_buckets("repo-a", {"2024-01": 3})
    db.save_l1_monthly_buckets("repo-a", {})  # Empty payload → wipe rows.
    buckets = db.get_l1_monthly_buckets()
    assert buckets == {}


def test_get_monthly_buckets_returns_empty_when_no_data(db):
    # Fresh DB without any imported repo — no rows.
    assert db.get_l1_monthly_buckets() == {}


def test_l1_summary_includes_monthly_buckets(db):
    _seed_repo(db, "repo-a", {"python": True}, {"docker": True}, 0.42,
               "2024-01-01T00:00:00+00:00", "2025-06-30T00:00:00+00:00")
    db.save_l1_monthly_buckets("repo-a", {"2024-01": 5, "2025-06": 3})
    summary = db.get_l1_summary()
    assert "monthly_buckets" in summary
    assert sorted(summary["monthly_buckets"].keys()) == ["2024-01", "2025-06"]


def test_l1_snapshot_from_summary_deserializes_monthly_buckets(db):
    _seed_repo(db, "repo-a", {"python": True}, {"docker": True}, 0.5,
               "2024-01-01T00:00:00+00:00", "2025-12-31T00:00:00+00:00")
    db.save_l1_monthly_buckets("repo-a", {"2024-03": 7, "2025-12": 2})
    snap = L1Snapshot.from_summary(db.get_l1_summary())
    assert set(snap.monthly_buckets.keys()) == {"2024-03", "2025-12"}
    b = snap.monthly_buckets["2024-03"]
    assert isinstance(b, MonthlyBucket)
    assert b.month == "2024-03"
    assert b.commit_count == 7
    assert b.test_ratio == pytest.approx(0.5)
    assert b.ecosystems == {"python"}
    assert b.platforms == {"docker"}
    assert b.repo_hashes == {"repo-a"}


def test_l1_snapshot_total_history_months(db):
    _seed_repo(db, "repo-a", {"python": True}, {}, 0.0,
               "2024-01-01T00:00:00+00:00", "2026-06-30T00:00:00+00:00")
    db.save_l1_monthly_buckets("repo-a", {"2024-01": 1, "2026-06": 1})
    snap = L1Snapshot.from_summary(db.get_l1_summary())
    # 2024-01 to 2026-06 = 2 years and 5 months = 29 months.
    assert snap.total_history_months == 29


def test_l1_snapshot_total_history_months_zero_when_missing(db):
    # No commits → no earliest/latest → 0 months.
    snap = L1Snapshot.from_summary({})
    assert snap.total_history_months == 0


def test_l1_snapshot_buckets_in_range_filters_correctly(db):
    _seed_repo(db, "repo-a", {"python": True}, {}, 0.0,
               "2024-01-01T00:00:00+00:00", "2025-12-31T00:00:00+00:00")
    db.save_l1_monthly_buckets("repo-a", {
        "2024-01": 1, "2024-06": 2, "2024-12": 3, "2025-01": 4, "2025-06": 5,
    })
    snap = L1Snapshot.from_summary(db.get_l1_summary())
    # First-12-month baseline window — 2024-01 to 2024-12 inclusive.
    baseline = snap.buckets_in_range("2024-01", "2024-12")
    assert sorted(b.month for b in baseline) == ["2024-01", "2024-06", "2024-12"]
    # Last-6-month current window — 2025-01 to 2025-06 inclusive.
    current = snap.buckets_in_range("2025-01", "2025-06")
    assert sorted(b.month for b in current) == ["2025-01", "2025-06"]
    # Empty range.
    none = snap.buckets_in_range("2030-01", "2030-12")
    assert none == []


def test_delete_l1_repository_cascades_to_monthly_buckets(db):
    _seed_repo(db, "repo-a", {"python": True}, {}, 0.0,
               "2024-01-01T00:00:00+00:00", "2024-12-31T00:00:00+00:00")
    db.save_l1_monthly_buckets("repo-a", {"2024-01": 3, "2024-06": 5})
    assert db.get_l1_monthly_buckets() != {}
    deleted = db.delete_l1_repository("repo-a")
    assert deleted is True
    assert db.get_l1_monthly_buckets() == {}


def test_legacy_repo_without_monthly_buckets_yields_empty_dict(db):
    # Repo imported before R1.2a — has l1_signals but no l1_monthly_buckets rows.
    _seed_repo(db, "legacy-repo", {"python": True}, {}, 0.3,
               "2023-01-01T00:00:00+00:00", "2024-12-31T00:00:00+00:00")
    # No save_l1_monthly_buckets call — simulating pre-R1.2a data.
    summary = db.get_l1_summary()
    assert summary["monthly_buckets"] == {}
    snap = L1Snapshot.from_summary(summary)
    assert snap.monthly_buckets == {}
    # total_history_months still works (uses earliest/latest_commit, not buckets).
    assert snap.total_history_months == 23

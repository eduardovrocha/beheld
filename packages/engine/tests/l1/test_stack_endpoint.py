"""F6.12c — endpoint-level checks for GET /l1/stack.

These tests focus on the HTTP surface (status, headers, ordering, math)
rather than the underlying aggregation logic — that's covered in
test_stack_extractor.py."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from api import app
from l1.architecture_detector import ArchitecturePattern
from l1.git_extractor import LanguageWeight
from l1.importer import L1Importer
from storage.sqlite import BeheldDB


# ── fixtures (mirror test_stack_extractor.py / test_l1_endpoints.py) ─────────


@pytest.fixture
def test_db(tmp_path: Path) -> BeheldDB:
    db = BeheldDB(tmp_path / "profile.db")
    db.init_schema()
    yield db
    db.close()


@pytest.fixture
def client(test_db: BeheldDB):
    importer = L1Importer(test_db)
    with patch("api.db", test_db), \
         patch("api.l1_importer", importer), \
         patch("api.insights_gen"), \
         patch("apscheduler.schedulers.asyncio.AsyncIOScheduler.start"), \
         patch("apscheduler.schedulers.asyncio.AsyncIOScheduler.shutdown"):
        with TestClient(app) as c:
            yield c


def _seed_three_langs(db: BeheldDB) -> None:
    """Populate two repos with overlapping languages so the aggregation
    actually has to add commit counts across rows."""
    db.save_l1_repository("hashA", "2026-01-01T00:00:00+00:00", 10, "eh")
    db.save_l1_repository("hashB", "2026-01-02T00:00:00+00:00", 5, "eh")
    db.save_l1_language_weights(
        "hashA",
        [
            LanguageWeight("Ruby", commit_count=6, file_count=40,
                           first_seen="2024-03-10", last_seen="2026-05-01"),
            LanguageWeight("Python", commit_count=3, file_count=12,
                           first_seen="2025-01-15", last_seen="2025-11-20"),
            LanguageWeight("Go", commit_count=1, file_count=2,
                           first_seen="2026-02-01", last_seen="2026-02-15"),
        ],
    )
    db.save_l1_language_weights(
        "hashB",
        [
            LanguageWeight("Python", commit_count=4, file_count=14,
                           first_seen="2025-12-01", last_seen="2026-01-30"),
            LanguageWeight("Ruby", commit_count=2, file_count=8,
                           first_seen="2026-01-05", last_seen="2026-01-28"),
        ],
    )


def _seed_patterns(db: BeheldDB) -> None:
    db.save_l1_repository("hashA", "2026-01-01T00:00:00+00:00", 1, "eh")
    db.save_l1_repository("hashB", "2026-01-02T00:00:00+00:00", 1, "eh")
    db.save_l1_repository("hashC", "2026-01-03T00:00:00+00:00", 1, "eh")
    db.save_l1_architecture_patterns(
        "hashA",
        [
            ArchitecturePattern("mvc", "strong"),
            ArchitecturePattern("ci_cd", "strong"),
        ],
    )
    db.save_l1_architecture_patterns(
        "hashB",
        [
            ArchitecturePattern("mvc", "strong"),
            ArchitecturePattern("ci_cd", "strong"),
            ArchitecturePattern("monorepo", "strong"),
        ],
    )
    db.save_l1_architecture_patterns(
        "hashC",
        [ArchitecturePattern("ci_cd", "strong")],
    )


# ── tests ────────────────────────────────────────────────────────────────────


def test_stack_endpoint_cors_header_present(client: TestClient) -> None:
    """F6.12c — the snapshot HTML page may be opened from any local origin
    (file://, http://localhost:any), so the engine must explicitly allow
    cross-origin reads on this endpoint. The header is scoped to
    /l1/stack and /health only — other endpoints stay closed."""
    res = client.get("/l1/stack")
    assert res.status_code == 200
    assert res.headers.get("access-control-allow-origin") == "*"


def test_stack_endpoint_weight_pct_sums_to_100(
    client: TestClient, test_db: BeheldDB
) -> None:
    """Per-language weight_pct shares must sum to ≤ 100 (rounding can dip
    slightly below). Anything > 100 means an aggregation bug."""
    _seed_three_langs(test_db)
    body = client.get("/l1/stack").json()
    total = sum(lang["weight_pct"] for lang in body["language_distribution"])
    assert total <= 100.0
    # Three languages with non-trivial weight — sum should be close to 100.
    assert total >= 99.5


def test_stack_endpoint_ordered_by_commit_count_desc(
    client: TestClient, test_db: BeheldDB
) -> None:
    """Languages must come back sorted by total commit_count descending so
    the renderer (CLI table + HTML bars) can trust the order without
    re-sorting."""
    _seed_three_langs(test_db)
    body = client.get("/l1/stack").json()
    langs = body["language_distribution"]
    # Ruby 6+2=8, Python 3+4=7, Go 1 → expected order.
    assert [l["language"] for l in langs] == ["Ruby", "Python", "Go"]
    counts = [l["commit_count"] for l in langs]
    assert counts == sorted(counts, reverse=True)


def test_stack_endpoint_architecture_ordered_by_repo_count_desc(
    client: TestClient, test_db: BeheldDB
) -> None:
    """Architecture patterns must come back sorted by repo_count descending
    (ties broken alphabetically by pattern name)."""
    _seed_patterns(test_db)
    body = client.get("/l1/stack").json()
    patterns = body["architecture_patterns"]
    # ci_cd in 3 repos, mvc in 2, monorepo in 1.
    repo_counts = [p["repo_count"] for p in patterns]
    assert repo_counts == sorted(repo_counts, reverse=True)
    assert patterns[0]["pattern"] == "ci_cd"
    assert patterns[0]["repo_count"] == 3

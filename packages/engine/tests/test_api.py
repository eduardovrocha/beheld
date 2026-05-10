from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import api
from api import VERSION, app
from storage.sqlite import DevProfileDB


@pytest.fixture
def test_db(db_path: Path) -> DevProfileDB:
    db = DevProfileDB(db_path)
    db.init_schema()
    yield db
    db.close()


@pytest.fixture
def client(test_db: DevProfileDB):
    """TestClient with a fresh isolated DB; patch applied before lifespan runs."""
    with patch("api.db", test_db):
        with TestClient(app) as c:
            yield c


# ── health ────────────────────────────────────────────────────────────────────


def test_health_ok(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_health_version(client: TestClient) -> None:
    assert client.get("/health").json()["version"] == VERSION


# ── scores/current ────────────────────────────────────────────────────────────


def test_scores_current_empty_db(client: TestClient) -> None:
    data = client.get("/scores/current").json()
    for key in ("prompt_quality", "test_maturity", "tech_breadth", "growth_rate", "overall"):
        assert key in data


def test_scores_current_returns_zeros_when_no_data(client: TestClient) -> None:
    data = client.get("/scores/current").json()
    assert data["overall"] == 0


# ── scores/history ────────────────────────────────────────────────────────────


def test_scores_history_empty(client: TestClient) -> None:
    resp = client.get("/scores/history")
    assert resp.status_code == 200
    assert resp.json() == []


def test_scores_history_returns_data(client: TestClient, test_db: DevProfileDB) -> None:
    test_db.save_scores("2026-05-10", 70, 60, 80, 55, 66, 5)
    resp = client.get("/scores/history?days=10")
    data = resp.json()
    assert len(data) == 1
    assert data[0]["prompt_quality"] == 70


# ── profile/summary ───────────────────────────────────────────────────────────


def test_profile_summary_empty(client: TestClient) -> None:
    data = client.get("/profile/summary").json()
    assert "total_sessions" in data
    assert data["total_sessions"] == 0


def test_profile_summary_with_data(client: TestClient, test_db: DevProfileDB) -> None:
    from datetime import datetime, timezone
    now = datetime(2026, 5, 10, tzinfo=timezone.utc)
    test_db.save_session("s1", "claude-code", now, None, 15.0, 3, "abc", "api_backend", 0.8, "tdd")
    test_db.save_signals("s1", [("platform", "docker", 2), ("ecosystem", "python", 5)])

    data = client.get("/profile/summary").json()
    assert data["total_sessions"] == 1
    assert "docker" in data["platforms"]


# ── insights ──────────────────────────────────────────────────────────────────


def test_insights_requires_sessions(client: TestClient) -> None:
    data = client.get("/insights").json()
    assert "requires_sessions" in data


def test_insights_returns_cache_after_enough_sessions(
    client: TestClient, test_db: DevProfileDB
) -> None:
    test_db.save_scores("2026-05-10", 75, 60, 80, 55, 67, 10)
    data = client.get("/insights").json()
    assert "insights" in data
    assert isinstance(data["insights"], list)
    assert len(data["insights"]) > 0


# ── export ────────────────────────────────────────────────────────────────────


def test_export_structure(client: TestClient) -> None:
    data = client.get("/export").json()
    for key in ("version", "exported_at", "scores", "profile", "history"):
        assert key in data


# ── process ───────────────────────────────────────────────────────────────────


def test_process_no_events(client: TestClient) -> None:
    with patch("api.read_all_events", return_value=[]):
        resp = client.post("/process")
    assert resp.status_code == 200
    assert resp.json()["processed"] == 0


def test_process_two_sessions(client: TestClient, sessions_dir: Path) -> None:
    from reader.jsonl_reader import read_all_events
    events = read_all_events(sessions_dir)

    with patch("api.read_all_events", return_value=events):
        resp = client.post("/process")
    assert resp.status_code == 200
    assert resp.json()["processed"] == 2


def test_process_idempotent(client: TestClient, sessions_dir: Path) -> None:
    from reader.jsonl_reader import read_all_events
    events = read_all_events(sessions_dir)

    with patch("api.read_all_events", return_value=events):
        r1 = client.post("/process")
        r2 = client.post("/process")
    assert r1.json()["processed"] == 2
    assert r2.json()["processed"] == 0


def test_process_writes_scores(client: TestClient, test_db: DevProfileDB, sessions_dir: Path) -> None:
    from reader.jsonl_reader import read_all_events
    events = read_all_events(sessions_dir)

    with patch("api.read_all_events", return_value=events):
        client.post("/process")

    scores = test_db.get_current_scores()
    assert scores is not None
    assert scores["sessions_analyzed"] == 2

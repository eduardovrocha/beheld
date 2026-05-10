from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from api import VERSION, app
from models import Scores, Signal
from processor import ProcessResult
from storage.sqlite import DevProfileDB


@pytest.fixture
def test_db(db_path: Path) -> DevProfileDB:
    db = DevProfileDB(db_path)
    db.init_schema()
    yield db
    db.close()


@pytest.fixture
def client(test_db: DevProfileDB):
    """TestClient with isolated DB and no-op APScheduler; patch applied before lifespan."""
    with patch("api.db", test_db), \
         patch("api.insights_gen") as mock_ig, \
         patch("apscheduler.schedulers.asyncio.AsyncIOScheduler.start"), \
         patch("apscheduler.schedulers.asyncio.AsyncIOScheduler.shutdown"):
        mock_ig.generate.return_value = {"insights": [], "generated_at": None, "requires_sessions": 5}
        with TestClient(app) as c:
            yield c


# ── health ────────────────────────────────────────────────────────────────────


def test_health_ok(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_health_version(client: TestClient) -> None:
    assert client.get("/health").json()["version"] == VERSION


# ── scores/current ────────────────────────────────────────────────────────────


def test_scores_current_empty_db(client: TestClient) -> None:
    data = client.get("/scores/current").json()
    for key in ("prompt_quality", "test_maturity", "tech_breadth", "growth_rate", "overall"):
        assert key in data


def test_scores_current_returns_zeros_when_no_data(client: TestClient) -> None:
    assert client.get("/scores/current").json()["overall"] == 0


def test_scores_current_with_data(client: TestClient, test_db: DevProfileDB) -> None:
    test_db.save_scores(Scores("2026-05-10", 75, 60, 80, 55, 67, 10))
    data = client.get("/scores/current").json()
    assert data["overall"] == 67
    assert data["prompt_quality"] == 75


# ── scores/history ────────────────────────────────────────────────────────────


def test_scores_history_empty(client: TestClient) -> None:
    resp = client.get("/scores/history")
    assert resp.status_code == 200
    assert resp.json() == []


def test_scores_history_returns_data(client: TestClient, test_db: DevProfileDB) -> None:
    test_db.save_scores(Scores("2026-05-10", 70, 60, 80, 55, 66, 5))
    data = client.get("/scores/history?days=10").json()
    assert len(data) == 1
    assert data[0]["prompt_quality"] == 70


# ── profile/summary ───────────────────────────────────────────────────────────


def test_profile_summary_empty(client: TestClient) -> None:
    data = client.get("/profile/summary").json()
    assert "total_sessions" in data
    assert data["total_sessions"] == 0


def test_profile_summary_with_sessions(client: TestClient, test_db: DevProfileDB, sample_session_1) -> None:
    test_db.save_session(sample_session_1)
    test_db.save_signals(sample_session_1.session_id, [
        Signal("platform", "testing", 2),
        Signal("ecosystem", "rails", 5),
    ])
    data = client.get("/profile/summary").json()
    assert data["total_sessions"] == 1
    assert "testing" in data["platforms"]


# ── insights ──────────────────────────────────────────────────────────────────


def test_insights_requires_sessions(client: TestClient) -> None:
    data = client.get("/insights").json()
    assert "requires_sessions" in data


# ── export ────────────────────────────────────────────────────────────────────


def test_export_structure(client: TestClient) -> None:
    data = client.get("/export").json()
    for key in ("version", "exported_at", "scores", "profile", "history"):
        assert key in data


def test_export_version(client: TestClient) -> None:
    assert client.get("/export").json()["version"] == VERSION


# ── process ───────────────────────────────────────────────────────────────────


def test_process_no_new_events(client: TestClient) -> None:
    with patch("api.processor") as mock_proc:
        mock_proc.process_new.return_value = ProcessResult(new_sessions=0)
        resp = client.post("/process")
    assert resp.status_code == 200
    assert resp.json()["processed"] == 0


def test_process_two_sessions(client: TestClient, test_db: DevProfileDB, sessions_dir: Path, tmp_path: Path) -> None:
    from reader.jsonl_reader import JsonlReader
    from processor import Processor

    cursor = tmp_path / ".test_cursor"
    reader = JsonlReader(sessions_dir, cursor)
    new_processor = Processor(test_db, reader)
    with patch("api.processor", new_processor):
        resp = client.post("/process")
    assert resp.status_code == 200
    assert resp.json()["processed"] == 2


def test_process_idempotent(client: TestClient, test_db: DevProfileDB, sessions_dir: Path, tmp_path: Path) -> None:
    from reader.jsonl_reader import JsonlReader
    from processor import Processor

    cursor = tmp_path / ".test_cursor2"
    reader = JsonlReader(sessions_dir, cursor)
    new_processor = Processor(test_db, reader)
    with patch("api.processor", new_processor):
        r1 = client.post("/process")
        r2 = client.post("/process")
    assert r1.json()["processed"] == 2
    assert r2.json()["processed"] == 0


def test_process_writes_scores(client: TestClient, test_db: DevProfileDB, sessions_dir: Path, tmp_path: Path) -> None:
    from reader.jsonl_reader import JsonlReader
    from processor import Processor

    cursor = tmp_path / ".test_cursor3"
    reader = JsonlReader(sessions_dir, cursor)
    new_processor = Processor(test_db, reader)
    with patch("api.processor", new_processor):
        client.post("/process")

    scores = test_db.get_current_scores()
    assert scores is not None
    assert scores.sessions_analyzed == 2

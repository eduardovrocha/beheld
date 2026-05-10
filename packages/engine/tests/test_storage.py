from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from storage.sqlite import DevProfileDB


@pytest.fixture
def db(db_path: Path) -> DevProfileDB:
    instance = DevProfileDB(db_path)
    instance.init_schema()
    yield instance
    instance.close()


def test_init_schema_creates_tables(db: DevProfileDB) -> None:
    conn = db.connect()
    tables = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert {"sessions", "technical_signals", "scores", "profile"} <= tables


def test_save_and_get_session(db: DevProfileDB) -> None:
    now = datetime(2026, 5, 10, 10, 0, 0, tzinfo=timezone.utc)
    db.save_session(
        session_id="s1",
        source="claude-code",
        started_at=now,
        ended_at=None,
        duration_minutes=15.0,
        total_turns=3,
        cwd_hash="abc",
        project_category="api_backend",
        project_confidence=0.8,
        workflow_pattern="tdd",
    )
    sessions = db.get_all_sessions()
    assert len(sessions) == 1
    assert sessions[0]["id"] == "s1"
    assert sessions[0]["project_category"] == "api_backend"


def test_get_existing_session_ids(db: DevProfileDB) -> None:
    now = datetime(2026, 5, 10, tzinfo=timezone.utc)
    db.save_session("s1", "claude-code", now, None, 0, 0, "", "unknown", 0.0, "unknown")
    db.save_session("s2", "claude-code", now, None, 0, 0, "", "unknown", 0.0, "unknown")
    ids = db.get_existing_session_ids()
    assert ids == {"s1", "s2"}


def test_save_signals(db: DevProfileDB) -> None:
    now = datetime(2026, 5, 10, tzinfo=timezone.utc)
    db.save_session("s1", "claude-code", now, None, 0, 0, "", "unknown", 0.0, "unknown")
    db.save_signals("s1", [("platform", "docker", 3), ("ecosystem", "python", 5)])
    signals = db.get_all_signals()
    assert len(signals) == 2
    types = {s["signal_type"] for s in signals}
    assert types == {"platform", "ecosystem"}


def test_save_signals_replaces_existing(db: DevProfileDB) -> None:
    now = datetime(2026, 5, 10, tzinfo=timezone.utc)
    db.save_session("s1", "claude-code", now, None, 0, 0, "", "unknown", 0.0, "unknown")
    db.save_signals("s1", [("platform", "docker", 1)])
    db.save_signals("s1", [("platform", "github", 2)])
    signals = db.get_all_signals()
    assert len(signals) == 1
    assert signals[0]["signal_value"] == "github"


def test_save_and_get_scores(db: DevProfileDB) -> None:
    db.save_scores("2026-05-10", 75, 60, 80, 55, 67, 10)
    row = db.get_current_scores()
    assert row is not None
    assert row["prompt_quality"] == 75
    assert row["overall"] == 67


def test_get_scores_history(db: DevProfileDB) -> None:
    db.save_scores("2026-05-08", 70, 55, 75, 50, 62, 8)
    db.save_scores("2026-05-09", 72, 58, 77, 52, 64, 9)
    db.save_scores("2026-05-10", 74, 60, 79, 54, 66, 10)
    history = db.get_scores_history(30)
    assert len(history) == 3
    assert history[0]["date"] == "2026-05-10"  # most recent first


def test_count_sessions(db: DevProfileDB) -> None:
    now = datetime(2026, 5, 10, tzinfo=timezone.utc)
    db.save_session("s1", "claude-code", now, None, 0, 0, "", "unknown", 0.0, "unknown")
    db.save_session("s2", "claude-code", now, None, 0, 0, "", "unknown", 0.0, "unknown")
    assert db.count_sessions() == 2


def test_count_sessions_on_date(db: DevProfileDB) -> None:
    today = datetime(2026, 5, 10, tzinfo=timezone.utc)
    yesterday = datetime(2026, 5, 9, tzinfo=timezone.utc)
    db.save_session("s1", "claude-code", today, None, 0, 0, "", "unknown", 0.0, "unknown")
    db.save_session("s2", "claude-code", today, None, 0, 0, "", "unknown", 0.0, "unknown")
    db.save_session("s3", "claude-code", yesterday, None, 0, 0, "", "unknown", 0.0, "unknown")
    assert db.count_sessions_on_date("2026-05-10") == 2
    assert db.count_sessions_on_date("2026-05-09") == 1


def test_profile_key_value(db: DevProfileDB) -> None:
    db.update_profile("test_key", "test_value")
    assert db.get_profile_value("test_key") == "test_value"


def test_profile_update_replaces(db: DevProfileDB) -> None:
    db.update_profile("key", "v1")
    db.update_profile("key", "v2")
    assert db.get_profile_value("key") == "v2"


def test_get_profile_missing_key(db: DevProfileDB) -> None:
    assert db.get_profile_value("missing") is None


def test_get_current_scores_empty(db: DevProfileDB) -> None:
    assert db.get_current_scores() is None

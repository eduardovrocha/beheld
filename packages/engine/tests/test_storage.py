from __future__ import annotations

from pathlib import Path

import pytest

from models import Scores, Signal
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


def test_save_and_get_session(db: DevProfileDB, sample_session_1) -> None:
    db.save_session(sample_session_1)
    assert db.count_sessions() == 1
    ids = db.get_existing_session_ids()
    assert "sess-1" in ids


def test_save_session_idempotent(db: DevProfileDB, sample_session_1) -> None:
    db.save_session(sample_session_1)
    db.save_session(sample_session_1)  # second save accumulates, does not duplicate row
    assert db.count_sessions() == 1


def test_get_existing_session_ids(db: DevProfileDB, sample_session_1, sample_session_2) -> None:
    db.save_session(sample_session_1)
    db.save_session(sample_session_2)
    ids = db.get_existing_session_ids()
    assert ids == {"sess-1", "sess-2"}


def test_get_all_sessions_as_objects(db: DevProfileDB, sample_session_1, sample_session_2) -> None:
    db.save_session(sample_session_1)
    db.save_session(sample_session_2)
    sessions = db.get_all_sessions_as_objects()
    assert len(sessions) == 2
    assert {s.session_id for s in sessions} == {"sess-1", "sess-2"}


def test_reconstructed_session_has_no_events(db: DevProfileDB, sample_session_1) -> None:
    db.save_session(sample_session_1)
    sessions = db.get_all_sessions_as_objects()
    assert sessions[0].events == []


def test_reconstructed_session_tools(db: DevProfileDB, sample_session_1) -> None:
    db.save_session(sample_session_1)
    sessions = db.get_all_sessions_as_objects()
    assert "Bash" in sessions[0].tools_used


def test_save_signals(db: DevProfileDB, sample_session_1) -> None:
    db.save_session(sample_session_1)
    db.save_signals(sample_session_1.session_id, [
        Signal("platform", "docker", 3),
        Signal("ecosystem", "python", 5),
    ])
    signals = db.get_all_signals()
    assert len(signals) == 2
    types = {s["signal_type"] for s in signals}
    assert types == {"platform", "ecosystem"}


def test_save_signals_replaces_existing(db: DevProfileDB, sample_session_1) -> None:
    db.save_session(sample_session_1)
    db.save_signals(sample_session_1.session_id, [Signal("platform", "docker", 1)])
    db.save_signals(sample_session_1.session_id, [Signal("platform", "github", 2)])
    signals = db.get_all_signals()
    assert len(signals) == 1
    assert signals[0]["signal_value"] == "github"


def test_save_and_get_scores(db: DevProfileDB) -> None:
    scores = Scores(
        date="2026-05-10",
        prompt_quality=75,
        test_maturity=60,
        tech_breadth=80,
        growth_rate=55,
        overall=67,
        sessions_analyzed=10,
    )
    db.save_scores(scores)
    result = db.get_current_scores()
    assert result is not None
    assert result.prompt_quality == 75
    assert result.overall == 67


def test_get_scores_history(db: DevProfileDB) -> None:
    for date, pq in [("2026-05-08", 70), ("2026-05-09", 72), ("2026-05-10", 74)]:
        db.save_scores(Scores(date=date, prompt_quality=pq, test_maturity=55,
                              tech_breadth=75, growth_rate=50, overall=62, sessions_analyzed=8))
    history = db.get_scores_history(30)
    assert len(history) == 3
    assert history[0].date == "2026-05-10"  # most recent first


def test_get_scores_returns_scores_object(db: DevProfileDB) -> None:
    db.save_scores(Scores("2026-05-10", 70, 60, 80, 55, 66, 5))
    result = db.get_scores("2026-05-10")
    assert isinstance(result, Scores)
    assert result.date == "2026-05-10"


def test_count_sessions(db: DevProfileDB, sample_session_1, sample_session_2) -> None:
    db.save_session(sample_session_1)
    db.save_session(sample_session_2)
    assert db.count_sessions() == 2


def test_count_sessions_on_date(db: DevProfileDB, sample_session_1, sample_session_2) -> None:
    db.save_session(sample_session_1)
    db.save_session(sample_session_2)
    # Both sessions are on 2026-05-10
    assert db.count_sessions_on_date("2026-05-10") == 2
    assert db.count_sessions_on_date("2026-05-09") == 0


def test_profile_key_value(db: DevProfileDB) -> None:
    db.set_profile("test_key", "test_value")
    assert db.get_profile("test_key") == "test_value"


def test_profile_update_replaces(db: DevProfileDB) -> None:
    db.set_profile("key", "v1")
    db.set_profile("key", "v2")
    assert db.get_profile("key") == "v2"


def test_get_profile_missing_key(db: DevProfileDB) -> None:
    assert db.get_profile("missing") is None


def test_save_session_accumulates_event_count(db: DevProfileDB, sample_session_1, sample_session_2) -> None:
    import copy
    first = copy.copy(sample_session_1)
    first.event_count = 10
    second = copy.copy(sample_session_1)
    second.event_count = 5
    db.save_session(first)
    db.save_session(second)
    sessions = db.get_all_sessions_as_objects()
    assert sessions[0].event_count == 15


def test_save_session_merges_tools(db: DevProfileDB, sample_session_1, sample_session_2) -> None:
    import copy
    first = copy.copy(sample_session_1)
    first.tools_used = ["Bash", "Read"]
    second = copy.copy(sample_session_1)
    second.tools_used = ["Edit", "Read"]
    db.save_session(first)
    db.save_session(second)
    sessions = db.get_all_sessions_as_objects()
    assert set(sessions[0].tools_used) == {"Bash", "Read", "Edit"}


def test_save_session_appends_tool_sequence(db: DevProfileDB, sample_session_1) -> None:
    import copy
    first = copy.copy(sample_session_1)
    first.tool_sequence = ["Bash", "Read"]
    second = copy.copy(sample_session_1)
    second.tool_sequence = ["Edit", "Bash"]
    db.save_session(first)
    db.save_session(second)
    seq = db.get_session_tool_sequence("sess-1")
    assert seq == ["Bash", "Read", "Edit", "Bash"]


def test_get_session_tool_sequence_missing(db: DevProfileDB) -> None:
    assert db.get_session_tool_sequence("nonexistent") == []


def test_get_all_profile(db: DevProfileDB) -> None:
    db.set_profile("k1", "v1")
    db.set_profile("k2", "v2")
    profile = db.get_all_profile()
    assert profile == {"k1": "v1", "k2": "v2"}


def test_get_current_scores_empty(db: DevProfileDB) -> None:
    assert db.get_current_scores() is None


def test_in_memory_db() -> None:
    mem_db = DevProfileDB(":memory:")
    mem_db.init_schema()
    mem_db.set_profile("x", "y")
    assert mem_db.get_profile("x") == "y"
    mem_db.close()

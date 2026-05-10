from __future__ import annotations

import json
from pathlib import Path

import pytest

from reader.jsonl_reader import JsonlReader
from tests.conftest import EVENTS_SESSION_1, EVENTS_SESSION_2


def test_read_new_sessions_returns_two(jsonl_reader: JsonlReader) -> None:
    sessions = jsonl_reader.read_new_sessions()
    ids = {s.session_id for s in sessions}
    assert ids == {"sess-1", "sess-2"}


def test_read_new_sessions_second_call_empty(jsonl_reader: JsonlReader) -> None:
    jsonl_reader.read_new_sessions()
    second = jsonl_reader.read_new_sessions()
    assert second == []


def test_read_new_sessions_empty_dir(tmp_path: Path) -> None:
    sd = tmp_path / "empty_sessions"
    sd.mkdir()
    cursor = tmp_path / ".cursor"
    reader = JsonlReader(sd, cursor)
    assert reader.read_new_sessions() == []


def test_read_new_sessions_nonexistent_dir(tmp_path: Path) -> None:
    reader = JsonlReader(tmp_path / "missing", tmp_path / ".cursor")
    assert reader.read_new_sessions() == []


def test_read_new_sessions_skips_corrupted_lines(tmp_path: Path) -> None:
    sd = tmp_path / "sessions"
    sd.mkdir()
    cursor = tmp_path / ".cursor"
    f = sd / "2026-05-10_test.jsonl"
    with open(f, "w") as fh:
        fh.write("not valid json\n")
        fh.write(json.dumps(EVENTS_SESSION_1[0]) + "\n")
        fh.write("{broken\n")
    reader = JsonlReader(sd, cursor)
    sessions = reader.read_new_sessions()
    # One valid event → one session
    assert len(sessions) == 1


def test_read_new_sessions_groups_by_session_id(jsonl_reader: JsonlReader) -> None:
    sessions = jsonl_reader.read_new_sessions()
    assert len(sessions) == 2


def test_read_new_sessions_session_1_duration(jsonl_reader: JsonlReader) -> None:
    sessions = jsonl_reader.read_new_sessions()
    s1 = next(s for s in sessions if s.session_id == "sess-1")
    assert abs(s1.duration_minutes - 30.0) < 0.1


def test_read_new_sessions_session_1_tools(jsonl_reader: JsonlReader) -> None:
    sessions = jsonl_reader.read_new_sessions()
    s1 = next(s for s in sessions if s.session_id == "sess-1")
    assert "Bash" in s1.tools_used
    assert "Edit" in s1.tools_used


def test_read_new_sessions_test_context(jsonl_reader: JsonlReader) -> None:
    sessions = jsonl_reader.read_new_sessions()
    s1 = next(s for s in sessions if s.session_id == "sess-1")
    s2 = next(s for s in sessions if s.session_id == "sess-2")
    assert s1.has_test_context is True
    assert s2.has_test_context is False


def test_read_new_sessions_total_turns(jsonl_reader: JsonlReader) -> None:
    sessions = jsonl_reader.read_new_sessions()
    s1 = next(s for s in sessions if s.session_id == "sess-1")
    assert s1.total_turns == 5


def test_read_new_sessions_commands(jsonl_reader: JsonlReader) -> None:
    sessions = jsonl_reader.read_new_sessions()
    s1 = next(s for s in sessions if s.session_id == "sess-1")
    assert "rspec spec/" in s1.commands


def test_read_new_sessions_file_extensions(jsonl_reader: JsonlReader) -> None:
    sessions = jsonl_reader.read_new_sessions()
    s1 = next(s for s in sessions if s.session_id == "sess-1")
    assert ".rb" in s1.file_extensions


def test_cursor_advances_on_new_content(sessions_dir: Path, tmp_path: Path) -> None:
    cursor = tmp_path / ".cursor"
    reader = JsonlReader(sessions_dir, cursor)
    reader.read_new_sessions()

    assert cursor.exists()
    import json as _json
    data = _json.loads(cursor.read_text())
    assert "offsets" in data
    for offset in data["offsets"].values():
        assert offset > 0


def test_new_file_picked_up_after_first_call(sessions_dir: Path, tmp_path: Path) -> None:
    cursor = tmp_path / ".cursor"
    reader = JsonlReader(sessions_dir, cursor)
    reader.read_new_sessions()

    # Add a new JSONL file
    new_file = sessions_dir / "2026-05-11_sess-3.jsonl"
    evt = {**EVENTS_SESSION_1[0], "session_id": "sess-3", "event_id": "evt-new"}
    with open(new_file, "w") as fh:
        fh.write(json.dumps(evt) + "\n")

    second = reader.read_new_sessions()
    assert len(second) == 1
    assert second[0].session_id == "sess-3"

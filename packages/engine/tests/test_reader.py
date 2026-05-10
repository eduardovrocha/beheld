from __future__ import annotations

import json
from pathlib import Path

import pytest

from models import DevProfileEvent
from reader.jsonl_reader import group_into_sessions, read_all_events
from tests.conftest import EVENTS_SESSION_1, EVENTS_SESSION_2


def test_read_all_events_returns_correct_count(sessions_dir: Path) -> None:
    events = read_all_events(sessions_dir)
    assert len(events) == len(EVENTS_SESSION_1) + len(EVENTS_SESSION_2)


def test_read_all_events_parses_fields(sessions_dir: Path) -> None:
    events = read_all_events(sessions_dir)
    e = next(ev for ev in events if ev.event_id == "evt-1")
    assert e.session_id == "sess-1"
    assert e.tool_name == "Bash"
    assert e.has_test_context is True
    assert e.command_sanitized == "rspec spec/"


def test_read_all_events_empty_dir(tmp_path: Path) -> None:
    sd = tmp_path / "sessions"
    sd.mkdir()
    assert read_all_events(sd) == []


def test_read_all_events_nonexistent_dir(tmp_path: Path) -> None:
    assert read_all_events(tmp_path / "missing") == []


def test_read_all_events_skips_corrupted_lines(tmp_path: Path) -> None:
    sd = tmp_path / "sessions"
    sd.mkdir()
    f = sd / "2026-05-10_test.jsonl"
    with open(f, "w") as fh:
        fh.write("not valid json\n")
        fh.write(json.dumps(EVENTS_SESSION_1[0]) + "\n")
        fh.write("{broken\n")
    events = read_all_events(sd)
    assert len(events) == 1


def test_group_into_sessions_groups_by_id(sessions_dir: Path) -> None:
    events = read_all_events(sessions_dir)
    sessions = group_into_sessions(events)
    ids = {s.session_id for s in sessions}
    assert ids == {"sess-1", "sess-2"}


def test_group_session_duration(sessions_dir: Path) -> None:
    events = read_all_events(sessions_dir)
    sessions = group_into_sessions(events)
    s1 = next(s for s in sessions if s.session_id == "sess-1")
    assert abs(s1.duration_minutes - 30.0) < 0.1


def test_group_session_tools(sessions_dir: Path) -> None:
    events = read_all_events(sessions_dir)
    sessions = group_into_sessions(events)
    s1 = next(s for s in sessions if s.session_id == "sess-1")
    assert "Bash" in s1.tools_used
    assert "Edit" in s1.tools_used


def test_group_session_has_test_context(sessions_dir: Path) -> None:
    events = read_all_events(sessions_dir)
    sessions = group_into_sessions(events)
    s1 = next(s for s in sessions if s.session_id == "sess-1")
    s2 = next(s for s in sessions if s.session_id == "sess-2")
    assert s1.has_test_context is True
    assert s2.has_test_context is False


def test_group_session_total_turns(sessions_dir: Path) -> None:
    events = read_all_events(sessions_dir)
    sessions = group_into_sessions(events)
    s1 = next(s for s in sessions if s.session_id == "sess-1")
    assert s1.total_turns == 5


def test_group_session_commands(sessions_dir: Path) -> None:
    events = read_all_events(sessions_dir)
    sessions = group_into_sessions(events)
    s1 = next(s for s in sessions if s.session_id == "sess-1")
    assert "rspec spec/" in s1.commands


def test_group_session_file_extensions(sessions_dir: Path) -> None:
    events = read_all_events(sessions_dir)
    sessions = group_into_sessions(events)
    s1 = next(s for s in sessions if s.session_id == "sess-1")
    assert ".rb" in s1.file_extensions


def test_group_empty_events() -> None:
    assert group_into_sessions([]) == []

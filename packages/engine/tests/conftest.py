from __future__ import annotations

import json
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import pytest

from models import DevProfileEvent, Session

# ── raw event dicts ───────────────────────────────────────────────────────────

EVENTS_SESSION_1 = [
    {
        "event_id": "evt-1",
        "session_id": "sess-1",
        "source": "claude-code",
        "event_type": "pre_tool_use",
        "timestamp": "2026-05-10T10:00:00Z",
        "tool_name": "Bash",
        "command_sanitized": "rspec spec/",
        "has_test_context": True,
        "cwd_hash": "abc123",
        "metadata": {},
    },
    {
        "event_id": "evt-2",
        "session_id": "sess-1",
        "source": "claude-code",
        "event_type": "post_tool_use",
        "timestamp": "2026-05-10T10:00:05Z",
        "tool_name": "Bash",
        "duration_ms": 5000,
        "cwd_hash": "abc123",
        "metadata": {},
    },
    {
        "event_id": "evt-3",
        "session_id": "sess-1",
        "source": "claude-code",
        "event_type": "pre_tool_use",
        "timestamp": "2026-05-10T10:01:00Z",
        "tool_name": "Edit",
        "file_extension": ".rb",
        "cwd_hash": "abc123",
        "metadata": {},
    },
    {
        "event_id": "evt-4",
        "session_id": "sess-1",
        "source": "claude-code",
        "event_type": "pre_tool_use",
        "timestamp": "2026-05-10T10:15:00Z",
        "tool_name": "Write",
        "file_extension": ".spec.rb",
        "cwd_hash": "abc123",
        "metadata": {},
    },
    {
        "event_id": "evt-5",
        "session_id": "sess-1",
        "source": "claude-code",
        "event_type": "pre_tool_use",
        "timestamp": "2026-05-10T10:20:00Z",
        "tool_name": "Bash",
        "command_sanitized": "rspec spec/user_spec.rb",
        "has_test_context": True,
        "cwd_hash": "abc123",
        "metadata": {},
    },
    {
        "event_id": "evt-6",
        "session_id": "sess-1",
        "source": "claude-code",
        "event_type": "stop",
        "timestamp": "2026-05-10T10:30:00Z",
        "cwd_hash": "abc123",
        "metadata": {"total_turns": 5},
    },
]

EVENTS_SESSION_2 = [
    {
        "event_id": "evt-7",
        "session_id": "sess-2",
        "source": "claude-code",
        "event_type": "pre_tool_use",
        "timestamp": "2026-05-10T14:00:00Z",
        "tool_name": "Write",
        "file_extension": ".ts",
        "cwd_hash": "def456",
        "metadata": {},
    },
    {
        "event_id": "evt-8",
        "session_id": "sess-2",
        "source": "claude-code",
        "event_type": "pre_tool_use",
        "timestamp": "2026-05-10T14:05:00Z",
        "tool_name": "Bash",
        "command_sanitized": "docker build .",
        "has_test_context": False,
        "cwd_hash": "def456",
        "metadata": {},
    },
    {
        "event_id": "evt-9",
        "session_id": "sess-2",
        "source": "continue-vscode",
        "event_type": "chat_request",
        "timestamp": "2026-05-10T14:10:00Z",
        "prompt_length": 350,
        "file_extension": ".ts",
        "cwd_hash": "def456",
        "metadata": {"has_code_context": True},
    },
    {
        "event_id": "evt-10",
        "session_id": "sess-2",
        "source": "claude-code",
        "event_type": "pre_tool_use",
        "timestamp": "2026-05-10T14:20:00Z",
        "tool_name": "Read",
        "file_extension": ".py",
        "cwd_hash": "def456",
        "metadata": {},
    },
]


@pytest.fixture
def sessions_dir(tmp_path: Path) -> Path:
    sd = tmp_path / "sessions"
    sd.mkdir()
    f1 = sd / "2026-05-10_sess-1.jsonl"
    f2 = sd / "2026-05-10_sess-2.jsonl"
    with open(f1, "w") as fh:
        for e in EVENTS_SESSION_1:
            fh.write(json.dumps(e) + "\n")
    with open(f2, "w") as fh:
        for e in EVENTS_SESSION_2:
            fh.write(json.dumps(e) + "\n")
    return sd


@pytest.fixture
def sample_session_1() -> Session:
    events = [DevProfileEvent.from_dict(e) for e in EVENTS_SESSION_1]
    return Session(
        session_id="sess-1",
        source="claude-code",
        started_at=datetime(2026, 5, 10, 10, 0, 0, tzinfo=timezone.utc),
        ended_at=datetime(2026, 5, 10, 10, 30, 0, tzinfo=timezone.utc),
        duration_minutes=30.0,
        events=events,
        tools_used=["Bash", "Edit", "Write"],
        file_extensions=Counter({".rb": 1, ".spec.rb": 1}),
        commands=["rspec spec/", "rspec spec/user_spec.rb"],
        cwd_hash="abc123",
        total_turns=5,
        has_test_context=True,
    )


@pytest.fixture
def sample_session_2() -> Session:
    events = [DevProfileEvent.from_dict(e) for e in EVENTS_SESSION_2]
    return Session(
        session_id="sess-2",
        source="continue-vscode",
        started_at=datetime(2026, 5, 10, 14, 0, 0, tzinfo=timezone.utc),
        ended_at=datetime(2026, 5, 10, 14, 20, 0, tzinfo=timezone.utc),
        duration_minutes=20.0,
        events=events,
        tools_used=["Write", "Bash", "Read"],
        file_extensions=Counter({".ts": 2, ".py": 1}),
        commands=["docker build ."],
        cwd_hash="def456",
        total_turns=0,
        has_test_context=False,
    )


@pytest.fixture
def two_sessions(sample_session_1: Session, sample_session_2: Session) -> list[Session]:
    return [sample_session_1, sample_session_2]


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "profile.db"

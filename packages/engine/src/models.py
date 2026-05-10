from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class DevProfileEvent:
    event_id: str
    session_id: str
    source: str
    event_type: str
    timestamp: str
    duration_ms: Optional[int] = None
    tool_name: Optional[str] = None
    file_extension: Optional[str] = None
    command_sanitized: Optional[str] = None
    prompt_length: Optional[int] = None
    has_test_context: Optional[bool] = None
    cwd_hash: Optional[str] = None
    metadata: dict = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict) -> DevProfileEvent:
        return cls(
            event_id=d["event_id"],
            session_id=d["session_id"],
            source=d.get("source", "claude-code"),
            event_type=d["event_type"],
            timestamp=d["timestamp"],
            duration_ms=d.get("duration_ms"),
            tool_name=d.get("tool_name"),
            file_extension=d.get("file_extension"),
            command_sanitized=d.get("command_sanitized"),
            prompt_length=d.get("prompt_length"),
            has_test_context=d.get("has_test_context"),
            cwd_hash=d.get("cwd_hash"),
            metadata=d.get("metadata", {}),
        )


@dataclass
class Session:
    session_id: str
    source: str
    started_at: datetime
    ended_at: Optional[datetime]
    duration_minutes: float
    events: list[DevProfileEvent]
    tools_used: list[str]
    file_extensions: Counter
    commands: list[str]
    cwd_hash: str
    total_turns: int
    has_test_context: bool


@dataclass
class DailyScores:
    date: str
    prompt_quality: int
    test_maturity: int
    tech_breadth: int
    growth_rate: int
    overall: int
    sessions_analyzed: int

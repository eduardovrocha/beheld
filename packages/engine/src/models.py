from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


# ── raw event from JSONL ──────────────────────────────────────────────────────

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


# ── aggregated session ────────────────────────────────────────────────────────

@dataclass
class Session:
    session_id: str
    source: str
    started_at: datetime
    ended_at: Optional[datetime]
    duration_minutes: float
    # Raw event list (populated from JSONL; empty for DB-reconstructed sessions)
    events: list[DevProfileEvent] = field(default_factory=list)
    tools_used: list[str] = field(default_factory=list)
    file_extensions: Counter = field(default_factory=Counter)
    commands: list[str] = field(default_factory=list)
    cwd_hash: str = ""
    total_turns: int = 0
    has_test_context: bool = False
    # Classifier output (set by Processor)
    project_category: str = "unknown"
    project_confidence: float = 0.0
    workflow_pattern: str = "unknown"
    # Pre-computed aggregates (set by Processor; used by scorers for DB sessions)
    avg_prompt_length: float = 0.0
    has_code_context_ratio: float = 0.0
    event_count: int = 0


# ── storage types ─────────────────────────────────────────────────────────────

@dataclass
class Signal:
    signal_type: str   # "platform" | "ecosystem" | "language" | "tool" | "workflow"
    signal_value: str
    occurrences: int = 1


@dataclass
class Scores:
    date: str
    prompt_quality: int
    test_maturity: int
    tech_breadth: int
    growth_rate: int
    overall: int
    sessions_analyzed: int


# ── classification / extraction ───────────────────────────────────────────────

@dataclass
class TechnicalSignals:
    platforms: dict[str, int] = field(default_factory=dict)
    ecosystems: dict[str, int] = field(default_factory=dict)
    languages: dict[str, int] = field(default_factory=dict)
    tools: dict[str, int] = field(default_factory=dict)
    workflow_pattern: str = "unknown"
    tool_sequence: list[str] = field(default_factory=list)


@dataclass
class ProjectClassification:
    category: str
    confidence: float
    signals_used: list[str] = field(default_factory=list)

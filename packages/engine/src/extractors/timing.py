from __future__ import annotations

from datetime import datetime


def compute_session_duration(started_at: datetime, ended_at: datetime | None) -> float:
    if ended_at is None or ended_at == started_at:
        return 0.0
    delta = ended_at - started_at
    return delta.total_seconds() / 60.0


def classify_session_length(duration_minutes: float) -> str:
    if duration_minutes < 5:
        return "brief"
    elif duration_minutes < 30:
        return "medium"
    elif duration_minutes < 90:
        return "long"
    else:
        return "extended"

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Optional


def _parse(ts: str) -> Optional[datetime]:
    ts = ts.rstrip("Z")
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(ts, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    try:
        dt = datetime.fromisoformat(ts)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def analyze_timing(timestamps: list[str]) -> dict:
    """
    Analyse a list of ISO 8601 timestamps (one per session or event).

    Returns:
      peak_hours         list[int]   top 3 hours of activity (0-23)
      avg_duration_minutes float     mean gap between consecutive timestamps (minutes)
      work_mode          str         "solo" | "collaborative"  (placeholder, always "solo")
      rhythm             str         "continuous" | "project-by-project"
    """
    if not timestamps:
        return {
            "peak_hours": [],
            "avg_duration_minutes": 0.0,
            "work_mode": "solo",
            "rhythm": "continuous",
        }

    parsed = [dt for ts in timestamps if (dt := _parse(ts)) is not None]
    parsed.sort()

    # Peak hours
    hour_counts: Counter = Counter(dt.hour for dt in parsed)
    peak_hours = [h for h, _ in hour_counts.most_common(3)]

    # Average gap between consecutive sessions (in minutes)
    gaps: list[float] = []
    for i in range(1, len(parsed)):
        gap = (parsed[i] - parsed[i - 1]).total_seconds() / 60.0
        if gap > 0:
            gaps.append(gap)
    avg_duration = sum(gaps) / len(gaps) if gaps else 0.0

    # Rhythm: if avg gap > 1440 min (1 day) → project-by-project, else continuous
    rhythm = "project-by-project" if avg_duration > 1440 else "continuous"

    return {
        "peak_hours": peak_hours,
        "avg_duration_minutes": round(avg_duration, 1),
        "work_mode": "solo",
        "rhythm": rhythm,
    }

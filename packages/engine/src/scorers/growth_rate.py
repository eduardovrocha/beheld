from __future__ import annotations

from collections import Counter

from extractors.commands import extract_platforms
from extractors.files import extract_ecosystems
from models import Session


def _metrics(sessions: list[Session]) -> dict:
    if not sessions:
        return {
            "avg_prompt": 0.0,
            "test_ratio": 0.0,
            "avg_tools": 0.0,
            "avg_duration": 0.0,
            "ecosystems": set(),
            "platforms": set(),
        }

    all_events = [e for s in sessions for e in s.events]

    prompt_events = [e for e in all_events if e.prompt_length is not None]
    avg_prompt = (
        sum(e.prompt_length for e in prompt_events) / len(prompt_events) if prompt_events else 0.0
    )

    test_sessions = sum(1 for s in sessions if s.has_test_context)
    test_ratio = test_sessions / len(sessions)

    avg_tools = sum(len(set(s.tools_used)) for s in sessions) / len(sessions)
    avg_duration = sum(s.duration_minutes for s in sessions) / len(sessions)

    all_exts: Counter = Counter()
    all_cmds: list[str] = []
    for s in sessions:
        all_exts.update(s.file_extensions)
        all_cmds.extend(s.commands)

    return {
        "avg_prompt": avg_prompt,
        "test_ratio": test_ratio,
        "avg_tools": avg_tools,
        "avg_duration": avg_duration,
        "ecosystems": set(extract_ecosystems(all_exts)),
        "platforms": set(extract_platforms(all_cmds)),
    }


def _delta_score(recent: float, previous: float, max_weight: int) -> int:
    """Map delta to [0, max_weight]. No change → max_weight/2."""
    if previous == 0 and recent == 0:
        return max_weight // 2
    if previous == 0:
        return max_weight
    # A ±50% change covers the full range
    ratio = (recent - previous) / previous
    normalized = max(0.0, min(1.0, ratio + 0.5))
    return int(normalized * max_weight)


def compute_growth_rate(
    recent_sessions: list[Session],
    previous_sessions: list[Session],
) -> int:
    """
    Compare last 30 days vs previous 30 days.
    Returns 50 when no previous data (neutral baseline).

    Dimensions (max sums to 100):
      +30  Δ avg prompt length
      +30  Δ % sessions with tests
      +20  Δ avg distinct tools/session
      +10  Δ avg session duration
      +10  new ecosystems or platforms
    """
    if not recent_sessions:
        return 0
    if not previous_sessions:
        return 50

    r = _metrics(recent_sessions)
    p = _metrics(previous_sessions)

    score = 0
    score += _delta_score(r["avg_prompt"], p["avg_prompt"], 30)
    score += _delta_score(r["test_ratio"], p["test_ratio"], 30)
    score += _delta_score(r["avg_tools"], p["avg_tools"], 20)
    score += _delta_score(r["avg_duration"], p["avg_duration"], 10)

    new_eco = r["ecosystems"] - p["ecosystems"]
    new_plat = r["platforms"] - p["platforms"]
    score += 10 if (new_eco or new_plat) else 5

    return max(0, min(100, score))

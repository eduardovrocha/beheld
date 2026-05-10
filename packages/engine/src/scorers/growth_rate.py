from __future__ import annotations

from extractors.commands import detect_platforms
from extractors.files import detect_ecosystems
from models import Session


def _delta_score(recent: float, previous: float, max_weight: int) -> int:
    """Map delta to [0, max_weight]. No change → max_weight/2."""
    if previous == 0 and recent == 0:
        return max_weight // 2
    if previous == 0:
        return max_weight
    ratio = (recent - previous) / previous
    normalized = max(0.0, min(1.0, ratio + 0.5))
    return int(normalized * max_weight)


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

    # Avg prompt — use pre-computed aggregate when events are absent
    avgs: list[float] = []
    for s in sessions:
        if s.events:
            prompt_events = [e for e in s.events if e.prompt_length is not None]
            if prompt_events:
                avgs.append(sum(e.prompt_length for e in prompt_events) / len(prompt_events))
        elif s.avg_prompt_length > 0:
            avgs.append(s.avg_prompt_length)

    test_ratio = sum(1 for s in sessions if s.has_test_context) / len(sessions)
    avg_tools = sum(len(s.tools_used) for s in sessions) / len(sessions)
    avg_duration = sum(s.duration_minutes for s in sessions) / len(sessions)

    all_ext_keys: set[str] = set()
    all_commands: list[str] = []
    for s in sessions:
        all_ext_keys.update(s.file_extensions.keys())
        all_commands.extend(s.commands)

    fake_paths = [f"f{ext}" for ext in all_ext_keys]
    ecosystems = set(detect_ecosystems(fake_paths).keys())
    platforms = set(detect_platforms(all_commands).keys())

    return {
        "avg_prompt": sum(avgs) / len(avgs) if avgs else 0.0,
        "test_ratio": test_ratio,
        "avg_tools": avg_tools,
        "avg_duration": avg_duration,
        "ecosystems": ecosystems,
        "platforms": platforms,
    }


class GrowthRateScorer:
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

    def score(self, recent: list[Session], previous: list[Session]) -> int:
        if not recent:
            return 0
        if not previous:
            return 50

        r = _metrics(recent)
        p = _metrics(previous)

        result = 0
        result += _delta_score(r["avg_prompt"], p["avg_prompt"], 30)
        result += _delta_score(r["test_ratio"], p["test_ratio"], 30)
        result += _delta_score(r["avg_tools"], p["avg_tools"], 20)
        result += _delta_score(r["avg_duration"], p["avg_duration"], 10)

        new_eco = r["ecosystems"] - p["ecosystems"]
        new_plat = r["platforms"] - p["platforms"]
        result += 10 if (new_eco or new_plat) else 5

        return max(0, min(100, result))

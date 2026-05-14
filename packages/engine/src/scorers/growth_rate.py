from __future__ import annotations

from typing import ClassVar, Optional

from extractors.commands import detect_platforms
from extractors.files import detect_ecosystems
from models import Session
from scorers.base import DataSource, L1Snapshot


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
    Two comparison modes:

      L1 absent → recent L2 vs previous L2 (existing behavior):
        +30 Δ avg prompt length
        +30 Δ % sessions with tests
        +20 Δ avg distinct tools/session
        +10 Δ avg session duration
        +10 new ecosystems or platforms

      L1 present → recent L2 vs L1 baseline (trajectory vs lifetime):
        starting at 50 (neutral), adjust based on:
          +25 new ecosystems in L2 vs L1
          +15 new platforms in L2 vs L1
          +10 test_ratio improvement vs L1.avg_test_ratio
          −10 test_ratio regression vs L1.avg_test_ratio

    L2 empty → 50 (cannot judge trajectory with no recent activity).
    """

    data_sources: ClassVar[list[DataSource]] = ["l1", "l2"]

    def score(
        self,
        recent: list[Session],
        previous: list[Session],
        l1: Optional[L1Snapshot] = None,
    ) -> int:
        l1 = l1 or L1Snapshot()

        if not recent:
            # No L2 activity in window: neutral if we have any baseline at all,
            # zero otherwise. Mirrors original behavior when L1 is empty.
            return 50 if not l1.is_empty else 0

        if l1.is_empty:
            return self._compare_l2_periods(recent, previous)

        return self._compare_l2_vs_l1(recent, l1)

    def _compare_l2_periods(self, recent: list[Session], previous: list[Session]) -> int:
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

    def _compare_l2_vs_l1(self, recent: list[Session], l1: L1Snapshot) -> int:
        r = _metrics(recent)
        result = 50  # neutral starting point

        new_eco = r["ecosystems"] - l1.ecosystem_keys
        result += min(25, 5 * len(new_eco))

        new_plat = r["platforms"] - l1.platform_keys
        result += min(15, 5 * len(new_plat))

        if r["test_ratio"] > l1.avg_test_ratio:
            bump = (r["test_ratio"] - l1.avg_test_ratio) * 50
            result += int(min(10, bump))
        elif r["test_ratio"] < l1.avg_test_ratio - 0.1:
            result -= 10

        return max(0, min(100, result))

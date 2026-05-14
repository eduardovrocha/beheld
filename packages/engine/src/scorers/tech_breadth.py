from __future__ import annotations

from typing import ClassVar, Optional

from extractors.commands import detect_platforms
from extractors.files import detect_ecosystems, detect_languages
from models import Session
from scorers.base import DataSource, L1Snapshot

_INFRA_PLATFORMS = frozenset({"docker", "cloud_infra", "ci_cd"})

# Weight of L1 in the combined score when both layers are present.
_L1_WEIGHT = 0.60
_L2_WEIGHT = 0.40


class TechBreadthScorer:
    """
    L2 dimensions (sums to 100):
      +40  distinct ecosystems (max 6)
      +30  distinct platforms (max 5)
      +20  distinct languages (max 4)
      +10  infra tools present (docker / cloud / CI)

    Combined with L1 (when present) using a 60/40 weight so the git history
    dominates — it represents what the dev has actually built.
    """

    data_sources: ClassVar[list[DataSource]] = ["l1", "l2"]

    def score(self, sessions: list[Session], l1: Optional[L1Snapshot] = None) -> int:
        l1 = l1 or L1Snapshot()
        l2_score = self._score_l2(sessions)

        if l1.is_empty:
            return l2_score

        l1_score = self._score_l1(l1)
        if not sessions:
            return l1_score

        return int(round(l1_score * _L1_WEIGHT + l2_score * _L2_WEIGHT))

    # ── L2 (sessions) — existing logic, unchanged ─────────────────────────

    def _score_l2(self, sessions: list[Session]) -> int:
        if not sessions:
            return 0

        all_ext_keys: set[str] = set()
        all_commands: list[str] = []
        for s in sessions:
            all_ext_keys.update(s.file_extensions.keys())
            all_commands.extend(s.commands)

        fake_paths = [f"f{ext}" for ext in all_ext_keys]
        ecosystems = detect_ecosystems(fake_paths)
        languages = detect_languages(fake_paths)
        platforms = detect_platforms(all_commands)

        result = 0
        result += int(40 * min(len(ecosystems), 6) / 6)
        result += int(30 * min(len(platforms), 5) / 5)
        result += int(20 * min(len(languages), 4) / 4)
        if any(p in _INFRA_PLATFORMS for p in platforms):
            result += 10

        return min(100, result)

    # ── L1 (git history) ──────────────────────────────────────────────────

    def _score_l1(self, l1: L1Snapshot) -> int:
        if l1.is_empty:
            return 0

        eco_count = len(l1.ecosystem_keys)
        plat_count = len(l1.platform_keys)
        # Map L1 extensions through the existing detector for parity with L2.
        fake_paths = [f"f.{ext}" for ext in l1.extensions.keys()]
        languages = detect_languages(fake_paths)

        result = 0
        result += int(40 * min(eco_count, 6) / 6)
        result += int(30 * min(plat_count, 5) / 5)
        result += int(20 * min(len(languages), 4) / 4)
        if l1.platform_keys & _INFRA_PLATFORMS:
            result += 10
        return min(100, result)

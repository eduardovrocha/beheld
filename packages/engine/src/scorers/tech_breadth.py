from __future__ import annotations

from typing import ClassVar, Optional

from extractors.commands import detect_platforms
from extractors.files import detect_ecosystems, detect_languages
from models import Session
from scorers.base import DataSource, L1Snapshot

_INFRA_PLATFORMS = frozenset({"docker", "cloud_infra", "ci_cd"})

# Weight of core (git history) in the combined score when both layers
# are present. Per spec §3.1: core dominates because it represents what
# the dev actually built, not just what they discussed with an AI.
_CORE_WEIGHT = 0.60
_ENRICHMENT_WEIGHT = 0.40


class TechBreadthScorer:
    """
    Enrichment dimensions (sums to 100):
      +40  distinct ecosystems (max 6)
      +30  distinct platforms (max 5)
      +20  distinct languages (max 4)
      +10  infra tools present (docker / cloud / CI)

    Combined with core (git history) using a 60/40 weight so the git
    history dominates — it represents what the dev has actually built.

    R1.2 — fallback_when_enrichment_missing = True. When enrichment is
    absent (no sessions captured), the scorer returns the core-only score
    derived from the user's imported repos. No neutral-50 fallback.
    """

    data_sources: ClassVar[list[DataSource]] = ["core", "enrichment"]
    fallback_when_enrichment_missing: ClassVar[bool] = True

    def score(self, sessions: list[Session], l1: Optional[L1Snapshot] = None) -> int:
        l1 = l1 or L1Snapshot()
        enrichment_score = self._score_enrichment(sessions)

        if l1.is_empty:
            # No imported repos. Score whatever enrichment we have (may be 0).
            return enrichment_score

        core_score = self._score_core(l1)
        if not sessions:
            # R1.2 — enrichment absent. Honor fallback_when_enrichment_missing
            # by returning core-only (no neutral 50).
            return core_score

        return int(round(core_score * _CORE_WEIGHT + enrichment_score * _ENRICHMENT_WEIGHT))

    # ── enrichment (sessions) — existing logic, unchanged ─────────────────

    def _score_enrichment(self, sessions: list[Session]) -> int:
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

    # ── core (git history) ────────────────────────────────────────────────

    def _score_core(self, l1: L1Snapshot) -> int:
        if l1.is_empty:
            return 0

        eco_count = len(l1.ecosystem_keys)
        plat_count = len(l1.platform_keys)
        # Map core extensions through the existing detector for parity
        # with the enrichment path.
        fake_paths = [f"f.{ext}" for ext in l1.extensions.keys()]
        languages = detect_languages(fake_paths)

        result = 0
        result += int(40 * min(eco_count, 6) / 6)
        result += int(30 * min(plat_count, 5) / 5)
        result += int(20 * min(len(languages), 4) / 4)
        if l1.platform_keys & _INFRA_PLATFORMS:
            result += 10
        return min(100, result)

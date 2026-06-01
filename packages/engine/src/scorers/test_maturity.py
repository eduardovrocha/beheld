from __future__ import annotations

from typing import ClassVar, Optional

from models import Session
from scorers.base import DataSource, L1Snapshot

_TEST_COMMANDS = frozenset(
    ("rspec", "jest", "pytest", "playwright", "vitest", "cypress", "mocha", "minitest")
)
_TEST_EXTENSIONS = (".spec.", ".test.", "_spec.", "_test.")

_CORE_WEIGHT = 0.50
_ENRICHMENT_WEIGHT = 0.50


class TestMaturityScorer:
    """
    Enrichment dimensions (sums to 100):
      +35  % sessions with has_test_context
      +30  TDD / test-after workflow pattern
      +20  test file extensions present
      +15  test commands in bash

    Combined with the core baseline (avg_test_ratio across imported repos)
    using a 50/50 weight — historical testing rigor and current habits
    both matter equally.

    R1.2 — fallback_when_enrichment_missing = True. When enrichment is
    absent (no sessions captured), the scorer returns the core baseline
    (avg_test_ratio * 100). No neutral-50 fallback.
    """

    data_sources: ClassVar[list[DataSource]] = ["core", "enrichment"]
    fallback_when_enrichment_missing: ClassVar[bool] = True

    def score(self, sessions: list[Session], l1: Optional[L1Snapshot] = None) -> int:
        l1 = l1 or L1Snapshot()
        enrichment_score = self._score_enrichment(sessions)

        if l1.is_empty:
            # No imported repos. Score whatever enrichment we have.
            return enrichment_score

        core_baseline = int(round(max(0.0, min(1.0, l1.avg_test_ratio)) * 100))
        if not sessions:
            # R1.2 — enrichment absent. Honor fallback_when_enrichment_missing
            # by returning the core baseline (no neutral 50).
            return core_baseline

        return int(round(core_baseline * _CORE_WEIGHT + enrichment_score * _ENRICHMENT_WEIGHT))

    def _score_enrichment(self, sessions: list[Session]) -> int:
        if not sessions:
            return 0

        result = 0

        # 1. Sessions with test context
        test_count = sum(1 for s in sessions if s.has_test_context)
        result += int(35 * test_count / len(sessions))

        # 2. TDD / test-after workflow (use stored pattern or detect from events)
        tdd_count = 0
        for s in sessions:
            if s.workflow_pattern in ("tdd", "test-after"):
                tdd_count += 1
                continue
            if s.events and s.has_test_context:
                tools = [e.tool_name for e in s.events if e.event_type == "pre_tool_use" and e.tool_name]
                bash_idxs = [i for i, t in enumerate(tools) if t == "Bash"]
                write_idxs = [i for i, t in enumerate(tools) if t in ("Write", "Edit")]
                if bash_idxs and write_idxs and any(b > w for b in bash_idxs for w in write_idxs):
                    tdd_count += 1
        result += int(30 * min(tdd_count / len(sessions) * 2, 1.0))

        # 3. Test file extensions
        with_test_files = sum(
            1 for s in sessions
            if any(any(pat in ext for pat in _TEST_EXTENSIONS) for ext in s.file_extensions)
        )
        result += int(20 * with_test_files / len(sessions))

        # 4. Test commands
        with_test_cmds = sum(
            1 for s in sessions
            if any(cmd and any(t in cmd.lower() for t in _TEST_COMMANDS) for cmd in s.commands)
        )
        result += int(15 * with_test_cmds / len(sessions))

        return min(100, result)

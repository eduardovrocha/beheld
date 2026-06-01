from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone

import pytest

from models import Session
from scorers.base import L1Snapshot
from scorers.growth_rate import GrowthRateScorer
from scorers.overall import WEIGHTS
from scorers.prompt_quality import PromptQualityScorer
from scorers.tech_breadth import TechBreadthScorer
from scorers.test_maturity import TestMaturityScorer


# ── helpers ──────────────────────────────────────────────────────────────────


def _session(
    sid: str = "s1",
    started: datetime | None = None,
    *,
    tools: list[str] | None = None,
    exts: dict[str, int] | None = None,
    commands: list[str] | None = None,
    has_test_context: bool = False,
    workflow_pattern: str = "feature_work",
    duration: float = 10.0,
) -> Session:
    return Session(
        session_id=sid,
        source="claude-code",
        started_at=started or datetime(2026, 5, 1, 10, 0, tzinfo=timezone.utc),
        ended_at=(started or datetime(2026, 5, 1, 10, 0, tzinfo=timezone.utc))
        + timedelta(minutes=duration),
        duration_minutes=duration,
        events=[],
        tools_used=tools or ["Bash", "Edit"],
        file_extensions=Counter(exts or {".py": 3}),
        commands=commands or [],
        cwd_hash="h",
        total_turns=5,
        has_test_context=has_test_context,
        workflow_pattern=workflow_pattern,
    )


def _l1(
    ecosystems: dict[str, bool] | None = None,
    platforms: dict[str, bool] | None = None,
    extensions: dict[str, int] | None = None,
    avg_test_ratio: float = 0.0,
    total_repos: int = 1,
) -> L1Snapshot:
    return L1Snapshot(
        total_repos=total_repos,
        total_commits=100,
        extensions=extensions or {"py": 200, "rb": 50},
        ecosystems=ecosystems or {"python": True, "rails": True},
        platforms=platforms or {"docker": True},
        avg_test_ratio=avg_test_ratio,
    )


# ── data_sources declaration ─────────────────────────────────────────────────


def test_scorers_declare_data_sources() -> None:
    # R1.2 — data_sources strings renamed l1/l2 → core/enrichment per
    # spec §3.2. fallback_when_enrichment_missing ClassVar declared per
    # scorer: True for the three with a core baseline, False for
    # PromptQuality (enrichment-exclusive).
    assert PromptQualityScorer.data_sources == ["enrichment"]
    assert PromptQualityScorer.fallback_when_enrichment_missing is False
    assert TestMaturityScorer.data_sources == ["core", "enrichment"]
    assert TestMaturityScorer.fallback_when_enrichment_missing is True
    assert TechBreadthScorer.data_sources == ["core", "enrichment"]
    assert TechBreadthScorer.fallback_when_enrichment_missing is True
    assert GrowthRateScorer.data_sources == ["core", "enrichment"]
    assert GrowthRateScorer.fallback_when_enrichment_missing is True


# ── TechBreadth ──────────────────────────────────────────────────────────────


def test_tech_breadth_with_l1_only_returns_valid_score() -> None:
    """No sessions, but L1 has ecosystems/platforms → score must be > 0."""
    l1 = _l1(
        ecosystems={"python": True, "rails": True, "node": True},
        platforms={"docker": True, "github": True},
        extensions={"py": 100, "rb": 80, "ts": 40},
    )
    score = TechBreadthScorer().score(sessions=[], l1=l1)
    assert score > 0
    assert score <= 100


def test_tech_breadth_with_l2_only_preserves_existing_behavior() -> None:
    """L1 empty → score must match pre-Phase-6 result of L2-only path."""
    sessions = [
        _session(exts={".py": 5}, commands=["docker build .", "pytest"]),
        _session(exts={".rb": 3}, commands=["bundle install"]),
    ]
    with_empty_l1 = TechBreadthScorer().score(sessions, l1=L1Snapshot())
    without_l1_arg = TechBreadthScorer().score(sessions)
    assert with_empty_l1 == without_l1_arg
    assert with_empty_l1 > 0  # the sessions cover several ecosystems/platforms


def test_tech_breadth_combines_core_and_enrichment_with_correct_weights() -> None:
    """R1.2 — verify the 60/40 blend after internal rename from
    _score_l1/_score_l2 to _score_core/_score_enrichment."""
    scorer = TechBreadthScorer()
    scorer._score_core = lambda l1: 80  # type: ignore[method-assign]
    scorer._score_enrichment = lambda sessions: 40  # type: ignore[method-assign]
    sessions = [_session()]
    l1 = _l1()
    result = scorer.score(sessions, l1=l1)
    # 80 * 0.60 + 40 * 0.40 = 48 + 16 = 64
    assert result == 64


def test_tech_breadth_core_only_no_sessions_returns_core_score() -> None:
    """R1.2 — enrichment absent → fallback_when_enrichment_missing=True
    returns the core-only score (no neutral-50 fallback)."""
    scorer = TechBreadthScorer()
    scorer._score_core = lambda l1: 72  # type: ignore[method-assign]
    result = scorer.score(sessions=[], l1=_l1())
    assert result == 72


# ── TestMaturity ─────────────────────────────────────────────────────────────


def test_test_maturity_l1_baseline_influences_score() -> None:
    """When L1 has a strong test ratio and L2 is weak, the final must lie
    between the two baselines — confirming the 50/50 blend."""
    sessions = [_session(has_test_context=False)]
    l2_only = TestMaturityScorer().score(sessions)
    with_strong_l1 = TestMaturityScorer().score(
        sessions, l1=_l1(avg_test_ratio=0.8)
    )
    # L1 baseline = 80; L2 ~ 0 → combined ~ 40. Must exceed L2-only.
    assert with_strong_l1 > l2_only
    assert with_strong_l1 <= 100


def test_test_maturity_l1_only_no_sessions_returns_baseline_times_100() -> None:
    score = TestMaturityScorer().score(sessions=[], l1=_l1(avg_test_ratio=0.42))
    assert score == 42


def test_test_maturity_l1_empty_falls_back_to_l2() -> None:
    sessions = [_session(has_test_context=True)]
    fallback = TestMaturityScorer().score(sessions, l1=L1Snapshot())
    direct = TestMaturityScorer().score(sessions)
    assert fallback == direct


# ── GrowthRate ───────────────────────────────────────────────────────────────


def test_growth_rate_detects_new_ecosystem_vs_l1_baseline() -> None:
    """A session ecosystem absent from L1 must push the score above neutral."""
    # L1 only knows Python.
    l1 = _l1(ecosystems={"python": True}, platforms={"docker": True})
    # Recent L2 introduces a Ruby ecosystem (Gemfile in path → 'rails' eco).
    recent = [
        _session(
            exts={".rb": 5, ".gemfile": 1},
            commands=["bundle install"],
        )
    ]
    result = GrowthRateScorer().score(recent=recent, previous=[], l1=l1)
    assert result > 50


def test_growth_rate_detects_improved_test_ratio_vs_l1() -> None:
    """L2 with high test ratio against a low-test L1 baseline → above neutral."""
    l1 = _l1(
        ecosystems={"python": True},
        platforms={"docker": True},
        avg_test_ratio=0.05,
    )
    recent = [
        _session(sid="a", has_test_context=True, exts={".py": 5}),
        _session(sid="b", has_test_context=True, exts={".py": 3}),
        _session(sid="c", has_test_context=True, exts={".py": 2}),
    ]
    result = GrowthRateScorer().score(recent=recent, previous=[], l1=l1)
    assert result > 50


def test_growth_rate_l1_empty_falls_back_to_l2_comparison() -> None:
    """L1 empty → behavior must be identical to pre-Phase-6 (recent vs previous)."""
    recent = [_session(sid="r1", exts={".py": 3}, has_test_context=True)]
    previous = [_session(sid="p1", exts={".py": 2}, has_test_context=False)]

    with_empty_l1 = GrowthRateScorer().score(recent, previous, l1=L1Snapshot())
    without_l1_arg = GrowthRateScorer().score(recent, previous)
    assert with_empty_l1 == without_l1_arg


def test_growth_rate_enrichment_empty_without_monthly_buckets_returns_none() -> None:
    """R1.2 — no recent/previous sessions AND core has no monthly_buckets
    (legacy fixture or pre-R1.2a data) → cannot judge trajectory →
    returns None (dimension absent). The legacy neutral-50 was removed
    per spec rule "honestidade de captura"."""
    # _l1() helper produces an L1Snapshot WITHOUT monthly_buckets.
    score = GrowthRateScorer().score(recent=[], previous=[], l1=_l1())
    assert score is None


def test_growth_rate_enrichment_empty_l1_empty_returns_none() -> None:
    """R1.2 — no enrichment AND no core data at all → None (no dimension
    to observe). Was 0 in legacy."""
    score = GrowthRateScorer().score(recent=[], previous=[])
    assert score is None


# ── PromptQuality (enrichment-only) ──────────────────────────────────────────


def test_prompt_quality_ignores_core_completely() -> None:
    """R1.2 — PromptQualityScorer is enrichment-exclusive: it must not
    accept an l1 (core) parameter, and its declared data_sources is
    ['enrichment'] with fallback_when_enrichment_missing=False."""
    assert PromptQualityScorer.data_sources == ["enrichment"]
    assert PromptQualityScorer.fallback_when_enrichment_missing is False

    import inspect
    sig = inspect.signature(PromptQualityScorer().score)
    assert "l1" not in sig.parameters


# ── WEIGHTS ──────────────────────────────────────────────────────────────────


def test_overall_weights_sum_to_one() -> None:
    total = sum(v["weight"] for v in WEIGHTS.values())
    assert abs(total - 1.0) < 1e-9


def test_overall_weights_declare_sources() -> None:
    # R1.2 — sources strings renamed l1/l2 → core/enrichment per spec §3.2.
    # Weight values are UNCHANGED (PromptQuality is the only enrichment-only).
    assert WEIGHTS["prompt_quality"]["sources"] == ["enrichment"]
    assert WEIGHTS["test_maturity"]["sources"] == ["core", "enrichment"]
    assert WEIGHTS["tech_breadth"]["sources"] == ["core", "enrichment"]
    assert WEIGHTS["growth_rate"]["sources"] == ["core", "enrichment"]

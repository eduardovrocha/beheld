from __future__ import annotations

import pytest

from scorers.growth_rate import GrowthRateScorer, _delta_score
from scorers.prompt_quality import PromptQualityScorer
from scorers.tech_breadth import TechBreadthScorer
from scorers.test_maturity import TestMaturityScorer


# ── prompt_quality ────────────────────────────────────────────────────────────


def test_prompt_quality_empty() -> None:
    assert PromptQualityScorer().score([]) == 0


def test_prompt_quality_with_test_session(sample_session_1) -> None:
    score = PromptQualityScorer().score([sample_session_1])
    assert 0 <= score <= 100


def test_prompt_quality_two_sessions(two_sessions) -> None:
    score = PromptQualityScorer().score(two_sessions)
    assert 0 <= score <= 100


def test_prompt_quality_with_chat_event(sample_session_2) -> None:
    # sess-2 has avg_prompt_length=350 and has_code_context_ratio=1.0
    score = PromptQualityScorer().score([sample_session_2])
    assert score > 0


def test_prompt_quality_capped_at_100(two_sessions) -> None:
    assert PromptQualityScorer().score(two_sessions) <= 100


# ── test_maturity ─────────────────────────────────────────────────────────────


def test_test_maturity_empty() -> None:
    assert TestMaturityScorer().score([]) == 0


def test_test_maturity_with_test_session(sample_session_1) -> None:
    # sess-1 has: has_test_context + rspec commands + .spec.rb file
    score = TestMaturityScorer().score([sample_session_1])
    assert score > 40


def test_test_maturity_without_tests(sample_session_2) -> None:
    score = TestMaturityScorer().score([sample_session_2])
    assert score < 20


def test_test_maturity_with_tdd_workflow(sample_session_1) -> None:
    import copy
    s = copy.deepcopy(sample_session_1)
    s.workflow_pattern = "tdd"
    score = TestMaturityScorer().score([s])
    assert score >= 35


def test_test_maturity_capped(sample_session_1) -> None:
    assert TestMaturityScorer().score([sample_session_1, sample_session_1]) <= 100


# ── tech_breadth ──────────────────────────────────────────────────────────────


def test_tech_breadth_empty() -> None:
    assert TechBreadthScorer().score([]) == 0


def test_tech_breadth_single_session(sample_session_1) -> None:
    score = TechBreadthScorer().score([sample_session_1])
    assert 0 < score <= 100


def test_tech_breadth_with_docker(sample_session_2) -> None:
    # sess-2 has docker command → infra +10
    score = TechBreadthScorer().score([sample_session_2])
    assert score >= 10


def test_tech_breadth_more_ecosystems(two_sessions) -> None:
    single = TechBreadthScorer().score([two_sessions[0]])
    combined = TechBreadthScorer().score(two_sessions)
    assert combined >= single


def test_tech_breadth_capped_at_100(two_sessions) -> None:
    assert TechBreadthScorer().score(two_sessions) <= 100


# ── growth_rate ───────────────────────────────────────────────────────────────


def test_growth_rate_empty_recent() -> None:
    assert GrowthRateScorer().score([], []) == 0


def test_growth_rate_no_previous(sample_session_1) -> None:
    score = GrowthRateScorer().score([sample_session_1], [])
    assert score == 50


def test_growth_rate_same_sessions(sample_session_1) -> None:
    score = GrowthRateScorer().score([sample_session_1], [sample_session_1])
    assert 40 <= score <= 65


def test_growth_rate_improvement(sample_session_1, sample_session_2) -> None:
    # sess-1 (with tests, longer) vs sess-2 (shorter, no tests)
    improving = GrowthRateScorer().score([sample_session_1], [sample_session_2])
    declining = GrowthRateScorer().score([sample_session_2], [sample_session_1])
    assert improving > declining


def test_growth_rate_bounded(two_sessions, sample_session_2) -> None:
    score = GrowthRateScorer().score(two_sessions, [sample_session_2])
    assert 0 <= score <= 100


# ── _delta_score (module-level helper) ────────────────────────────────────────


def test_delta_score_neutral() -> None:
    assert _delta_score(100.0, 100.0, 30) == 15  # no change → max/2


def test_delta_score_max_improvement() -> None:
    assert _delta_score(200.0, 100.0, 30) == 30  # +100% → max weight


def test_delta_score_max_decline() -> None:
    assert _delta_score(50.0, 100.0, 30) == 0  # -50% → 0


def test_delta_score_zero_previous() -> None:
    assert _delta_score(100.0, 0.0, 20) == 20  # any value from 0 = full growth

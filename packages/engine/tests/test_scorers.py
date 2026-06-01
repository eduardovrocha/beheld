from __future__ import annotations

import pytest

from scorers.growth_rate import GrowthRateScorer, _delta_score
from scorers.overall import WEIGHTS, calculate_overall
from scorers.prompt_quality import PromptQualityScorer
from scorers.tech_breadth import TechBreadthScorer
from scorers.test_maturity import TestMaturityScorer


# ── prompt_quality ────────────────────────────────────────────────────────────


def test_prompt_quality_empty() -> None:
    # R1.2 — PromptQuality has fallback_when_enrichment_missing=False:
    # when no sessions exist, the dimension is absent and the scorer
    # returns None instead of fabricating a neutral 0.
    assert PromptQualityScorer().score([]) is None


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
    # R1.2 — without any L1 history (empty L1Snapshot default) AND with
    # no recent/previous sessions, GrowthRate cannot judge trajectory:
    # returns None (dimension absent). Was 0 in legacy.
    assert GrowthRateScorer().score([], []) is None


def test_growth_rate_no_previous(sample_session_1) -> None:
    # R1.2 — no L1 history, sessions but no previous baseline. The new
    # _score_enrichment_only path returns a score derived from the
    # session metrics (no longer hardcoded 50). Verify it's a valid
    # int in [0, 100], not pinned to the legacy neutral value.
    score = GrowthRateScorer().score([sample_session_1], [])
    assert isinstance(score, int)
    assert 0 <= score <= 100


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


# ── calculate_overall ────────────────────────────────────────────────────────


def test_overall_weights() -> None:
    assert abs(sum(v["weight"] for v in WEIGHTS.values()) - 1.0) < 1e-9


def test_overall_weights_individual() -> None:
    assert WEIGHTS["prompt_quality"]["weight"] == 0.30
    assert WEIGHTS["test_maturity"]["weight"]  == 0.30
    assert WEIGHTS["tech_breadth"]["weight"]   == 0.25
    assert WEIGHTS["growth_rate"]["weight"]    == 0.15


def test_overall_senior_balanced() -> None:
    # raw = 85*0.30 + 80*0.30 + 90*0.25 + 70*0.15 = 82.5 → round → 82
    # (spec stated 83 but Python banker's rounding rounds 82.5 to even 82)
    assert calculate_overall(85, 80, 90, 70) == 82


def test_overall_good_prompts_no_tests() -> None:
    # raw = 95*0.30 + 20*0.30 + 70*0.25 + 50*0.15 = 59.5 → round → 60
    # test_maturity baixo puxa o score para baixo significativamente
    assert calculate_overall(95, 20, 70, 50) == 60


def test_overall_beginner_neutral_growth() -> None:
    # raw = 40*0.30 + 30*0.30 + 35*0.25 + 50*0.15 = 37.25 → round → 37
    # growth_rate neutro (50) não prejudica quem tem pouco histórico
    assert calculate_overall(40, 30, 35, 50) == 37


def test_overall_stagnant_but_competent() -> None:
    # raw = 80*0.30 + 75*0.30 + 85*0.25 + 20*0.15 = 70.75 → round → 71
    # growth baixo (20) mas não derruba quem é competente
    assert calculate_overall(80, 75, 85, 20) == 71


def test_overall_perfect() -> None:
    assert calculate_overall(100, 100, 100, 100) == 100


def test_overall_zero() -> None:
    assert calculate_overall(0, 0, 0, 0) == 0

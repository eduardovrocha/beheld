from __future__ import annotations

import pytest

from scorers.growth_rate import _delta_score, compute_growth_rate
from scorers.prompt_quality import compute_prompt_quality
from scorers.tech_breadth import compute_tech_breadth
from scorers.test_maturity import compute_test_maturity


# ── prompt_quality ────────────────────────────────────────────────────────────


def test_prompt_quality_empty() -> None:
    assert compute_prompt_quality([]) == 0


def test_prompt_quality_with_test_session(sample_session_1) -> None:
    score = compute_prompt_quality([sample_session_1])
    assert 0 <= score <= 100


def test_prompt_quality_two_sessions(two_sessions) -> None:
    score = compute_prompt_quality(two_sessions)
    assert 0 <= score <= 100


def test_prompt_quality_no_prompts(sample_session_1) -> None:
    # sess-1 has no chat_request events (only tool use) → lower prompt score
    score = compute_prompt_quality([sample_session_1])
    # Should still be valid
    assert 0 <= score <= 100


def test_prompt_quality_with_chat_event(sample_session_2) -> None:
    # sess-2 has a chat_request with prompt_length=350 and has_code_context=True
    score = compute_prompt_quality([sample_session_2])
    # Should get points for prompt length and code context
    assert score > 0


# ── test_maturity ─────────────────────────────────────────────────────────────


def test_test_maturity_empty() -> None:
    assert compute_test_maturity([]) == 0


def test_test_maturity_with_test_session(sample_session_1) -> None:
    score = compute_test_maturity([sample_session_1])
    # sess-1 has: has_test_context + rspec commands + .spec.rb file + TDD-like pattern
    assert score > 40


def test_test_maturity_without_tests(sample_session_2) -> None:
    score = compute_test_maturity([sample_session_2])
    # sess-2 has no test context, no test commands
    assert score < 20


def test_test_maturity_max_with_all_signals(sample_session_1) -> None:
    # Use same session twice to increase ratios
    score = compute_test_maturity([sample_session_1, sample_session_1])
    assert score >= 35  # at minimum the has_test_context portion


# ── tech_breadth ──────────────────────────────────────────────────────────────


def test_tech_breadth_empty() -> None:
    assert compute_tech_breadth([]) == 0


def test_tech_breadth_single_session(sample_session_1) -> None:
    score = compute_tech_breadth([sample_session_1])
    assert 0 < score <= 100


def test_tech_breadth_with_docker(sample_session_2) -> None:
    # sess-2 has docker command → infra +10
    score = compute_tech_breadth([sample_session_2])
    assert score >= 10


def test_tech_breadth_more_ecosystems(two_sessions) -> None:
    single = compute_tech_breadth([two_sessions[0]])
    combined = compute_tech_breadth(two_sessions)
    # More sessions → more ecosystems → higher score
    assert combined >= single


def test_tech_breadth_capped_at_100(two_sessions) -> None:
    assert compute_tech_breadth(two_sessions) <= 100


# ── growth_rate ───────────────────────────────────────────────────────────────


def test_growth_rate_empty_recent() -> None:
    assert compute_growth_rate([], []) == 0


def test_growth_rate_no_previous(sample_session_1) -> None:
    score = compute_growth_rate([sample_session_1], [])
    assert score == 50


def test_growth_rate_same_sessions(sample_session_1) -> None:
    score = compute_growth_rate([sample_session_1], [sample_session_1])
    # No change → neutral ≈ 50
    assert 40 <= score <= 65


def test_growth_rate_improvement(sample_session_1, sample_session_2) -> None:
    # sess-1 (with tests, longer) vs sess-2 (shorter, no tests)
    score_improving = compute_growth_rate([sample_session_1], [sample_session_2])
    score_declining = compute_growth_rate([sample_session_2], [sample_session_1])
    assert score_improving > score_declining


def test_growth_rate_bounded(two_sessions, sample_session_2) -> None:
    score = compute_growth_rate(two_sessions, [sample_session_2])
    assert 0 <= score <= 100


def test_delta_score_neutral() -> None:
    assert _delta_score(100.0, 100.0, 30) == 15  # no change → max/2


def test_delta_score_max_improvement() -> None:
    assert _delta_score(200.0, 100.0, 30) == 30  # +100% → max weight


def test_delta_score_max_decline() -> None:
    assert _delta_score(50.0, 100.0, 30) == 0  # -50% → 0


def test_delta_score_zero_previous() -> None:
    assert _delta_score(100.0, 0.0, 20) == 20  # any value from 0 = full growth

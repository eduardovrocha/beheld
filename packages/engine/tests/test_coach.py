from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone

import pytest

from coach import (
    COACHING_GUIDANCE,
    compute_workflow_metrics,
    detect_patterns,
)
from models import (
    CoachingGuidance,
    Pattern,
    Scores,
    Session,
    SessionContext,
    WorkflowMetrics,
)


def _mk_session(
    sid: str,
    workflow_pattern: str = "unknown",
    duration: float = 30.0,
    tools: list[str] | None = None,
    sequence: list[str] | None = None,
    extensions: dict[str, int] | None = None,
    avg_prompt: float = 0.0,
    event_count: int = 0,
) -> Session:
    return Session(
        session_id=sid,
        source="claude-code",
        started_at=datetime(2026, 5, 10, 10, 0, 0, tzinfo=timezone.utc),
        ended_at=datetime(2026, 5, 10, 10, 30, 0, tzinfo=timezone.utc),
        duration_minutes=duration,
        tools_used=tools or [],
        file_extensions=Counter(extensions or {}),
        commands=[],
        cwd_hash="hash",
        total_turns=0,
        has_test_context=False,
        workflow_pattern=workflow_pattern,
        avg_prompt_length=avg_prompt,
        event_count=event_count,
        tool_sequence=sequence or [],
    )


def _zero_scores() -> Scores:
    return Scores(
        date="2026-05-10",
        prompt_quality=0,
        test_maturity=0,
        tech_breadth=0,
        growth_rate=0,
        overall=0,
        sessions_analyzed=0,
    )


# ── compute_workflow_metrics ──────────────────────────────────────────────────


def test_empty_sessions_returns_zero_metrics() -> None:
    m = compute_workflow_metrics([])
    assert m == WorkflowMetrics()


def test_test_after_ratio() -> None:
    sessions = [
        _mk_session("a", workflow_pattern="test-after"),
        _mk_session("b", workflow_pattern="test-after"),
        _mk_session("c", workflow_pattern="unknown"),
        _mk_session("d", workflow_pattern="tdd"),
    ]
    m = compute_workflow_metrics(sessions)
    assert m.test_after_ratio == 0.5
    assert m.test_first_ratio == 0.25


def test_bash_to_read_ratio_basic() -> None:
    s = _mk_session("a", sequence=["Bash", "Bash", "Bash", "Bash", "Read"])
    m = compute_workflow_metrics([s])
    assert m.bash_to_read_ratio == 4.0


def test_bash_to_read_ratio_with_zero_reads_caps_at_total_bash() -> None:
    s = _mk_session("a", sequence=["Bash", "Bash", "Bash"])
    m = compute_workflow_metrics([s])
    assert m.bash_to_read_ratio == 3.0


def test_bash_to_read_ratio_with_no_data_is_zero() -> None:
    s = _mk_session("a", sequence=["Edit", "Edit"])
    m = compute_workflow_metrics([s])
    assert m.bash_to_read_ratio == 0.0


def test_bash_to_read_ratio_is_capped() -> None:
    s = _mk_session("a", sequence=["Bash"] * 500)
    m = compute_workflow_metrics([s])
    assert m.bash_to_read_ratio == 100.0  # _RATIO_CAP


def test_tool_normalization_recognizes_aliases() -> None:
    s = _mk_session("a", sequence=["str_replace", "run_terminal_cmd", "read_file"])
    m = compute_workflow_metrics([s])
    # 1 bash, 1 read → ratio = 1.0
    assert m.bash_to_read_ratio == 1.0


def test_test_suffix_normalizes_correctly() -> None:
    s = _mk_session("a", sequence=["Bash_test", "Bash_test", "Read"])
    m = compute_workflow_metrics([s])
    assert m.bash_to_read_ratio == 2.0


def test_median_test_delay_uses_test_after_sessions_only() -> None:
    sessions = [
        _mk_session("a", workflow_pattern="test-after", duration=10.0),
        _mk_session("b", workflow_pattern="test-after", duration=20.0),
        _mk_session("c", workflow_pattern="test-after", duration=30.0),
        _mk_session("d", workflow_pattern="tdd", duration=999.0),  # ignored
    ]
    m = compute_workflow_metrics(sessions)
    assert m.median_test_delay_min == 20.0


def test_edit_to_test_lag_requires_both_edit_and_test_marker() -> None:
    sessions = [
        _mk_session("a", sequence=["Edit", "Write_test"], duration=15.0),
        _mk_session("b", sequence=["Edit", "Write_test"], duration=25.0),
        _mk_session("c", sequence=["Edit", "Edit"], duration=999.0),  # no test marker → excluded
        _mk_session("d", sequence=["Write_test", "Write_test"], duration=999.0),  # no edit → excluded
    ]
    m = compute_workflow_metrics(sessions)
    assert m.edit_to_test_lag_min == 20.0


def test_session_avg_duration() -> None:
    sessions = [
        _mk_session("a", duration=10.0),
        _mk_session("b", duration=20.0),
        _mk_session("c", duration=30.0),
    ]
    m = compute_workflow_metrics(sessions)
    assert m.session_avg_duration_min == 20.0


def test_session_avg_duration_skips_zero_durations() -> None:
    sessions = [
        _mk_session("a", duration=0.0),
        _mk_session("b", duration=10.0),
        _mk_session("c", duration=20.0),
    ]
    m = compute_workflow_metrics(sessions)
    assert m.session_avg_duration_min == 15.0


def test_prompt_avg_is_weighted_by_event_count() -> None:
    sessions = [
        _mk_session("a", avg_prompt=100.0, event_count=10),
        _mk_session("b", avg_prompt=200.0, event_count=30),
    ]
    m = compute_workflow_metrics(sessions)
    # weighted: (100*10 + 200*30) / 40 = 7000/40 = 175
    assert m.prompt_avg_chars == 175.0


def test_prompt_median_is_unweighted_session_median() -> None:
    sessions = [
        _mk_session("a", avg_prompt=50.0, event_count=1),
        _mk_session("b", avg_prompt=100.0, event_count=1),
        _mk_session("c", avg_prompt=200.0, event_count=1),
    ]
    m = compute_workflow_metrics(sessions)
    assert m.prompt_median_chars == 100.0


def test_tool_variety_avg() -> None:
    sessions = [
        _mk_session("a", tools=["Bash", "Read"]),       # 2
        _mk_session("b", tools=["Bash", "Read", "Edit"]),  # 3
        _mk_session("c", tools=["Bash"]),                # 1
    ]
    m = compute_workflow_metrics(sessions)
    assert m.tool_variety_avg == 2.0


def test_ecosystem_concentration_mono_ecosystem_is_one() -> None:
    s = _mk_session("a", extensions={".rb": 10})
    m = compute_workflow_metrics([s])
    assert m.ecosystem_concentration == 1.0


def test_ecosystem_concentration_uniform_split() -> None:
    s = _mk_session("a", extensions={".rb": 5, ".py": 5})
    m = compute_workflow_metrics([s])
    # HHI = 0.5² + 0.5² = 0.5
    assert m.ecosystem_concentration == pytest.approx(0.5)


def test_ecosystem_concentration_zero_when_no_known_extensions() -> None:
    s = _mk_session("a", extensions={".xyz": 5})
    m = compute_workflow_metrics([s])
    assert m.ecosystem_concentration == 0.0


def test_metrics_are_serializable_to_canonical_json() -> None:
    """Bundle hash determinism: metrics must produce stable JSON."""
    import json
    from dataclasses import asdict

    sessions = [_mk_session("a", workflow_pattern="test-after", extensions={".rb": 3})]
    m = compute_workflow_metrics(sessions)
    serialized = json.dumps(asdict(m), sort_keys=True, separators=(",", ":"))
    # No Infinity, no NaN — must be valid JSON
    parsed = json.loads(serialized)
    assert parsed["test_after_ratio"] == 1.0
    assert all(isinstance(v, (int, float)) for v in parsed.values())


# ── detect_patterns ───────────────────────────────────────────────────────────


def test_detect_patterns_empty_metrics_returns_empty_list() -> None:
    assert detect_patterns(WorkflowMetrics(), _zero_scores()) == []


def test_test_after_dominant_fires_at_threshold() -> None:
    m = WorkflowMetrics(test_after_ratio=0.6, median_test_delay_min=15.0)
    patterns = detect_patterns(m, _zero_scores())
    ids = [p.id for p in patterns]
    assert "test_after_dominant" in ids


def test_test_after_dominant_does_not_fire_below_threshold() -> None:
    m = WorkflowMetrics(test_after_ratio=0.59)
    patterns = detect_patterns(m, _zero_scores())
    assert "test_after_dominant" not in [p.id for p in patterns]


def test_test_after_dominant_severity_high_at_80_percent() -> None:
    m = WorkflowMetrics(test_after_ratio=0.85, median_test_delay_min=12.0)
    patterns = detect_patterns(m, _zero_scores())
    p = next(p for p in patterns if p.id == "test_after_dominant")
    assert p.severity == "high"
    assert 0.0 <= p.confidence <= 1.0


def test_test_after_dominant_metric_carries_only_referenced_numbers() -> None:
    m = WorkflowMetrics(test_after_ratio=0.78, median_test_delay_min=11.0)
    patterns = detect_patterns(m, _zero_scores())
    p = next(p for p in patterns if p.id == "test_after_dominant")
    assert p.metric == {"ratio": 0.78, "median_session_min": 11.0}


def test_debug_driven_bash_heavy_fires() -> None:
    m = WorkflowMetrics(bash_to_read_ratio=8.0)
    patterns = detect_patterns(m, _zero_scores())
    p = next(p for p in patterns if p.id == "debug_driven_bash_heavy")
    assert p.severity == "medium"
    assert p.confidence == 1.0


def test_debug_driven_bash_heavy_does_not_fire_under_threshold() -> None:
    m = WorkflowMetrics(bash_to_read_ratio=3.9)
    patterns = detect_patterns(m, _zero_scores())
    assert "debug_driven_bash_heavy" not in [p.id for p in patterns]


def test_narrow_ecosystem_fires_when_concentrated() -> None:
    m = WorkflowMetrics(ecosystem_concentration=0.85)
    patterns = detect_patterns(m, _zero_scores())
    assert "narrow_ecosystem" in [p.id for p in patterns]


def test_prompt_too_short_fires_below_80() -> None:
    m = WorkflowMetrics(prompt_median_chars=40.0)
    patterns = detect_patterns(m, _zero_scores())
    p = next(p for p in patterns if p.id == "prompt_too_short")
    assert p.severity == "medium"


def test_prompt_too_short_does_not_fire_when_median_is_zero() -> None:
    """median=0 means no prompts at all, not 'too short'."""
    m = WorkflowMetrics(prompt_median_chars=0.0)
    patterns = detect_patterns(m, _zero_scores())
    assert "prompt_too_short" not in [p.id for p in patterns]


def test_test_first_strong_fires_at_25_percent() -> None:
    m = WorkflowMetrics(test_first_ratio=0.30)
    patterns = detect_patterns(m, _zero_scores())
    p = next(p for p in patterns if p.id == "test_first_strong")
    assert p.severity == "low"  # strength, not a problem


def test_pattern_applies_to_session_when_ecosystem_matches() -> None:
    m = WorkflowMetrics(test_after_ratio=0.7)
    ctx = SessionContext(ecosystems_recent=["rails"], session_phase_hint="feature_work")
    patterns = detect_patterns(m, _zero_scores(), ctx)
    p = next(p for p in patterns if p.id == "test_after_dominant")
    assert p.applies_to_current_session is True


def test_pattern_does_not_apply_when_ecosystem_unrelated() -> None:
    m = WorkflowMetrics(test_after_ratio=0.7)
    ctx = SessionContext(ecosystems_recent=["scala"])  # not in affinity set
    patterns = detect_patterns(m, _zero_scores(), ctx)
    p = next(p for p in patterns if p.id == "test_after_dominant")
    assert p.applies_to_current_session is False


def test_universal_patterns_always_apply_to_session() -> None:
    """Patterns with empty ecosystem affinity (e.g., prompt_too_short) apply universally."""
    m = WorkflowMetrics(prompt_median_chars=40.0)
    ctx = SessionContext(ecosystems_recent=["totally-unknown-ecosystem"])
    patterns = detect_patterns(m, _zero_scores(), ctx)
    p = next(p for p in patterns if p.id == "prompt_too_short")
    assert p.applies_to_current_session is True


def test_detect_patterns_is_deterministic() -> None:
    """Same input → same output, every time."""
    m = WorkflowMetrics(
        test_after_ratio=0.78,
        median_test_delay_min=11.0,
        bash_to_read_ratio=7.8,
        ecosystem_concentration=0.84,
        prompt_median_chars=60.0,
    )
    s = _zero_scores()
    ctx = SessionContext(ecosystems_recent=["rails"])
    a = detect_patterns(m, s, ctx)
    b = detect_patterns(m, s, ctx)
    assert a == b


def test_pattern_confidence_is_bounded() -> None:
    """confidence ∈ [0, 1] across the metric range."""
    for ratio in [0.6, 0.7, 0.85, 1.0]:
        m = WorkflowMetrics(test_after_ratio=ratio)
        for p in detect_patterns(m, _zero_scores()):
            assert 0.0 <= p.confidence <= 1.0


# ── coaching_guidance constant ────────────────────────────────────────────────


def test_coaching_guidance_is_well_formed() -> None:
    assert isinstance(COACHING_GUIDANCE, CoachingGuidance)
    assert COACHING_GUIDANCE.tone.startswith("pt-BR")
    assert len(COACHING_GUIDANCE.must) >= 3
    assert len(COACHING_GUIDANCE.must_not) >= 3
    assert COACHING_GUIDANCE.good_example
    assert COACHING_GUIDANCE.bad_example

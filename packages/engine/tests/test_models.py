from __future__ import annotations

import json
from dataclasses import asdict, fields

import pytest

from models import (
    COACH_PAYLOAD_VERSION,
    CoachingGuidance,
    CoachPayload,
    Pattern,
    Scores,
    SessionContext,
    WorkflowMetrics,
)


# ── WorkflowMetrics ───────────────────────────────────────────────────────────


def test_workflow_metrics_defaults_are_zero() -> None:
    m = WorkflowMetrics()
    for f in fields(m):
        assert getattr(m, f.name) == 0.0


def test_workflow_metrics_is_frozen() -> None:
    m = WorkflowMetrics()
    with pytest.raises(Exception):
        m.test_after_ratio = 0.5  # type: ignore[misc]


def test_workflow_metrics_from_dict_roundtrip() -> None:
    original = WorkflowMetrics(
        test_after_ratio=0.78,
        median_test_delay_min=11.0,
        bash_to_read_ratio=7.8,
        prompt_avg_chars=142.0,
        ecosystem_concentration=0.84,
    )
    recovered = WorkflowMetrics.from_dict(asdict(original))
    assert recovered == original


def test_workflow_metrics_from_dict_ignores_unknown_keys() -> None:
    m = WorkflowMetrics.from_dict({"test_after_ratio": 0.5, "unknown_field": 999})
    assert m.test_after_ratio == 0.5


def test_workflow_metrics_from_dict_coerces_ints_to_float() -> None:
    m = WorkflowMetrics.from_dict({"prompt_avg_chars": 142})
    assert m.prompt_avg_chars == 142.0
    assert isinstance(m.prompt_avg_chars, float)


def test_workflow_metrics_canonical_json_is_stable() -> None:
    """The bundle hash (F5.3.3) depends on canonical serialization.

    Two metrics objects with the same values must produce byte-identical JSON
    when serialized with sort_keys=True and compact separators."""
    a = WorkflowMetrics(test_after_ratio=0.78, bash_to_read_ratio=7.8)
    b = WorkflowMetrics(bash_to_read_ratio=7.8, test_after_ratio=0.78)
    sa = json.dumps(asdict(a), sort_keys=True, separators=(",", ":"))
    sb = json.dumps(asdict(b), sort_keys=True, separators=(",", ":"))
    assert sa == sb


def test_workflow_metrics_canonical_json_orders_keys_alphabetically() -> None:
    m = WorkflowMetrics(test_after_ratio=0.5, bash_to_read_ratio=1.0)
    s = json.dumps(asdict(m), sort_keys=True)
    # First key alphabetically is "bash_to_read_ratio"
    assert s.startswith('{"bash_to_read_ratio"')


# ── Pattern ───────────────────────────────────────────────────────────────────


def test_pattern_minimal_construction() -> None:
    p = Pattern(id="test_after_dominant", label="x", evidence="y")
    assert p.confidence == 0.0
    assert p.trend_30d == "stable"
    assert p.severity == "low"
    assert p.applies_to_current_session is False
    assert p.metric == {}


def test_pattern_is_frozen() -> None:
    p = Pattern(id="x", label="x", evidence="x")
    with pytest.raises(Exception):
        p.confidence = 1.0  # type: ignore[misc]


def test_pattern_carries_metric_dict() -> None:
    p = Pattern(
        id="test_after_dominant",
        label="Testes após código",
        evidence="78% das sessões",
        metric={"ratio": 0.78, "window_sessions": 30},
        confidence=0.84,
        severity="medium",
        applies_to_current_session=True,
    )
    assert p.metric["ratio"] == 0.78
    assert p.applies_to_current_session is True


# ── SessionContext ────────────────────────────────────────────────────────────


def test_session_context_defaults() -> None:
    ctx = SessionContext()
    assert ctx.current_project_category == "unknown"
    assert ctx.ecosystems_recent == []
    assert ctx.session_phase_hint == "unknown"


# ── CoachingGuidance ──────────────────────────────────────────────────────────


def test_coaching_guidance_required_fields() -> None:
    g = CoachingGuidance(
        tone="pt-BR, conciso",
        must=["citar números do metric"],
        must_not=["não inventar porcentagens"],
        good_example="ok",
        bad_example="ruim",
    )
    assert g.must == ["citar números do metric"]
    assert g.must_not == ["não inventar porcentagens"]


# ── CoachPayload ──────────────────────────────────────────────────────────────


def _make_payload(**overrides) -> CoachPayload:
    base = dict(
        version=COACH_PAYLOAD_VERSION,
        as_of="2026-05-13T23:15:00+00:00",
        data_freshness="live",
        scores=Scores(
            date="2026-05-13",
            prompt_quality=41,
            test_maturity=18,
            tech_breadth=29,
            growth_rate=12,
            overall=13,
            sessions_analyzed=26,
        ),
        context_for_session=SessionContext(
            current_project_category="web_backend",
            ecosystems_recent=["rails", "react"],
            session_phase_hint="feature_work",
        ),
        patterns=[
            Pattern(
                id="test_after_dominant",
                label="Testes escritos após o código",
                evidence="78% das últimas 30 sessões",
                metric={"ratio": 0.78, "window_sessions": 30.0},
                confidence=0.84,
                trend_30d="stable",
                severity="medium",
                applies_to_current_session=True,
            ),
        ],
        coaching_guidance=CoachingGuidance(
            tone="pt-BR, segunda pessoa, conciso",
            must=["Citar números do campo metric"],
            must_not=["Não inventar porcentagens"],
            good_example="ok",
            bad_example="ruim",
        ),
        suggested_followups=["Quer ver as sessões que puxaram esse padrão?"],
    )
    base.update(overrides)
    return CoachPayload(**base)


def test_coach_payload_version_constant() -> None:
    p = _make_payload()
    assert p.version == COACH_PAYLOAD_VERSION
    assert COACH_PAYLOAD_VERSION == 1  # bump deliberately when shape changes


def test_coach_payload_serializes_to_dict() -> None:
    p = _make_payload()
    d = asdict(p)
    assert d["version"] == 1
    assert d["data_freshness"] == "live"
    assert d["scores"]["overall"] == 13
    assert d["context_for_session"]["session_phase_hint"] == "feature_work"
    assert d["patterns"][0]["id"] == "test_after_dominant"
    assert d["patterns"][0]["applies_to_current_session"] is True
    assert d["coaching_guidance"]["tone"].startswith("pt-BR")


def test_coach_payload_json_roundtrip_preserves_shape() -> None:
    p = _make_payload()
    raw = json.dumps(asdict(p), sort_keys=True)
    back = json.loads(raw)
    assert back["version"] == p.version
    assert back["patterns"][0]["metric"]["ratio"] == 0.78


def test_coach_payload_is_frozen() -> None:
    p = _make_payload()
    with pytest.raises(Exception):
        p.data_freshness = "cache"  # type: ignore[misc]


def test_coach_payload_supports_insufficient_freshness() -> None:
    p = _make_payload(data_freshness="insufficient", patterns=[])
    assert p.data_freshness == "insufficient"
    assert p.patterns == []

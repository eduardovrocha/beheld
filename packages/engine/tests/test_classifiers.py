from __future__ import annotations

import pytest

from classifiers.platform import classify_platforms
from classifiers.project_type import classify
from classifiers.workflow import classify_workflow
from models import TechnicalSignals


# ── platform ──────────────────────────────────────────────────────────────────


def test_classify_platforms_docker(sample_session_2) -> None:
    result = classify_platforms(sample_session_2.commands)
    assert "docker" in result
    assert isinstance(result, dict)


def test_classify_platforms_testing(sample_session_1) -> None:
    result = classify_platforms(sample_session_1.commands)
    assert "testing" in result


def test_classify_platforms_empty() -> None:
    assert classify_platforms([]) == {}


# ── workflow ──────────────────────────────────────────────────────────────────

VALID_WORKFLOWS = ("tdd", "test-after", "debug-driven", "refactor", "exploratory", "unknown")


def test_classify_workflow_returns_string(sample_session_1) -> None:
    result = classify_workflow(sample_session_1)
    assert isinstance(result, str)
    assert result in VALID_WORKFLOWS


def test_classify_workflow_session_2(sample_session_2) -> None:
    result = classify_workflow(sample_session_2)
    assert result in VALID_WORKFLOWS


# ── project type ──────────────────────────────────────────────────────────────


def test_classify_blockchain_high_confidence() -> None:
    signals = TechnicalSignals(
        platforms={"blockchain": 3},
        ecosystems={"blockchain": 5},
        languages={"solidity": 5},
    )
    result = classify(signals)
    assert result.category == "web3_blockchain"
    assert result.confidence >= 0.9


def test_classify_mobile() -> None:
    signals = TechnicalSignals(
        platforms={"mobile": 2},
        ecosystems={"flutter": 3},
        languages={"dart": 3},
    )
    result = classify(signals)
    assert result.category == "mobile"
    assert result.confidence >= 0.7


def test_classify_api_backend() -> None:
    signals = TechnicalSignals(
        platforms={"database": 2, "docker": 1},
        ecosystems={"rails": 3},
        languages={"ruby": 5},
    )
    result = classify(signals)
    assert result.category == "api_backend"
    assert result.confidence > 0.0


def test_classify_unknown_no_signals() -> None:
    signals = TechnicalSignals()
    result = classify(signals)
    assert result.category == "unknown"
    assert result.confidence == 0.0


def test_classify_returns_project_classification() -> None:
    from models import ProjectClassification
    signals = TechnicalSignals(ecosystems={"blockchain": 5})
    result = classify(signals)
    assert isinstance(result, ProjectClassification)
    assert isinstance(result.category, str)
    assert isinstance(result.confidence, float)
    assert isinstance(result.signals_used, list)


def test_classify_confidence_below_threshold_returns_unknown() -> None:
    # Only 1 weak signal → confidence = 1/3 ≈ 0.33 < 0.70, falls to AI (which errors) → returns low-conf result
    signals = TechnicalSignals(ecosystems={"rails": 1})
    result = classify(signals)
    # Either api_backend (if heuristic ≥ 0.30) or unknown; confidence < 0.70
    assert result.confidence < 0.70

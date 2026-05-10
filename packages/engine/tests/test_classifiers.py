from __future__ import annotations

from collections import Counter

import pytest

from classifiers.platform import classify_platforms
from classifiers.project_type import classify_project_type
from classifiers.workflow import classify_workflow


# ── platform ──────────────────────────────────────────────────────────────────


def test_classify_platforms_docker(sample_session_2) -> None:
    platforms = classify_platforms(sample_session_2.commands)
    assert "docker" in platforms


def test_classify_platforms_empty_session(sample_session_1) -> None:
    # sess-1 has rspec commands → testing platform
    platforms = classify_platforms(sample_session_1.commands)
    assert "testing" in platforms


# ── workflow ──────────────────────────────────────────────────────────────────


def test_classify_workflow_returns_string(sample_session_1) -> None:
    result = classify_workflow(sample_session_1)
    assert isinstance(result, str)
    assert result in ("tdd", "test_after", "debug_driven", "refactor", "exploratory", "unknown")


def test_classify_workflow_session_1_test_pattern(sample_session_1) -> None:
    # sess-1: has test context + Bash after Write → tdd or test_after
    result = classify_workflow(sample_session_1)
    assert result in ("tdd", "test_after", "debug_driven")


# ── project type ──────────────────────────────────────────────────────────────


def test_classify_project_api_backend() -> None:
    category, confidence = classify_project_type(
        commands=["rails server", "rails db:migrate"],
        ecosystems=["ruby"],
        tools_used=["Bash", "Edit"],
        file_extensions=Counter({".rb": 10}),
    )
    assert category == "api_backend"
    assert confidence > 0.0


def test_classify_project_cli() -> None:
    category, confidence = classify_project_type(
        commands=["./mycli --help", "argparse setup"],
        ecosystems=["python"],
        tools_used=["Bash"],
        file_extensions=Counter({".py": 5, ".sh": 2}),
    )
    assert category == "cli_tool"
    assert confidence > 0.0


def test_classify_project_unknown_no_signals() -> None:
    category, confidence = classify_project_type(
        commands=["echo hello"],
        ecosystems=[],
        tools_used=[],
        file_extensions=Counter(),
    )
    assert category == "unknown"


def test_classify_project_confidence_threshold() -> None:
    # Only 1 weak signal → low confidence → unknown
    category, confidence = classify_project_type(
        commands=["stripe"],
        ecosystems=[],
        tools_used=[],
        file_extensions=Counter(),
    )
    # 1 signal / 3.0 = 0.33, just above threshold
    assert category in ("saas_b2b", "unknown")


def test_classify_project_high_confidence() -> None:
    category, confidence = classify_project_type(
        commands=["hardhat compile", "foundry test", "truffle migrate"],
        ecosystems=["solidity"],
        tools_used=["Bash"],
        file_extensions=Counter({".sol": 5}),
    )
    assert category == "web3_blockchain"
    assert confidence >= 0.9

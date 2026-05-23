"""Shared fixtures: the five canonical payloads from the spec's section 9."""
from __future__ import annotations

import copy

import pytest


PAYLOAD_RICH_RAILS_TO_PYTHON: dict = {
    "schema_version": "1",
    "data_sources": {"l1": True, "l2": True},
    "ecosystems": {
        "dominant": ["rails"],
        "secondary": ["python", "react"],
        "emerging": ["python"],
        "declining": [],
    },
    "test_pattern": {"discipline": "strong", "approach": "tdd_partial"},
    "workflow": {"primary": "test_after", "emerging": "refactor_heavy"},
    "timing": {
        "peak_period": "afternoon",
        "consistency": "very_consistent",
        "session_length": "medium",
    },
    "evolution": {
        "has_evolution": True,
        "timeframe": "couple_years",
        "trajectory": "stack_migration",
    },
    "tooling": {"platforms": ["docker", "github_actions", "postgres", "github"]},
    "sample_size": {"confidence_band": "high"},
}

PAYLOAD_GENERALIST_NODE_PYTHON: dict = {
    "schema_version": "1",
    "data_sources": {"l1": True, "l2": True},
    "ecosystems": {
        "dominant": ["node", "python"],
        "secondary": ["react"],
        "emerging": [],
        "declining": [],
    },
    "test_pattern": {"discipline": "moderate", "approach": "test_after"},
    "workflow": {"primary": "exploratory"},
    "timing": {
        "peak_period": "distributed",
        "consistency": "consistent",
        "session_length": "medium",
    },
    "evolution": {
        "has_evolution": False,
        "timeframe": "year",
        "trajectory": "none",
    },
    "tooling": {"platforms": ["github", "docker"]},
    "sample_size": {"confidence_band": "medium"},
}

PAYLOAD_GO_TO_RUST: dict = {
    "schema_version": "1",
    "data_sources": {"l1": True, "l2": True},
    "ecosystems": {
        "dominant": ["rust"],
        "secondary": ["go"],
        "emerging": ["rust"],
        "declining": ["go"],
    },
    "test_pattern": {"discipline": "strong", "approach": "tdd_dominant"},
    "workflow": {"primary": "tdd"},
    "timing": {
        "peak_period": "distributed",
        "consistency": "consistent",
        "session_length": "long",
    },
    "evolution": {
        "has_evolution": True,
        "timeframe": "months",
        "trajectory": "stack_migration",
    },
    "tooling": {"platforms": ["github", "github_actions"]},
    "ai_usage": {"primary_mode": "code_understanding", "intensity": "moderate"},
    "sample_size": {"confidence_band": "high"},
}

PAYLOAD_FLUTTER_LOW_BAND: dict = {
    "schema_version": "1",
    "data_sources": {"l1": True, "l2": False},
    "ecosystems": {
        "dominant": ["flutter"],
        "secondary": ["dotnet"],
        "emerging": [],
        "declining": [],
    },
    "test_pattern": {"discipline": "moderate", "approach": "test_after"},
    "workflow": {"primary": "exploratory"},
    "timing": {
        "peak_period": "evening",
        "consistency": "consistent",
    },
    "evolution": {
        "has_evolution": False,
        "timeframe": "many_years",
        "trajectory": "none",
    },
    "tooling": {"platforms": ["github", "github_actions"]},
    "sample_size": {"confidence_band": "low"},
}

PAYLOAD_MINIMAL_NODE: dict = {
    "schema_version": "1",
    "data_sources": {"l1": False, "l2": True},
    "ecosystems": {
        "dominant": ["node"],
        "secondary": [],
        "emerging": [],
        "declining": [],
    },
    "test_pattern": {"discipline": "minimal", "approach": "test_seldom"},
    "workflow": {"primary": "exploratory"},
    "timing": {"peak_period": "distributed", "consistency": "sporadic"},
    "evolution": {
        "has_evolution": False,
        "timeframe": "insufficient_history",
        "trajectory": "none",
    },
    "tooling": {"platforms": ["github"]},
    "sample_size": {"confidence_band": "minimal"},
}


@pytest.fixture
def payload_rich() -> dict:
    return copy.deepcopy(PAYLOAD_RICH_RAILS_TO_PYTHON)


@pytest.fixture
def payload_generalist() -> dict:
    return copy.deepcopy(PAYLOAD_GENERALIST_NODE_PYTHON)


@pytest.fixture
def payload_go_to_rust() -> dict:
    return copy.deepcopy(PAYLOAD_GO_TO_RUST)


@pytest.fixture
def payload_flutter_low() -> dict:
    return copy.deepcopy(PAYLOAD_FLUTTER_LOW_BAND)


@pytest.fixture
def payload_minimal() -> dict:
    return copy.deepcopy(PAYLOAD_MINIMAL_NODE)

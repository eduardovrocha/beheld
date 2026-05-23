"""JSON Schema v1 for the identity signals payload.

The schema is the contract between the classifier (which produces signals
from SQLite) and the identity generator (LLM + fallback). All string fields
use closed enums — text livre nunca atravessa essa fronteira.
"""
from __future__ import annotations

ECOSYSTEMS = [
    "rails", "node", "react", "vue", "next",
    "python", "django", "fastapi",
    "flutter", "go", "rust",
    "java_spring", "kotlin", "swift_ios",
    "dotnet", "elixir_phoenix", "php_laravel",
    "ruby_other", "devops",
]

PLATFORMS = [
    "docker", "kubernetes",
    "github", "github_actions", "gitlab", "gitlab_ci", "circleci",
    "aws", "gcp", "azure", "vercel", "cloudflare",
    "postgres", "mysql", "redis", "mongodb", "elasticsearch",
    "terraform", "ansible", "blockchain",
]

WORKFLOW_PATTERNS = [
    "tdd", "test_after", "debug_driven", "refactor_heavy",
    "exploratory", "review_before_commit",
]

SIGNALS_SCHEMA_V1: dict = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://beheld.dev/schemas/identity-signals.v1.json",
    "title": "Identity Signals Payload",
    "type": "object",
    "additionalProperties": False,
    "required": [
        "schema_version", "data_sources", "ecosystems", "test_pattern",
        "workflow", "timing", "evolution", "tooling", "sample_size",
    ],
    "properties": {
        "schema_version": {"const": "1"},
        "data_sources": {
            "type": "object",
            "additionalProperties": False,
            "required": ["l1", "l2"],
            "properties": {
                "l1": {"type": "boolean"},
                "l2": {"type": "boolean"},
            },
        },
        "ecosystems": {
            "type": "object",
            "additionalProperties": False,
            "required": ["dominant", "secondary", "emerging", "declining"],
            "properties": {
                "dominant":  {"type": "array", "maxItems": 2, "items": {"$ref": "#/$defs/ecosystem"}},
                "secondary": {"type": "array", "maxItems": 3, "items": {"$ref": "#/$defs/ecosystem"}},
                "emerging":  {"type": "array", "maxItems": 2, "items": {"$ref": "#/$defs/ecosystem"}},
                "declining": {"type": "array", "maxItems": 2, "items": {"$ref": "#/$defs/ecosystem"}},
            },
        },
        "test_pattern": {
            "type": "object",
            "additionalProperties": False,
            "required": ["discipline", "approach"],
            "properties": {
                "discipline": {"enum": ["strong", "moderate", "low", "minimal"]},
                "approach": {"enum": ["tdd_dominant", "tdd_partial", "test_after", "test_seldom", "exploratory"]},
            },
        },
        "workflow": {
            "type": "object",
            "additionalProperties": False,
            "required": ["primary"],
            "properties": {
                "primary":  {"enum": WORKFLOW_PATTERNS},
                "emerging": {"enum": WORKFLOW_PATTERNS},
            },
        },
        "timing": {
            "type": "object",
            "additionalProperties": False,
            "required": ["peak_period", "consistency"],
            "properties": {
                "peak_period": {"enum": ["morning", "afternoon", "evening", "late_night", "distributed"]},
                "consistency": {"enum": ["very_consistent", "consistent", "irregular", "sporadic"]},
                "session_length": {"enum": ["short", "medium", "long", "marathon"]},
            },
        },
        "evolution": {
            "type": "object",
            "additionalProperties": False,
            "required": ["has_evolution", "timeframe"],
            "properties": {
                "has_evolution": {"type": "boolean"},
                "timeframe": {"enum": ["months", "year", "couple_years", "many_years", "insufficient_history"]},
                "trajectory": {"enum": [
                    "stack_migration", "test_maturity_growth", "workflow_shift",
                    "scope_broadening", "scope_deepening", "none",
                ]},
            },
        },
        "tooling": {
            "type": "object",
            "additionalProperties": False,
            "required": ["platforms"],
            "properties": {
                "platforms": {"type": "array", "maxItems": 5, "items": {"$ref": "#/$defs/platform"}},
            },
        },
        "ai_usage": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "primary_mode": {"enum": [
                    "code_generation", "code_understanding", "debugging",
                    "refactoring", "exploration",
                ]},
                "intensity": {"enum": ["heavy", "moderate", "light"]},
            },
        },
        "sample_size": {
            "type": "object",
            "additionalProperties": False,
            "required": ["confidence_band"],
            "properties": {
                "confidence_band": {"enum": ["high", "medium", "low", "minimal"]},
            },
        },
    },
    "$defs": {
        "ecosystem": {"enum": ECOSYSTEMS},
        "platform": {"enum": PLATFORMS},
    },
}

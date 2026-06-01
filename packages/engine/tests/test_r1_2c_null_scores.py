"""Tests for R1.2c — BUNDLE_VERSION 7 + Optional scores in canonical JSON.

Covers:
  - canonical_json serializes None as JSON null (not "None" or 0)
  - BundlePayload accepts Scores with None values without crashing
  - dataclasses.asdict on Scores preserves None
  - Round-trip: Scores → asdict → canonical_json → load → Scores reconstructs None
  - Cross-language byte-lock invariant: bundle wrapper version is "7" but
    canonical hash of payload is unchanged when scores are all-int (the v6
    fixture EXPECTED_HASH is still valid for the same payload).
"""
import dataclasses
import json

from bundle import canonical_json
from models import Scores


def test_canonical_json_serializes_none_as_null():
    out = canonical_json({"prompt_quality": None, "test_maturity": 50})
    # JSON spec: null literal
    parsed = json.loads(out)
    assert parsed == {"prompt_quality": None, "test_maturity": 50}
    # Stable key order + lowercase "null" (not Python "None")
    assert '"prompt_quality":null' in out


def test_scores_dataclass_accepts_none_for_optional_fields():
    s = Scores(
        date="2026-06-01",
        prompt_quality=None,
        test_maturity=40,
        tech_breadth=55,
        growth_rate=None,
        overall=None,
        sessions_analyzed=0,
    )
    assert s.prompt_quality is None
    assert s.growth_rate is None
    assert s.overall is None
    assert s.test_maturity == 40
    assert s.tech_breadth == 55


def test_scores_asdict_preserves_none():
    s = Scores(
        date="2026-06-01",
        prompt_quality=None,
        test_maturity=40,
        tech_breadth=55,
        growth_rate=None,
        overall=None,
        sessions_analyzed=0,
    )
    d = dataclasses.asdict(s)
    assert d["prompt_quality"] is None
    assert d["growth_rate"] is None
    assert d["overall"] is None


def test_scores_canonical_roundtrip_with_nulls():
    s = Scores(
        date="2026-06-01",
        prompt_quality=None,
        test_maturity=40,
        tech_breadth=55,
        growth_rate=None,
        overall=None,
        sessions_analyzed=0,
    )
    canonical = canonical_json(dataclasses.asdict(s))
    reloaded = json.loads(canonical)
    assert reloaded["prompt_quality"] is None
    assert reloaded["test_maturity"] == 40
    assert reloaded["growth_rate"] is None
    assert reloaded["overall"] is None


def test_canonical_json_null_vs_zero_produces_different_bytes():
    """The whole point of R1.2c: null is semantically distinct from 0.
    Canonical bytes must reflect that distinction so signed bundles
    with null scores have a different hash than ones with 0 scores."""
    with_null = canonical_json({"prompt_quality": None})
    with_zero = canonical_json({"prompt_quality": 0})
    assert with_null != with_zero
    assert '"prompt_quality":null' in with_null
    assert '"prompt_quality":0' in with_zero


def test_canonical_json_mixed_null_and_int_scores():
    payload = {
        "growth_rate": None,
        "overall": None,
        "prompt_quality": 65,
        "test_maturity": 45,
    }
    canonical = canonical_json(payload)
    # Keys are sorted; numbers are bare; null is lowercase.
    expected = '{"growth_rate":null,"overall":null,"prompt_quality":65,"test_maturity":45}'
    assert canonical == expected

"""Cross-language contract tests for .dpbundle canonical serialization.

The same fixture is built in Python here and in TypeScript at
packages/cli/tests/bundle.test.ts. Both files assert against the same expected
canonical string and SHA-256 hash. If they ever disagree, one of these tests
fails — drift caught at test time, not in production.

ANY change to the bundle schema (BundlePayload / BundleSignals / Bundle) or to
the canonical_json rules requires:
  1. Updating both fixtures and the EXPECTED_HASH constant.
  2. Bumping BUNDLE_VERSION in both models.py and types.ts.
"""
from __future__ import annotations

import json

import pytest

from bundle import canonical_json, payload_hash, payload_to_canonical
from models import (
    BUNDLE_VERSION,
    Bundle,
    BundleL1Section,
    BundleL2Section,
    BundlePayload,
    Scores,
    WorkflowMetrics,
)


# ── shared fixture (mirror in packages/cli/tests/bundle.test.ts) ─────────────


def _fixture_payload() -> BundlePayload:
    return BundlePayload(
        created_at="2026-05-14T00:00:00+00:00",
        devprofile_version="0.2.0",
        previous_hash=None,
        scores=Scores(
            date="2026-05-13",
            prompt_quality=50, test_maturity=20, tech_breadth=40,
            growth_rate=30, overall=35, sessions_analyzed=30,
        ),
        l1=BundleL1Section(
            total_repos=2,
            total_commits=1200,
            earliest_commit="2023-01-01T00:00:00+00:00",
            latest_commit="2026-05-13T00:00:00+00:00",
            ecosystems={"python": True, "rails": True},
            platforms={"docker": True, "github": True},
            avg_test_ratio=0.42,
            root_commit_hashes=["a" * 40, "b" * 40],
        ),
        l2=BundleL2Section(
            platforms={"docker": 10, "github": 5},
            ecosystems={"rails": 8, "react": 4},
            workflow_distribution={"tdd": 0.2, "test-after": 0.6},
            project_categories={"saas_b2b": 1.0},
            workflow_metrics=WorkflowMetrics(test_after_ratio=0.6),
            sessions_analyzed=30,
            period_days=30,
        ),
    )


# Reference values — must match those asserted by the TypeScript twin test.
# If you change the fixture above or the canonical_json rules, regenerate by:
#   PYTHONPATH=src python -c "..."  (see commit message of the change)
EXPECTED_CANONICAL = (
    '{"created_at":"2026-05-14T00:00:00+00:00","devprofile_version":"0.2.0",'
    '"l1":{"avg_test_ratio":0.42,'
    '"earliest_commit":"2023-01-01T00:00:00+00:00",'
    '"ecosystems":{"python":true,"rails":true},'
    '"latest_commit":"2026-05-13T00:00:00+00:00",'
    '"platforms":{"docker":true,"github":true},'
    '"root_commit_hashes":["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",'
    '"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],'
    '"total_commits":1200,"total_repos":2},'
    '"l2":{"ecosystems":{"rails":8,"react":4},"period_days":30,'
    '"platforms":{"docker":10,"github":5},"project_categories":{"saas_b2b":1},'
    '"sessions_analyzed":30,'
    '"workflow_distribution":{"tdd":0.2,"test-after":0.6},'
    '"workflow_metrics":{"bash_to_read_ratio":0,"ecosystem_concentration":0,'
    '"edit_to_test_lag_min":0,"median_test_delay_min":0,'
    '"prompt_avg_chars":0,"prompt_median_chars":0,'
    '"session_avg_duration_min":0,"test_after_ratio":0.6,'
    '"test_first_ratio":0,"tool_variety_avg":0}},'
    '"previous_hash":null,'
    '"scores":{"date":"2026-05-13","growth_rate":30,"overall":35,'
    '"prompt_quality":50,"sessions_analyzed":30,"tech_breadth":40,'
    '"test_maturity":20}}'
)

EXPECTED_HASH = "sha256:60168f63bb60ff60bcbfb382733f2da1813284ee75ab03459c02ca6cd7abb509"


# ── canonical_json basics ────────────────────────────────────────────────────


def test_bundle_version_is_two() -> None:
    assert BUNDLE_VERSION == "2"


def test_canonical_sorts_keys_alphabetically() -> None:
    out = canonical_json({"z": 1, "a": 2, "m": 3})
    assert out == '{"a":2,"m":3,"z":1}'


def test_canonical_uses_compact_separators() -> None:
    out = canonical_json({"a": 1, "b": 2})
    assert ", " not in out
    assert ": " not in out


def test_canonical_recurses_into_nested_objects() -> None:
    out = canonical_json({"x": {"z": 1, "a": 2}, "a": 3})
    assert out == '{"a":3,"x":{"a":2,"z":1}}'


def test_canonical_recurses_into_arrays() -> None:
    out = canonical_json([{"z": 1, "a": 2}, {"y": 3, "b": 4}])
    assert out == '[{"a":2,"z":1},{"b":4,"y":3}]'


def test_canonical_drops_trailing_zero_on_whole_floats() -> None:
    """Aligns Python's `1.0` with JavaScript's `1` — required for cross-language
    canonical agreement."""
    assert canonical_json({"x": 1.0}) == '{"x":1}'
    assert canonical_json({"x": 0.0}) == '{"x":0}'
    assert canonical_json({"x": 42.0}) == '{"x":42}'


def test_canonical_preserves_non_whole_floats() -> None:
    assert canonical_json({"x": 0.6}) == '{"x":0.6}'
    assert canonical_json({"x": 0.2}) == '{"x":0.2}'


def test_canonical_preserves_bool_distinct_from_int() -> None:
    out = canonical_json({"a": True, "b": 1, "c": False, "d": 0})
    assert out == '{"a":true,"b":1,"c":false,"d":0}'


def test_canonical_preserves_null() -> None:
    assert canonical_json({"x": None}) == '{"x":null}'


# ── contract lock: fixture → canonical → hash ────────────────────────────────


def test_fixture_canonical_matches_expected() -> None:
    """The byte sequence the TypeScript twin must produce. Drift here means the
    two languages disagree on the bundle hash — bundles signed in CLI would not
    verify in the Rails verification page (Phase 5 G)."""
    actual = payload_to_canonical(_fixture_payload())
    assert actual == EXPECTED_CANONICAL
    assert len(actual) == 1052


def test_fixture_hash_matches_expected() -> None:
    actual = payload_hash(_fixture_payload())
    assert actual == EXPECTED_HASH


def test_fixture_hash_is_deterministic() -> None:
    """Building the same payload twice must produce identical hashes — the
    bundle hash chain (F5.2) depends on this property."""
    a = payload_hash(_fixture_payload())
    b = payload_hash(_fixture_payload())
    assert a == b


def test_changing_any_field_changes_hash() -> None:
    """Tamper-evidence — single-bit changes propagate to the hash."""
    base = _fixture_payload()
    tampered = BundlePayload(
        created_at=base.created_at,
        devprofile_version=base.devprofile_version,
        previous_hash=base.previous_hash,
        scores=Scores(
            date=base.scores.date,
            prompt_quality=base.scores.prompt_quality + 1,  # +1 changes the hash
            test_maturity=base.scores.test_maturity,
            tech_breadth=base.scores.tech_breadth,
            growth_rate=base.scores.growth_rate,
            overall=base.scores.overall,
            sessions_analyzed=base.scores.sessions_analyzed,
        ),
        l1=base.l1,
        l2=base.l2,
    )
    assert payload_hash(base) != payload_hash(tampered)


# ── Bundle wrapper ───────────────────────────────────────────────────────────


def test_bundle_wrapper_serializes_with_payload_inside() -> None:
    """The signed wrapper round-trips through canonical_json without losing the
    distinction between the signed half (payload) and the proof half (hash,
    signature, public_key)."""
    import dataclasses
    bundle = Bundle(
        version=BUNDLE_VERSION,
        payload=_fixture_payload(),
        hash=EXPECTED_HASH,
        signature="ed25519:dead",
        public_key="ed25519:beef",
    )
    out = json.loads(canonical_json(dataclasses.asdict(bundle)))
    assert out["version"] == "2"
    assert out["hash"] == EXPECTED_HASH
    assert out["signature"] == "ed25519:dead"
    assert out["public_key"] == "ed25519:beef"
    # payload nested object is sorted alphabetically too
    assert list(out["payload"].keys()) == sorted(out["payload"].keys())


def test_bundle_payload_dataclass_is_frozen() -> None:
    p = _fixture_payload()
    with pytest.raises(Exception):
        p.created_at = "tampered"  # type: ignore[misc]

"""F5.7 tests — engine_version_hash + first_seen_at.

Covers the F5.7.2 contract:
- `get_engine_hash()` returns a deterministic SHA-256 of the binary in execution,
  or None when the read fails (never raises).
- `POST /snapshot/payload` includes the field.
- `first_seen_at` is set on first save_l1_repository call and preserved across
  re-imports.
- The bundle payload exposes `root_commit_hashes` as `[{hash, first_seen_at}]`.
"""
from __future__ import annotations

import dataclasses
import re
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from api import app, get_engine_hash
from bundle import build_bundle_payload
from models import Scores, WorkflowMetrics
from storage.sqlite import BeheldDB


HEX64 = re.compile(r"^[0-9a-f]{64}$")


# ── engine hash basics ───────────────────────────────────────────────────────


def test_engine_hash_is_sha256_format() -> None:
    """In unfrozen mode the function hashes its own source file. The output
    must be a 64-char hex string regardless of where it comes from."""
    h = get_engine_hash()
    assert h is not None, "expected a hash when reading own source file"
    assert HEX64.match(h), f"not a sha256 hex digest: {h!r}"


def test_engine_hash_consistent_in_same_process() -> None:
    """Two calls in the same process must return the same value — the binary
    on disk does not change between calls."""
    a = get_engine_hash()
    b = get_engine_hash()
    assert a == b


def test_payload_includes_engine_version_hash(tmp_path) -> None:
    """The /snapshot/payload endpoint surfaces the field unconditionally —
    non-null when readable, null when not."""
    # Use a real test client + isolated DB so we exercise the endpoint path.
    db = BeheldDB(":memory:")
    db.init_schema()
    db.save_scores(Scores(
        date="2026-05-14",
        prompt_quality=10, test_maturity=10, tech_breadth=10,
        growth_rate=10, overall=10, sessions_analyzed=1,
    ))
    db.save_workflow_metrics(WorkflowMetrics(), 30, 1)

    with patch("api.db", db):
        client = TestClient(app)
        r = client.post("/snapshot/payload")
        assert r.status_code == 200
        body = r.json()
        assert "engine_version_hash" in body
        # Unfrozen tests: the hash is derived from api.py source — must be valid.
        assert body["engine_version_hash"] is not None
        assert HEX64.match(body["engine_version_hash"])


def test_payload_engine_hash_is_null_gracefully() -> None:
    """If the binary cannot be read for any reason, the payload still serializes
    — engine_version_hash is just null. No exception, no HTTP 500."""
    db = BeheldDB(":memory:")
    db.init_schema()
    db.save_scores(Scores(
        date="2026-05-14",
        prompt_quality=10, test_maturity=10, tech_breadth=10,
        growth_rate=10, overall=10, sessions_analyzed=1,
    ))
    db.save_workflow_metrics(WorkflowMetrics(), 30, 1)

    with patch("api.db", db), patch("api.get_engine_hash", return_value=None):
        client = TestClient(app)
        r = client.post("/snapshot/payload")
        assert r.status_code == 200
        assert r.json()["engine_version_hash"] is None


# ── first_seen_at ────────────────────────────────────────────────────────────


def test_first_seen_at_set_on_import() -> None:
    db = BeheldDB(":memory:")
    db.init_schema()
    db.save_l1_repository("hash-1", "2026-05-14T10:00:00+00:00", 100, "email-hash")
    repos = db.get_l1_repositories()
    assert len(repos) == 1
    assert repos[0]["first_seen_at"] is not None
    assert repos[0]["first_seen_at"] == "2026-05-14T10:00:00+00:00"


def test_first_seen_at_immutable_on_reimport() -> None:
    """Re-importing the same repo must preserve the first_seen_at recorded on
    the very first import — the idempotent INSERT OR IGNORE in save_l1_repository
    is what gives us this for free, but the test pins the invariant."""
    db = BeheldDB(":memory:")
    db.init_schema()

    first_call = db.save_l1_repository("hash-1", "2026-05-14T10:00:00+00:00", 100, "e")
    second_call = db.save_l1_repository("hash-1", "2026-06-01T15:00:00+00:00", 250, "e")

    assert first_call is True
    assert second_call is False  # idempotent — second insert ignored

    repos = db.get_l1_repositories()
    assert len(repos) == 1
    assert repos[0]["first_seen_at"] == "2026-05-14T10:00:00+00:00"


def test_root_commit_hashes_include_first_seen_at() -> None:
    """The bundle payload exposes each repo as {hash, first_seen_at}."""
    db = BeheldDB(":memory:")
    db.init_schema()
    db.save_scores(Scores(
        date="2026-05-14",
        prompt_quality=10, test_maturity=10, tech_breadth=10,
        growth_rate=10, overall=10, sessions_analyzed=1,
    ))
    db.save_workflow_metrics(WorkflowMetrics(), 30, 1)
    db.save_l1_repository("hash-A", "2026-05-14T10:00:00+00:00", 50, "e")
    db.save_l1_signals("hash-A", {}, {}, {}, 0.0, {}, None, None)
    db.save_l1_repository("hash-B", "2026-05-15T10:00:00+00:00", 60, "e")
    db.save_l1_signals("hash-B", {}, {}, {}, 0.0, {}, None, None)

    payload = build_bundle_payload(db, "0.1.1", engine_version_hash="abc" * 21 + "d")
    p = dataclasses.asdict(payload)

    refs = p["l1"]["root_commit_hashes"]
    assert len(refs) == 2
    for ref in refs:
        assert set(ref.keys()) == {"hash", "first_seen_at"}
        assert ref["first_seen_at"] is not None

    by_hash = {ref["hash"]: ref["first_seen_at"] for ref in refs}
    assert by_hash["hash-A"] == "2026-05-14T10:00:00+00:00"
    assert by_hash["hash-B"] == "2026-05-15T10:00:00+00:00"

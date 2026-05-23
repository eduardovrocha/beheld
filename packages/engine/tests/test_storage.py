from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from models import Scores, Signal, WorkflowMetrics
from storage.sqlite import BeheldDB, LATEST_SCHEMA_VERSION, MIGRATIONS


@pytest.fixture
def db(db_path: Path) -> BeheldDB:
    instance = BeheldDB(db_path)
    instance.init_schema()
    yield instance
    instance.close()


def test_init_schema_creates_tables(db: BeheldDB) -> None:
    conn = db.connect()
    tables = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert {
        "sessions",
        "technical_signals",
        "scores",
        "profile",
        "workflow_metrics",
        "schema_version",
        "snapshots",
    } <= tables


def test_save_and_get_session(db: BeheldDB, sample_session_1) -> None:
    db.save_session(sample_session_1)
    assert db.count_sessions() == 1
    ids = db.get_existing_session_ids()
    assert "sess-1" in ids


def test_save_session_idempotent(db: BeheldDB, sample_session_1) -> None:
    db.save_session(sample_session_1)
    db.save_session(sample_session_1)  # second save accumulates, does not duplicate row
    assert db.count_sessions() == 1


def test_get_existing_session_ids(db: BeheldDB, sample_session_1, sample_session_2) -> None:
    db.save_session(sample_session_1)
    db.save_session(sample_session_2)
    ids = db.get_existing_session_ids()
    assert ids == {"sess-1", "sess-2"}


def test_get_all_sessions_as_objects(db: BeheldDB, sample_session_1, sample_session_2) -> None:
    db.save_session(sample_session_1)
    db.save_session(sample_session_2)
    sessions = db.get_all_sessions_as_objects()
    assert len(sessions) == 2
    assert {s.session_id for s in sessions} == {"sess-1", "sess-2"}


def test_reconstructed_session_has_no_events(db: BeheldDB, sample_session_1) -> None:
    db.save_session(sample_session_1)
    sessions = db.get_all_sessions_as_objects()
    assert sessions[0].events == []


def test_reconstructed_session_tools(db: BeheldDB, sample_session_1) -> None:
    db.save_session(sample_session_1)
    sessions = db.get_all_sessions_as_objects()
    assert "Bash" in sessions[0].tools_used


def test_save_signals(db: BeheldDB, sample_session_1) -> None:
    db.save_session(sample_session_1)
    db.save_signals(sample_session_1.session_id, [
        Signal("platform", "docker", 3),
        Signal("ecosystem", "python", 5),
    ])
    signals = db.get_all_signals()
    assert len(signals) == 2
    types = {s["signal_type"] for s in signals}
    assert types == {"platform", "ecosystem"}


def test_save_signals_replaces_existing(db: BeheldDB, sample_session_1) -> None:
    db.save_session(sample_session_1)
    db.save_signals(sample_session_1.session_id, [Signal("platform", "docker", 1)])
    db.save_signals(sample_session_1.session_id, [Signal("platform", "github", 2)])
    signals = db.get_all_signals()
    assert len(signals) == 1
    assert signals[0]["signal_value"] == "github"


def test_save_and_get_scores(db: BeheldDB) -> None:
    scores = Scores(
        date="2026-05-10",
        prompt_quality=75,
        test_maturity=60,
        tech_breadth=80,
        growth_rate=55,
        overall=67,
        sessions_analyzed=10,
    )
    db.save_scores(scores)
    result = db.get_current_scores()
    assert result is not None
    assert result.prompt_quality == 75
    assert result.overall == 67


def test_get_scores_history(db: BeheldDB) -> None:
    for date, pq in [("2026-05-08", 70), ("2026-05-09", 72), ("2026-05-10", 74)]:
        db.save_scores(Scores(date=date, prompt_quality=pq, test_maturity=55,
                              tech_breadth=75, growth_rate=50, overall=62, sessions_analyzed=8))
    history = db.get_scores_history(30)
    assert len(history) == 3
    assert history[0].date == "2026-05-10"  # most recent first


def test_get_scores_returns_scores_object(db: BeheldDB) -> None:
    db.save_scores(Scores("2026-05-10", 70, 60, 80, 55, 66, 5))
    result = db.get_scores("2026-05-10")
    assert isinstance(result, Scores)
    assert result.date == "2026-05-10"


def test_count_sessions(db: BeheldDB, sample_session_1, sample_session_2) -> None:
    db.save_session(sample_session_1)
    db.save_session(sample_session_2)
    assert db.count_sessions() == 2


def test_count_sessions_on_date(db: BeheldDB, sample_session_1, sample_session_2) -> None:
    db.save_session(sample_session_1)
    db.save_session(sample_session_2)
    # Both sessions are on 2026-05-10
    assert db.count_sessions_on_date("2026-05-10") == 2
    assert db.count_sessions_on_date("2026-05-09") == 0


def test_profile_key_value(db: BeheldDB) -> None:
    db.set_profile("test_key", "test_value")
    assert db.get_profile("test_key") == "test_value"


def test_profile_update_replaces(db: BeheldDB) -> None:
    db.set_profile("key", "v1")
    db.set_profile("key", "v2")
    assert db.get_profile("key") == "v2"


def test_get_profile_missing_key(db: BeheldDB) -> None:
    assert db.get_profile("missing") is None


def test_save_session_accumulates_event_count(db: BeheldDB, sample_session_1, sample_session_2) -> None:
    import copy
    first = copy.copy(sample_session_1)
    first.event_count = 10
    second = copy.copy(sample_session_1)
    second.event_count = 5
    db.save_session(first)
    db.save_session(second)
    sessions = db.get_all_sessions_as_objects()
    assert sessions[0].event_count == 15


def test_save_session_merges_tools(db: BeheldDB, sample_session_1, sample_session_2) -> None:
    import copy
    first = copy.copy(sample_session_1)
    first.tools_used = ["Bash", "Read"]
    second = copy.copy(sample_session_1)
    second.tools_used = ["Edit", "Read"]
    db.save_session(first)
    db.save_session(second)
    sessions = db.get_all_sessions_as_objects()
    assert set(sessions[0].tools_used) == {"Bash", "Read", "Edit"}


def test_save_session_appends_tool_sequence(db: BeheldDB, sample_session_1) -> None:
    import copy
    first = copy.copy(sample_session_1)
    first.tool_sequence = ["Bash", "Read"]
    second = copy.copy(sample_session_1)
    second.tool_sequence = ["Edit", "Bash"]
    db.save_session(first)
    db.save_session(second)
    seq = db.get_session_tool_sequence("sess-1")
    assert seq == ["Bash", "Read", "Edit", "Bash"]


def test_save_session_caps_tool_sequence_length(db: BeheldDB, sample_session_1) -> None:
    """Regression: a long-running session must not let tool_sequence_json grow
    unbounded.  Before the cap, a real-world profile ballooned to 2 GB and
    OOM'd /snapshot/payload.  After the fix, the column stays bounded by
    MAX_TOOL_SEQUENCE_LEN regardless of how many save_session calls happen."""
    import copy
    from storage.sqlite import MAX_TOOL_SEQUENCE_LEN

    # First write seeds the row.
    seed = copy.copy(sample_session_1)
    seed.tool_sequence = ["init"]
    db.save_session(seed)

    # Append 3 × MAX events in chunks to simulate a long-lived session.
    for batch_idx in range(30):
        update = copy.copy(sample_session_1)
        update.tool_sequence = [f"b{batch_idx}-t{i}" for i in range(MAX_TOOL_SEQUENCE_LEN // 10)]
        db.save_session(update)

    seq = db.get_session_tool_sequence("sess-1")
    assert len(seq) == MAX_TOOL_SEQUENCE_LEN
    # The cap keeps the most recent tail — last item must be the newest batch.
    assert seq[-1].startswith("b29-")


def test_migration_5_truncates_existing_oversized_rows(db_path) -> None:
    """A DB with a pre-existing bloated tool_sequence_json must auto-heal
    on init_schema — the user shouldn't have to know about the bug."""
    import json
    import sqlite3
    from storage.sqlite import MAX_TOOL_SEQUENCE_LEN

    # Build a v0 DB (no schema_version yet) with a humongous row.
    raw = sqlite3.connect(str(db_path))
    raw.executescript(
        """
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            started_at TEXT NOT NULL,
            tool_sequence_json TEXT DEFAULT '[]',
            processed_at TEXT NOT NULL
        );
        """
    )
    bloated = json.dumps([f"event-{i}" for i in range(MAX_TOOL_SEQUENCE_LEN * 5)])
    raw.execute(
        "INSERT INTO sessions (id, source, started_at, tool_sequence_json, processed_at) VALUES (?, ?, ?, ?, ?)",
        ("bloated", "claude-code", "2026-05-14T00:00:00+00:00", bloated, "2026-05-14T00:00:00+00:00"),
    )
    raw.commit()
    raw.close()

    db = BeheldDB(db_path)
    db.init_schema()
    try:
        row = db.connect().execute(
            "SELECT tool_sequence_json FROM sessions WHERE id = ?", ("bloated",)
        ).fetchone()
        seq = json.loads(row["tool_sequence_json"])
        assert len(seq) == MAX_TOOL_SEQUENCE_LEN
        # Tail-preserving: the newest events survive.
        assert seq[-1] == f"event-{MAX_TOOL_SEQUENCE_LEN * 5 - 1}"
    finally:
        db.close()


def test_get_session_tool_sequence_missing(db: BeheldDB) -> None:
    assert db.get_session_tool_sequence("nonexistent") == []


def test_get_all_profile(db: BeheldDB) -> None:
    db.set_profile("k1", "v1")
    db.set_profile("k2", "v2")
    profile = db.get_all_profile()
    assert profile == {"k1": "v1", "k2": "v2"}


def test_get_current_scores_empty(db: BeheldDB) -> None:
    assert db.get_current_scores() is None


def test_in_memory_db() -> None:
    mem_db = BeheldDB(":memory:")
    mem_db.init_schema()
    mem_db.set_profile("x", "y")
    assert mem_db.get_profile("x") == "y"
    mem_db.close()


# ── schema versioning ─────────────────────────────────────────────────────────


def test_schema_version_table_exists(db: BeheldDB) -> None:
    conn = db.connect()
    tables = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert "schema_version" in tables


def test_fresh_db_at_latest_version(db: BeheldDB) -> None:
    assert db.current_schema_version() == LATEST_SCHEMA_VERSION


def test_migrations_recorded_in_history(db: BeheldDB) -> None:
    conn = db.connect()
    rows = conn.execute(
        "SELECT version, description, applied_at FROM schema_version ORDER BY version"
    ).fetchall()
    versions = [r["version"] for r in rows]
    assert versions == [m.version for m in MIGRATIONS]
    for row in rows:
        assert row["description"]
        assert row["applied_at"]


def test_reinit_is_idempotent(db_path: Path) -> None:
    first = BeheldDB(db_path)
    first.init_schema()
    first.close()

    second = BeheldDB(db_path)
    second.init_schema()
    rows = second.connect().execute("SELECT COUNT(*) AS n FROM schema_version").fetchone()
    assert rows["n"] == LATEST_SCHEMA_VERSION
    second.close()


def test_pre_versioning_db_migrates_to_latest(db_path: Path) -> None:
    """Simulate a DB created before schema_version existed: sessions table
    without tool_sequence_json and no schema_version table at all."""
    conn = sqlite3.connect(str(db_path))
    conn.executescript(
        """
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            started_at TEXT NOT NULL,
            processed_at TEXT NOT NULL
        );
        """
    )
    conn.commit()
    conn.close()

    db = BeheldDB(db_path)
    db.init_schema()
    try:
        cols = {row[1] for row in db.connect().execute("PRAGMA table_info(sessions)").fetchall()}
        assert "tool_sequence_json" in cols
        assert db.current_schema_version() == LATEST_SCHEMA_VERSION
    finally:
        db.close()


# ── workflow_metrics ──────────────────────────────────────────────────────────


def test_workflow_metrics_table_exists(db: BeheldDB) -> None:
    conn = db.connect()
    tables = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert "workflow_metrics" in tables


def test_save_and_get_latest_workflow_metrics(db: BeheldDB) -> None:
    m = WorkflowMetrics(test_after_ratio=0.78, bash_to_read_ratio=7.8)
    db.save_workflow_metrics(m, period_days=30, sessions_analyzed=42)
    latest = db.get_latest_workflow_metrics()
    assert latest is not None
    assert latest["period_days"] == 30
    assert latest["sessions_analyzed"] == 42
    assert latest["metrics"] == m
    assert latest["computed_at"]  # ISO timestamp


def test_get_latest_workflow_metrics_returns_none_when_empty(db: BeheldDB) -> None:
    assert db.get_latest_workflow_metrics() is None


def test_workflow_metrics_is_append_only(db: BeheldDB) -> None:
    db.save_workflow_metrics(WorkflowMetrics(test_after_ratio=0.5), 30, 10)
    db.save_workflow_metrics(WorkflowMetrics(test_after_ratio=0.7), 30, 12)
    db.save_workflow_metrics(WorkflowMetrics(test_after_ratio=0.9), 30, 15)
    assert db.count_workflow_metrics() == 3
    latest = db.get_latest_workflow_metrics()
    assert latest["metrics"].test_after_ratio == 0.9
    assert latest["sessions_analyzed"] == 15


def test_workflow_metrics_persists_canonical_json(db: BeheldDB) -> None:
    """The stored metrics_json should be canonical (sort_keys, compact) so the
    bundle hash (F5.3.3) is reproducible without re-serializing."""
    m = WorkflowMetrics(test_after_ratio=0.5, bash_to_read_ratio=2.0)
    db.save_workflow_metrics(m, period_days=30, sessions_analyzed=10)
    row = db.connect().execute(
        "SELECT metrics_json FROM workflow_metrics ORDER BY id DESC LIMIT 1"
    ).fetchone()
    raw = row["metrics_json"]
    # Compact format: no spaces between separators
    assert ", " not in raw
    assert ": " not in raw
    # Keys are alphabetically ordered
    import json
    parsed = json.loads(raw)
    keys = list(parsed.keys())
    assert keys == sorted(keys)


def test_pre_v2_db_gains_workflow_metrics_table(db_path: Path) -> None:
    """An older DB at v1 should pick up the workflow_metrics table on init."""
    pre_v2 = BeheldDB(db_path)
    # Simulate v1 state: only first migration ran
    pre_v2.connect().executescript(
        """
        CREATE TABLE schema_version (
            version INTEGER PRIMARY KEY,
            description TEXT NOT NULL,
            applied_at TEXT NOT NULL
        );
        INSERT INTO schema_version (version, description, applied_at)
        VALUES (1, 'add tool_sequence_json to sessions', '2026-05-13T00:00:00+00:00');
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            started_at TEXT NOT NULL,
            tool_sequence_json TEXT DEFAULT '[]',
            processed_at TEXT NOT NULL
        );
        """
    )
    pre_v2.connect().commit()
    pre_v2.close()

    db = BeheldDB(db_path)
    db.init_schema()
    try:
        assert db.current_schema_version() == LATEST_SCHEMA_VERSION
        tables = {
            row[0]
            for row in db.connect()
            .execute("SELECT name FROM sqlite_master WHERE type='table'")
            .fetchall()
        }
        assert "workflow_metrics" in tables
    finally:
        db.close()


# ── snapshots (chain) ─────────────────────────────────────────────────────────


import hashlib


def _hash_of(payload: str) -> str:
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def test_snapshots_table_exists(db: BeheldDB) -> None:
    conn = db.connect()
    tables = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert "snapshots" in tables


def test_save_and_get_latest_snapshot(db: BeheldDB) -> None:
    payload = '{"k":"v"}'
    h = _hash_of(payload)
    db.save_snapshot(h, previous_hash=None, payload_json=payload, bundle_path="/tmp/a.beheld")
    latest = db.get_latest_snapshot()
    assert latest is not None
    assert latest["hash"] == h
    assert latest["previous_hash"] is None
    assert latest["bundle_path"] == "/tmp/a.beheld"


def test_get_latest_snapshot_returns_none_when_empty(db: BeheldDB) -> None:
    assert db.get_latest_snapshot() is None


def test_snapshots_are_returned_newest_first(db: BeheldDB) -> None:
    a, b, c = '{"i":1}', '{"i":2}', '{"i":3}'
    db.save_snapshot(_hash_of(a), None, a)
    db.save_snapshot(_hash_of(b), _hash_of(a), b)
    db.save_snapshot(_hash_of(c), _hash_of(b), c)
    listing = db.list_snapshots()
    assert len(listing) == 3
    # newest first
    assert listing[0]["hash"] == _hash_of(c)
    assert listing[2]["hash"] == _hash_of(a)


def test_get_snapshot_by_hash(db: BeheldDB) -> None:
    payload = '{"k":"v"}'
    h = _hash_of(payload)
    db.save_snapshot(h, None, payload)
    found = db.get_snapshot_by_hash(h)
    assert found is not None
    assert found["payload_json"] == payload


def test_hash_uniqueness_enforced(db: BeheldDB) -> None:
    payload = '{"k":"v"}'
    h = _hash_of(payload)
    db.save_snapshot(h, None, payload)
    with pytest.raises(Exception):  # UNIQUE constraint violation
        db.save_snapshot(h, None, payload)


def test_count_snapshots(db: BeheldDB) -> None:
    db.save_snapshot(_hash_of('{"a":1}'), None, '{"a":1}')
    db.save_snapshot(_hash_of('{"a":2}'), _hash_of('{"a":1}'), '{"a":2}')
    assert db.count_snapshots() == 2


# ── chain validation ─────────────────────────────────────────────────────────


def _build_chain(db: BeheldDB, n: int) -> list[str]:
    """Helper: build a valid n-link chain, return the hashes in order."""
    hashes: list[str] = []
    prev: Optional[str] = None
    for i in range(n):
        payload = '{"i":' + str(i) + '}'
        h = _hash_of(payload)
        db.save_snapshot(h, prev, payload)
        hashes.append(h)
        prev = h
    return hashes


from typing import Optional  # noqa: E402 (kept near use site for clarity)


def test_validate_chain_returns_ok_for_empty_db(db: BeheldDB) -> None:
    result = db.validate_chain()
    assert result["ok"] is True
    assert result["snapshots_checked"] == 0
    assert result["broken_at"] is None


def test_validate_chain_returns_ok_for_well_formed_chain(db: BeheldDB) -> None:
    _build_chain(db, 5)
    result = db.validate_chain()
    assert result["ok"] is True
    assert result["snapshots_checked"] == 5


def test_validate_chain_detects_content_mismatch(db: BeheldDB) -> None:
    """F5.2.5: someone alters payload_json in place without re-hashing."""
    hashes = _build_chain(db, 3)
    # Tamper: change payload_json of snapshot 2 (middle one)
    db.connect().execute(
        "UPDATE snapshots SET payload_json = ? WHERE hash = ?",
        ('{"tampered":true}', hashes[1]),
    )
    db.connect().commit()
    result = db.validate_chain()
    assert result["ok"] is False
    assert result["broken_at"]["reason"] == "content_mismatch"
    assert result["broken_at"]["hash"] == hashes[1]


def test_validate_chain_detects_link_mismatch(db: BeheldDB) -> None:
    """F5.2.6: deleting an intermediate snapshot breaks the chain."""
    hashes = _build_chain(db, 4)
    # Remove the 2nd snapshot — 3rd's previous_hash now points to a missing one
    db.connect().execute("DELETE FROM snapshots WHERE hash = ?", (hashes[1],))
    db.connect().commit()
    result = db.validate_chain()
    assert result["ok"] is False
    assert result["broken_at"]["reason"] == "link_mismatch"
    # Failure happens at the snapshot whose previous_hash no longer matches the prior row
    assert result["broken_at"]["hash"] == hashes[2]


def test_validate_chain_detects_forged_first_snapshot(db: BeheldDB) -> None:
    """If the first snapshot has a non-null previous_hash, the chain is broken."""
    payload = '{"k":"v"}'
    db.save_snapshot(_hash_of(payload), previous_hash="sha256:dead", payload_json=payload)
    result = db.validate_chain()
    assert result["ok"] is False
    assert result["broken_at"]["reason"] == "link_mismatch"


def test_already_migrated_db_records_version_once(db_path: Path) -> None:
    """A DB that already has tool_sequence_json (from old ad-hoc migration) but
    lacks schema_version should be brought up to current without re-altering."""
    conn = sqlite3.connect(str(db_path))
    conn.executescript(
        """
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            started_at TEXT NOT NULL,
            tool_sequence_json TEXT DEFAULT '[]',
            processed_at TEXT NOT NULL
        );
        """
    )
    conn.commit()
    conn.close()

    db = BeheldDB(db_path)
    db.init_schema()
    try:
        assert db.current_schema_version() == LATEST_SCHEMA_VERSION
        rows = db.connect().execute("SELECT COUNT(*) AS n FROM schema_version").fetchone()
        assert rows["n"] == LATEST_SCHEMA_VERSION
    finally:
        db.close()

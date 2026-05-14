from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from api import VERSION, app, count_unprocessed_events
from models import Scores, Signal
from processor import ProcessResult
from storage.sqlite import DevProfileDB


@pytest.fixture
def test_db(db_path: Path) -> DevProfileDB:
    db = DevProfileDB(db_path)
    db.init_schema()
    yield db
    db.close()


@pytest.fixture
def client(test_db: DevProfileDB):
    """TestClient with isolated DB and no-op APScheduler; patch applied before lifespan."""
    with patch("api.db", test_db), \
         patch("api.insights_gen") as mock_ig, \
         patch("apscheduler.schedulers.asyncio.AsyncIOScheduler.start"), \
         patch("apscheduler.schedulers.asyncio.AsyncIOScheduler.shutdown"):
        mock_ig.generate.return_value = {"insights": [], "generated_at": None, "requires_sessions": 5}
        with TestClient(app) as c:
            yield c


# ── health ────────────────────────────────────────────────────────────────────


def test_health_ok(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_health_version(client: TestClient) -> None:
    assert client.get("/health").json()["version"] == VERSION


# ── scores/current ────────────────────────────────────────────────────────────


def test_scores_current_empty_db(client: TestClient) -> None:
    data = client.get("/scores/current").json()
    for key in ("prompt_quality", "test_maturity", "tech_breadth", "growth_rate", "overall"):
        assert key in data


def test_scores_current_returns_zeros_when_no_data(client: TestClient) -> None:
    assert client.get("/scores/current").json()["overall"] == 0


def test_scores_current_with_data(client: TestClient, test_db: DevProfileDB) -> None:
    test_db.save_scores(Scores("2026-05-10", 75, 60, 80, 55, 67, 10))
    data = client.get("/scores/current").json()
    assert data["overall"] == 67
    assert data["prompt_quality"] == 75


# ── scores/history ────────────────────────────────────────────────────────────


def test_scores_history_empty(client: TestClient) -> None:
    resp = client.get("/scores/history")
    assert resp.status_code == 200
    assert resp.json() == []


def test_scores_history_returns_data(client: TestClient, test_db: DevProfileDB) -> None:
    test_db.save_scores(Scores("2026-05-10", 70, 60, 80, 55, 66, 5))
    data = client.get("/scores/history?days=10").json()
    assert len(data) == 1
    assert data[0]["prompt_quality"] == 70


# ── profile/summary ───────────────────────────────────────────────────────────


def test_profile_summary_empty(client: TestClient) -> None:
    data = client.get("/profile/summary").json()
    assert "total_sessions" in data
    assert data["total_sessions"] == 0


def test_profile_summary_with_sessions(client: TestClient, test_db: DevProfileDB, sample_session_1) -> None:
    test_db.save_session(sample_session_1)
    test_db.save_signals(sample_session_1.session_id, [
        Signal("platform", "testing", 2),
        Signal("ecosystem", "rails", 5),
    ])
    data = client.get("/profile/summary").json()
    assert data["total_sessions"] == 1
    assert "testing" in data["platforms"]


# ── insights ──────────────────────────────────────────────────────────────────


def test_insights_requires_sessions(client: TestClient) -> None:
    data = client.get("/insights").json()
    assert "requires_sessions" in data


# ── export ────────────────────────────────────────────────────────────────────


def test_export_structure(client: TestClient) -> None:
    data = client.get("/export").json()
    for key in ("version", "exported_at", "scores", "profile", "history"):
        assert key in data


def test_export_version(client: TestClient) -> None:
    assert client.get("/export").json()["version"] == VERSION


# ── status ───────────────────────────────────────────────────────────────────


def test_status_structure(client: TestClient) -> None:
    with patch("api.count_unprocessed_events", return_value=0):
        data = client.get("/status").json()
    assert data["ok"] is True
    assert "version" in data
    assert "sessions_processed" in data
    assert "unprocessed_events" in data
    assert "last_processed_at" in data


def test_status_sessions_processed_zero_when_empty(client: TestClient) -> None:
    with patch("api.count_unprocessed_events", return_value=0):
        data = client.get("/status").json()
    assert data["sessions_processed"] == 0


def test_status_last_processed_at_none_when_empty(client: TestClient) -> None:
    with patch("api.count_unprocessed_events", return_value=0):
        data = client.get("/status").json()
    assert data["last_processed_at"] is None


def test_status_unprocessed_events_field(client: TestClient) -> None:
    with patch("api.count_unprocessed_events", return_value=512):
        data = client.get("/status").json()
    assert data["unprocessed_events"] == 512


def test_status_sessions_processed_with_data(client: TestClient, test_db: DevProfileDB, sample_session_1) -> None:
    test_db.save_session(sample_session_1)
    with patch("api.count_unprocessed_events", return_value=0):
        data = client.get("/status").json()
    assert data["sessions_processed"] == 1


# ── profile/readiness ────────────────────────────────────────────────────────


def test_readiness_zero_sessions(client: TestClient) -> None:
    data = client.get("/profile/readiness").json()
    assert data["ready"] is False
    assert data["sessions_count"] == 0
    assert data["sessions_required"] == 3
    assert data["sessions_remaining"] == 3


def test_readiness_partial_sessions(client: TestClient, test_db: DevProfileDB, sample_session_1) -> None:
    test_db.save_session(sample_session_1)
    data = client.get("/profile/readiness").json()
    assert data["ready"] is False
    assert data["sessions_count"] == 1
    assert data["sessions_remaining"] == 2


def test_readiness_enough_sessions(client: TestClient, test_db: DevProfileDB, sample_session_1, sample_session_2) -> None:
    from models import Session
    import copy
    s3 = copy.deepcopy(sample_session_1)
    s3.session_id = "sess-extra"
    test_db.save_session(sample_session_1)
    test_db.save_session(sample_session_2)
    test_db.save_session(s3)
    data = client.get("/profile/readiness").json()
    assert data["ready"] is True
    assert data["sessions_count"] == 3
    assert data["sessions_remaining"] == 0


def test_readiness_structure(client: TestClient) -> None:
    data = client.get("/profile/readiness").json()
    for key in ("ready", "sessions_count", "sessions_required", "sessions_remaining"):
        assert key in data


def test_readiness_sessions_remaining_never_negative(client: TestClient, test_db: DevProfileDB, sample_session_1, sample_session_2) -> None:
    import copy
    for i in range(5):
        s = copy.deepcopy(sample_session_1)
        s.session_id = f"sess-extra-{i}"
        test_db.save_session(s)
    data = client.get("/profile/readiness").json()
    assert data["sessions_remaining"] == 0
    assert data["ready"] is True


# ── count_unprocessed_events ──────────────────────────────────────────────────


def test_count_unprocessed_no_sessions_dir(tmp_path: Path) -> None:
    missing = tmp_path / "sessions"
    with patch("api.SESSIONS_DIR", missing), patch("api.CURSOR_FILE", tmp_path / ".cursor"):
        assert count_unprocessed_events() == 0


def test_count_unprocessed_no_cursor(tmp_path: Path) -> None:
    sd = tmp_path / "sessions"
    sd.mkdir()
    (sd / "2026-05-10_test.jsonl").write_text('{"event_id":"1"}\n')
    with patch("api.SESSIONS_DIR", sd), patch("api.CURSOR_FILE", tmp_path / ".cursor"):
        result = count_unprocessed_events()
    assert result > 0


def test_count_unprocessed_zero_when_cursor_at_end(tmp_path: Path) -> None:
    sd = tmp_path / "sessions"
    sd.mkdir()
    content = '{"event_id":"1"}\n'
    f = sd / "2026-05-10_test.jsonl"
    f.write_text(content)
    cursor = tmp_path / ".cursor"
    cursor.write_text(json.dumps({"offsets": {"2026-05-10_test.jsonl": len(content.encode())}}))
    with patch("api.SESSIONS_DIR", sd), patch("api.CURSOR_FILE", cursor):
        assert count_unprocessed_events() == 0


def test_count_unprocessed_partial_cursor(tmp_path: Path) -> None:
    sd = tmp_path / "sessions"
    sd.mkdir()
    content = '{"event_id":"1"}\n{"event_id":"2"}\n'
    f = sd / "2026-05-10_test.jsonl"
    f.write_text(content)
    half = len('{"event_id":"1"}\n'.encode())
    cursor = tmp_path / ".cursor"
    cursor.write_text(json.dumps({"offsets": {"2026-05-10_test.jsonl": half}}))
    with patch("api.SESSIONS_DIR", sd), patch("api.CURSOR_FILE", cursor):
        result = count_unprocessed_events()
    expected = len('{"event_id":"2"}\n'.encode())
    assert result == expected


# ── process ───────────────────────────────────────────────────────────────────


def test_process_no_new_events(client: TestClient) -> None:
    with patch("api.processor") as mock_proc:
        mock_proc.process_new.return_value = ProcessResult(new_sessions=0)
        resp = client.post("/process")
    assert resp.status_code == 200
    assert resp.json()["processed"] == 0


def test_process_two_sessions(client: TestClient, test_db: DevProfileDB, sessions_dir: Path, tmp_path: Path) -> None:
    from reader.jsonl_reader import JsonlReader
    from processor import Processor

    cursor = tmp_path / ".test_cursor"
    reader = JsonlReader(sessions_dir, cursor)
    new_processor = Processor(test_db, reader)
    with patch("api.processor", new_processor):
        resp = client.post("/process")
    assert resp.status_code == 200
    assert resp.json()["processed"] == 2


def test_process_idempotent(client: TestClient, test_db: DevProfileDB, sessions_dir: Path, tmp_path: Path) -> None:
    from reader.jsonl_reader import JsonlReader
    from processor import Processor

    cursor = tmp_path / ".test_cursor2"
    reader = JsonlReader(sessions_dir, cursor)
    new_processor = Processor(test_db, reader)
    with patch("api.processor", new_processor):
        r1 = client.post("/process")
        r2 = client.post("/process")
    assert r1.json()["processed"] == 2
    assert r2.json()["processed"] == 0


def test_process_writes_scores(client: TestClient, test_db: DevProfileDB, sessions_dir: Path, tmp_path: Path) -> None:
    from reader.jsonl_reader import JsonlReader
    from processor import Processor

    cursor = tmp_path / ".test_cursor3"
    reader = JsonlReader(sessions_dir, cursor)
    new_processor = Processor(test_db, reader)
    with patch("api.processor", new_processor):
        client.post("/process")

    scores = test_db.get_current_scores()
    assert scores is not None
    assert scores.sessions_analyzed == 2


def test_process_persists_workflow_metrics(
    client: TestClient, test_db: DevProfileDB, sessions_dir: Path, tmp_path: Path,
) -> None:
    from reader.jsonl_reader import JsonlReader
    from processor import Processor

    cursor = tmp_path / ".test_cursor_metrics"
    reader = JsonlReader(sessions_dir, cursor)
    new_processor = Processor(test_db, reader)
    with patch("api.processor", new_processor):
        client.post("/process")

    latest = test_db.get_latest_workflow_metrics()
    assert latest is not None
    assert latest["period_days"] == 30
    assert latest["sessions_analyzed"] >= 1
    # Metrics object is a real WorkflowMetrics (not just a dict)
    from models import WorkflowMetrics
    assert isinstance(latest["metrics"], WorkflowMetrics)


# ── /metrics/workflow ─────────────────────────────────────────────────────────


def test_metrics_workflow_empty_returns_zero_metrics(client: TestClient) -> None:
    resp = client.get("/metrics/workflow")
    assert resp.status_code == 200
    data = resp.json()
    assert data["computed_at"] is None
    assert data["period_days"] == 30
    assert data["sessions_analyzed"] == 0
    # All 10 metric fields present and zero
    assert data["metrics"]["test_after_ratio"] == 0.0
    assert data["metrics"]["bash_to_read_ratio"] == 0.0
    assert data["metrics"]["ecosystem_concentration"] == 0.0


def test_metrics_workflow_returns_persisted_values(
    client: TestClient, test_db: DevProfileDB,
) -> None:
    from models import WorkflowMetrics
    test_db.save_workflow_metrics(
        WorkflowMetrics(test_after_ratio=0.78, bash_to_read_ratio=7.8),
        period_days=30,
        sessions_analyzed=42,
    )
    resp = client.get("/metrics/workflow")
    data = resp.json()
    assert data["sessions_analyzed"] == 42
    assert data["metrics"]["test_after_ratio"] == 0.78
    assert data["metrics"]["bash_to_read_ratio"] == 7.8


def test_metrics_workflow_response_is_canonical_serializable(
    client: TestClient, test_db: DevProfileDB,
) -> None:
    """The `metrics` block must round-trip through sort_keys without losing info
    — that's what F5 depends on for hash stability."""
    from models import WorkflowMetrics
    test_db.save_workflow_metrics(
        WorkflowMetrics(test_after_ratio=0.5, prompt_avg_chars=120.0),
        period_days=30,
        sessions_analyzed=10,
    )
    resp = client.get("/metrics/workflow")
    data = resp.json()
    canonical = json.dumps(data["metrics"], sort_keys=True, separators=(",", ":"))
    assert json.loads(canonical) == data["metrics"]


# ── /coach ────────────────────────────────────────────────────────────────────


def test_coach_insufficient_when_no_scores(client: TestClient) -> None:
    resp = client.get("/coach")
    assert resp.status_code == 200
    data = resp.json()
    assert data["version"] == 1
    assert data["data_freshness"] == "insufficient"
    assert data["patterns"] == []
    assert data["scores"]["sessions_analyzed"] == 0
    # Guidance is always present so the host LLM has its instructions
    assert data["coaching_guidance"]["tone"].startswith("pt-BR")
    assert len(data["coaching_guidance"]["must"]) >= 3


def test_coach_insufficient_when_below_min_sessions(
    client: TestClient, test_db: DevProfileDB,
) -> None:
    from models import Scores
    test_db.save_scores(Scores(
        date="2026-05-14",
        prompt_quality=50, test_maturity=50, tech_breadth=50, growth_rate=50,
        overall=50, sessions_analyzed=2,  # below MIN_SESSIONS=3
    ))
    resp = client.get("/coach")
    assert resp.json()["data_freshness"] == "insufficient"


def test_coach_live_with_data_returns_patterns(
    client: TestClient, test_db: DevProfileDB,
) -> None:
    from models import Scores, WorkflowMetrics
    test_db.save_scores(Scores(
        date="2026-05-14",
        prompt_quality=50, test_maturity=20, tech_breadth=40, growth_rate=30,
        overall=35, sessions_analyzed=30,
    ))
    # Metrics that will trigger test_after_dominant + debug_driven_bash_heavy
    test_db.save_workflow_metrics(
        WorkflowMetrics(
            test_after_ratio=0.8,
            median_test_delay_min=12.0,
            bash_to_read_ratio=6.0,
        ),
        period_days=30,
        sessions_analyzed=30,
    )

    resp = client.get("/coach?session_hint=feature_work")
    data = resp.json()
    assert data["data_freshness"] == "live"
    assert data["context_for_session"]["session_phase_hint"] == "feature_work"
    pattern_ids = [p["id"] for p in data["patterns"]]
    assert "test_after_dominant" in pattern_ids
    assert "debug_driven_bash_heavy" in pattern_ids


def test_coach_invalid_session_hint_is_coerced_to_unknown(client: TestClient) -> None:
    resp = client.get("/coach?session_hint=lol_not_a_hint")
    data = resp.json()
    assert data["context_for_session"]["session_phase_hint"] == "unknown"


def test_coach_response_is_fully_json_serializable(
    client: TestClient, test_db: DevProfileDB,
) -> None:
    """The whole payload must roundtrip through json.dumps without errors —
    no dataclass leaks, no Decimal, no datetime objects."""
    from models import Scores, WorkflowMetrics
    test_db.save_scores(Scores(
        date="2026-05-14",
        prompt_quality=50, test_maturity=20, tech_breadth=40, growth_rate=30,
        overall=35, sessions_analyzed=30,
    ))
    test_db.save_workflow_metrics(
        WorkflowMetrics(test_after_ratio=0.7),
        period_days=30,
        sessions_analyzed=30,
    )
    resp = client.get("/coach")
    data = resp.json()
    # If we got here, FastAPI already serialized it. Sanity check we can
    # round-trip without loss.
    roundtrip = json.loads(json.dumps(data, sort_keys=True))
    assert roundtrip["version"] == 1
    assert "coaching_guidance" in roundtrip


def test_coach_payload_includes_coaching_guidance_constants(
    client: TestClient, test_db: DevProfileDB,
) -> None:
    """The guidance block must be present in BOTH insufficient and live modes —
    it's how the host LLM knows how to behave even when no patterns fire."""
    resp_insufficient = client.get("/coach")
    assert resp_insufficient.json()["coaching_guidance"]["good_example"]

    from models import Scores
    test_db.save_scores(Scores(
        date="2026-05-14",
        prompt_quality=50, test_maturity=50, tech_breadth=50, growth_rate=50,
        overall=50, sessions_analyzed=30,
    ))
    resp_live = client.get("/coach")
    assert resp_live.json()["coaching_guidance"]["bad_example"]


def test_coach_suggested_followups_present_in_live_mode(
    client: TestClient, test_db: DevProfileDB,
) -> None:
    from models import Scores
    test_db.save_scores(Scores(
        date="2026-05-14",
        prompt_quality=50, test_maturity=50, tech_breadth=50, growth_rate=50,
        overall=50, sessions_analyzed=30,
    ))
    resp = client.get("/coach")
    followups = resp.json()["suggested_followups"]
    assert len(followups) >= 1
    assert all(isinstance(f, str) for f in followups)


# ── /snapshot/latest & /snapshot/chain/status (Phase 5 — F5.2.4, F5.2.5) ─────


import hashlib as _hashlib


def _h(payload: str) -> str:
    return "sha256:" + _hashlib.sha256(payload.encode("utf-8")).hexdigest()


def test_snapshot_latest_returns_nulls_when_empty(client: TestClient) -> None:
    resp = client.get("/snapshot/latest")
    assert resp.status_code == 200
    data = resp.json()
    assert data == {"hash": None, "previous_hash": None, "created_at": None}


def test_snapshot_latest_returns_tip_of_chain(
    client: TestClient, test_db: DevProfileDB,
) -> None:
    a, b = '{"i":1}', '{"i":2}'
    test_db.save_snapshot(_h(a), None, a)
    test_db.save_snapshot(_h(b), _h(a), b)
    resp = client.get("/snapshot/latest")
    data = resp.json()
    assert data["hash"] == _h(b)
    assert data["previous_hash"] == _h(a)
    assert data["created_at"]  # ISO timestamp present


def test_snapshot_latest_never_leaks_payload_or_bundle_path(
    client: TestClient, test_db: DevProfileDB,
) -> None:
    """Endpoint is for chain tip metadata only — payload_json and bundle_path
    stay internal."""
    payload = '{"secret":"do not expose"}'
    test_db.save_snapshot(_h(payload), None, payload, bundle_path="/tmp/x.dpbundle")
    data = client.get("/snapshot/latest").json()
    assert "payload_json" not in data
    assert "bundle_path" not in data
    assert "do not expose" not in str(data)


def test_chain_status_ok_for_empty(client: TestClient) -> None:
    data = client.get("/snapshot/chain/status").json()
    assert data["ok"] is True
    assert data["snapshots_checked"] == 0


def test_chain_status_detects_tampering(
    client: TestClient, test_db: DevProfileDB,
) -> None:
    a, b = '{"i":1}', '{"i":2}'
    test_db.save_snapshot(_h(a), None, a)
    test_db.save_snapshot(_h(b), _h(a), b)
    # Tamper the payload of snapshot a without re-hashing
    test_db.connect().execute(
        "UPDATE snapshots SET payload_json = ? WHERE hash = ?",
        ('{"changed":true}', _h(a)),
    )
    test_db.connect().commit()
    data = client.get("/snapshot/chain/status").json()
    assert data["ok"] is False
    assert data["broken_at"]["reason"] == "content_mismatch"


# ── POST /snapshot/payload + /snapshot/save + GET /snapshots (Phase 5 / F5.3) ──


def test_snapshot_payload_returns_409_when_no_scores(client: TestClient) -> None:
    resp = client.post("/snapshot/payload")
    assert resp.status_code == 409
    assert "no scores" in resp.json()["detail"].lower()


def test_snapshot_payload_builds_valid_shape(
    client: TestClient, test_db: DevProfileDB,
) -> None:
    from models import Scores, WorkflowMetrics
    test_db.save_scores(Scores(
        date="2026-05-14",
        prompt_quality=50, test_maturity=20, tech_breadth=40,
        growth_rate=30, overall=35, sessions_analyzed=10,
    ))
    test_db.save_workflow_metrics(
        WorkflowMetrics(test_after_ratio=0.6),
        period_days=30,
        sessions_analyzed=10,
    )

    resp = client.post("/snapshot/payload")
    assert resp.status_code == 200
    data = resp.json()
    # Top-level shape per the contract (Etapa C)
    assert "created_at" in data
    assert "devprofile_version" in data
    assert "previous_hash" in data
    assert "scores" in data
    assert "l1" in data
    assert "l2" in data
    # l2 contains the same 7 fields the old `signals` did
    l2 = data["l2"]
    for key in (
        "platforms", "ecosystems", "workflow_distribution",
        "project_categories", "workflow_metrics",
        "sessions_analyzed", "period_days",
    ):
        assert key in l2
    # previous_hash is null for the first ever snapshot
    assert data["previous_hash"] is None


def test_snapshot_payload_carries_persisted_workflow_metrics(
    client: TestClient, test_db: DevProfileDB,
) -> None:
    from models import Scores, WorkflowMetrics
    test_db.save_scores(Scores(date="2026-05-14",
        prompt_quality=50, test_maturity=20, tech_breadth=40,
        growth_rate=30, overall=35, sessions_analyzed=10))
    test_db.save_workflow_metrics(
        WorkflowMetrics(test_after_ratio=0.78, bash_to_read_ratio=4.2),
        period_days=30,
        sessions_analyzed=10,
    )
    data = client.post("/snapshot/payload").json()
    wm = data["l2"]["workflow_metrics"]
    assert wm["test_after_ratio"] == 0.78
    assert wm["bash_to_read_ratio"] == 4.2


def test_snapshot_payload_chains_to_previous(
    client: TestClient, test_db: DevProfileDB,
) -> None:
    from models import Scores
    test_db.save_scores(Scores(date="2026-05-14",
        prompt_quality=10, test_maturity=10, tech_breadth=10,
        growth_rate=10, overall=10, sessions_analyzed=5))
    # Pre-existing snapshot in DB → next payload should reference it
    test_db.save_snapshot(_h('{"prev":1}'), None, '{"prev":1}')
    data = client.post("/snapshot/payload").json()
    assert data["previous_hash"] == _h('{"prev":1}')


def test_snapshot_save_rejects_invalid_hash_format(client: TestClient) -> None:
    resp = client.post(
        "/snapshot/save",
        json={"hash": "not-a-hash", "payload_json": "{}"},
    )
    assert resp.status_code == 422  # pydantic validation


def test_snapshot_save_persists_to_db(
    client: TestClient, test_db: DevProfileDB,
) -> None:
    payload = '{"x":1}'
    h = _h(payload)
    resp = client.post(
        "/snapshot/save",
        json={"hash": h, "payload_json": payload, "bundle_path": "/tmp/a.dpbundle"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["hash"] == h
    assert test_db.count_snapshots() == 1


def test_snapshot_save_returns_409_on_duplicate(
    client: TestClient, test_db: DevProfileDB,
) -> None:
    payload = '{"x":1}'
    h = _h(payload)
    body = {"hash": h, "payload_json": payload}
    r1 = client.post("/snapshot/save", json=body)
    assert r1.status_code == 200
    r2 = client.post("/snapshot/save", json=body)
    assert r2.status_code == 409


def test_snapshots_list_empty(client: TestClient) -> None:
    resp = client.get("/snapshots")
    assert resp.status_code == 200
    assert resp.json() == []


def test_snapshots_list_newest_first(
    client: TestClient, test_db: DevProfileDB,
) -> None:
    test_db.save_snapshot(_h('{"i":1}'), None, '{"i":1}', bundle_path="/a")
    test_db.save_snapshot(_h('{"i":2}'), _h('{"i":1}'), '{"i":2}', bundle_path="/b")
    data = client.get("/snapshots").json()
    assert len(data) == 2
    assert data[0]["bundle_path"] == "/b"
    assert data[1]["bundle_path"] == "/a"
    # payload_json never leaks through this endpoint
    assert all("payload_json" not in row for row in data)

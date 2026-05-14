from __future__ import annotations

import dataclasses
import json
from collections import Counter
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from bundle import build_bundle_payload
from coach import COACHING_GUIDANCE, detect_patterns
from insights import InsightGenerator
from models import (
    COACH_PAYLOAD_VERSION,
    CoachPayload,
    Scores,
    SessionContext,
    WorkflowMetrics,
)
from processor import Processor
from reader.jsonl_reader import CURSOR_FILE, SESSIONS_DIR, JsonlReader
from storage.sqlite import DB_PATH, DevProfileDB

VERSION = "0.1.0"

db = DevProfileDB(DB_PATH)
_reader = JsonlReader(SESSIONS_DIR, CURSOR_FILE)
processor = Processor(db, _reader)
insights_gen = InsightGenerator(db)


# ── status helpers ────────────────────────────────────────────────────────────


def count_unprocessed_events() -> int:
    if not SESSIONS_DIR.exists():
        return 0

    cursor: dict[str, int] = {}
    if CURSOR_FILE.exists():
        try:
            data = json.loads(CURSOR_FILE.read_text())
            cursor = data.get("offsets", {})
        except Exception:
            cursor = {}

    unprocessed = 0
    for jsonl_file in SESSIONS_DIR.glob("*.jsonl"):
        file_size = jsonl_file.stat().st_size
        last_offset = cursor.get(jsonl_file.name, 0)
        if file_size > last_offset:
            unprocessed += file_size - last_offset

    return unprocessed


def get_sessions_processed() -> int:
    row = db.connect().execute("SELECT COUNT(*) FROM sessions").fetchone()
    return row[0] if row else 0


def get_last_processed_at() -> str | None:
    row = db.connect().execute(
        "SELECT processed_at FROM sessions ORDER BY processed_at DESC LIMIT 1"
    ).fetchone()
    return row[0] if row else None


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_schema()
    from apscheduler.schedulers.asyncio import AsyncIOScheduler

    scheduler = AsyncIOScheduler()
    scheduler.add_job(processor.process_new, "interval", seconds=60, id="process_new")
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)
    db.close()


app = FastAPI(title="DevProfile Engine", version=VERSION, lifespan=lifespan)


# ── endpoints ────────────────────────────────────────────────────────────────


@app.get("/health")
def health() -> dict:
    return {"ok": True, "version": VERSION}


MIN_SESSIONS = 3


@app.get("/profile/readiness")
def profile_readiness() -> dict:
    sessions_count = get_sessions_processed()
    ready = sessions_count >= MIN_SESSIONS
    return {
        "ready": ready,
        "sessions_count": sessions_count,
        "sessions_required": MIN_SESSIONS,
        "sessions_remaining": max(0, MIN_SESSIONS - sessions_count),
    }


@app.get("/status")
def status() -> dict:
    return {
        "ok": True,
        "version": VERSION,
        "sessions_processed": get_sessions_processed(),
        "unprocessed_events": count_unprocessed_events(),
        "last_processed_at": get_last_processed_at(),
    }


@app.post("/process")
def process() -> dict:
    result = processor.process_new()
    return {"status": "ok", "processed": result.new_sessions}


@app.get("/scores/current")
def scores_current() -> dict:
    scores = db.get_current_scores()
    if scores is None:
        return {
            "prompt_quality": 0,
            "test_maturity": 0,
            "tech_breadth": 0,
            "growth_rate": 0,
            "overall": 0,
            "sessions_analyzed": 0,
            "sessions_today": 0,
            "updated_at": None,
            "top_insight": None,
        }
    today = datetime.now(timezone.utc).date().isoformat()
    return {
        **dataclasses.asdict(scores),
        "sessions_today": db.count_sessions_on_date(today),
        "updated_at": scores.date,
        "top_insight": db.get_profile("top_insight"),
    }


@app.get("/scores/history")
def scores_history(days: int = 30) -> list[dict]:
    return [dataclasses.asdict(s) for s in db.get_scores_history(days)]


@app.get("/profile/summary")
def profile_summary() -> dict:
    sessions = db.get_all_sessions_as_objects()
    signals = db.get_all_signals()
    profile = db.get_all_profile()

    platforms = list({s["signal_value"] for s in signals if s["signal_type"] == "platform"})
    ecosystems = list({s["signal_value"] for s in signals if s["signal_type"] == "ecosystem"})

    workflows = [s.workflow_pattern for s in sessions if s.workflow_pattern]
    wf_dist: dict[str, float] = {}
    if workflows:
        wf_count = Counter(workflows)
        total = len(workflows)
        wf_dist = {k: round(v / total, 2) for k, v in wf_count.most_common()}

    categories = [s.project_category for s in sessions if s.project_category != "unknown"]
    cat_dist: dict[str, float] = {}
    if categories:
        cat_count = Counter(categories)
        total = len(categories)
        cat_dist = {k: round(v / total, 2) for k, v in cat_count.most_common(5)}

    return {
        "total_sessions": len(sessions),
        "platforms": platforms[:5],
        "ecosystems": ecosystems[:6],
        "workflow_distribution": wf_dist,
        "project_categories": cat_dist,
        "last_scored_at": profile.get("last_scored_at"),
        "overall_score": int(profile.get("overall_score", "0") or "0"),
    }


@app.get("/insights")
def insights() -> dict:
    try:
        return insights_gen.generate()
    except Exception:
        return {"insights": [], "generated_at": None}


_VALID_SESSION_HINTS = {"feature_work", "debug", "refactor", "exploration", "unknown"}


@app.get("/metrics/workflow")
def metrics_workflow() -> dict:
    """Latest WorkflowMetrics + metadata.

    Consumers: MCP coach tool, future .dpbundle generator (F5). The `metrics`
    block is canonical (scalars only, sort_keys serializable) — safe to embed
    in a signed snapshot.
    """
    latest = db.get_latest_workflow_metrics()
    if latest is None:
        return {
            "computed_at": None,
            "period_days": 30,
            "sessions_analyzed": 0,
            "metrics": dataclasses.asdict(WorkflowMetrics()),
        }
    return {
        "computed_at": latest["computed_at"],
        "period_days": latest["period_days"],
        "sessions_analyzed": latest["sessions_analyzed"],
        "metrics": dataclasses.asdict(latest["metrics"]),
    }


def _build_session_context(session_hint: str) -> SessionContext:
    """Derive SessionContext from profile summary + caller-provided hint."""
    summary = profile_summary()
    ecosystems = list(summary.get("ecosystems", []))[:3]
    categories = summary.get("project_categories", {}) or {}
    top_category = next(iter(categories.keys()), "unknown")
    return SessionContext(
        current_project_category=top_category,
        ecosystems_recent=ecosystems,
        session_phase_hint=session_hint,
    )


def _empty_scores() -> Scores:
    return Scores(
        date="",
        prompt_quality=0,
        test_maturity=0,
        tech_breadth=0,
        growth_rate=0,
        overall=0,
        sessions_analyzed=0,
    )


@app.get("/coach")
def coach(session_hint: str = "unknown") -> dict:
    """Coach payload — patterns + scores + guidance for the host LLM.

    Schema: see models.CoachPayload (versioned via COACH_PAYLOAD_VERSION).
    """
    hint = session_hint if session_hint in _VALID_SESSION_HINTS else "unknown"
    now_iso = datetime.now(timezone.utc).isoformat()

    scores = db.get_current_scores()
    if scores is None or scores.sessions_analyzed < MIN_SESSIONS:
        payload = CoachPayload(
            version=COACH_PAYLOAD_VERSION,
            as_of=now_iso,
            data_freshness="insufficient",
            scores=scores or _empty_scores(),
            context_for_session=SessionContext(session_phase_hint=hint),
            patterns=[],
            coaching_guidance=COACHING_GUIDANCE,
            suggested_followups=[],
        )
        return dataclasses.asdict(payload)

    latest = db.get_latest_workflow_metrics()
    metrics = latest["metrics"] if latest else WorkflowMetrics()
    context = _build_session_context(hint)
    patterns = detect_patterns(metrics, scores, context)

    payload = CoachPayload(
        version=COACH_PAYLOAD_VERSION,
        as_of=now_iso,
        data_freshness="live",
        scores=scores,
        context_for_session=context,
        patterns=patterns,
        coaching_guidance=COACHING_GUIDANCE,
        suggested_followups=[
            "Quer ver as sessões que mais puxaram esse padrão?",
            "Quer ajustar o tom do coaching ou desativar nesta sessão?",
        ],
    )
    return dataclasses.asdict(payload)


@app.get("/snapshot/latest")
def snapshot_latest() -> dict:
    """Tip of the snapshot chain — consumed by `devprofile snapshot` to set
    `previous_hash` on the next bundle. Returns nulls if no snapshot exists
    (genesis case)."""
    latest = db.get_latest_snapshot()
    if latest is None:
        return {"hash": None, "previous_hash": None, "created_at": None}
    return {
        "hash": latest["hash"],
        "previous_hash": latest["previous_hash"],
        "created_at": latest["created_at"],
    }


@app.get("/snapshot/chain/status")
def snapshot_chain_status() -> dict:
    """Walks the entire chain detecting tampering. Diagnostic endpoint —
    consumed by `devprofile verify --chain` and future health checks."""
    return db.validate_chain()


@app.post("/snapshot/payload")
def snapshot_payload() -> dict:
    """Build the signable half of a .dpbundle from current DB state.

    Returns the BundlePayload as-is (unsigned). The CLI canonicalizes, hashes,
    signs with Ed25519, and POSTs the result back to /snapshot/save.
    """
    try:
        payload = build_bundle_payload(db, VERSION)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return dataclasses.asdict(payload)


class SnapshotSaveBody(BaseModel):
    hash: str = Field(..., pattern=r"^sha256:[0-9a-f]{64}$")
    previous_hash: Optional[str] = Field(None, pattern=r"^sha256:[0-9a-f]{64}$")
    payload_json: str
    bundle_path: Optional[str] = None


@app.post("/snapshot/save")
def snapshot_save(body: SnapshotSaveBody) -> dict:
    """Persist a signed snapshot referenced by hash. Idempotent at the SQL
    level via UNIQUE(hash) — second save with the same hash returns 409."""
    try:
        snap_id = db.save_snapshot(
            bundle_hash=body.hash,
            previous_hash=body.previous_hash,
            payload_json=body.payload_json,
            bundle_path=body.bundle_path,
        )
    except Exception as e:
        if "UNIQUE" in str(e).upper():
            raise HTTPException(status_code=409, detail="snapshot already saved")
        raise HTTPException(status_code=500, detail=str(e))
    return {"ok": True, "id": snap_id, "hash": body.hash}


@app.get("/snapshots")
def snapshots_list(limit: int = 100) -> list[dict]:
    """Newest-first history. payload_json is NOT included — that's local-only
    state used for chain validation."""
    return db.list_snapshots(limit)


# ── L1 (git repository signals) ──────────────────────────────────────────────


@app.get("/l1/summary")
def l1_summary() -> dict:
    """Aggregated L1 signals across all imported git repos.

    Returns zero/empty values when no repos have been imported (no 500). L1 is
    strictly separate from L2 (session signals) — scorers consume each layer
    independently.
    """
    s = db.get_l1_summary()
    return {
        "total_repos": s["total_repos"],
        "total_commits": s["total_commits"],
        "earliest_commit": s["earliest_commit"],
        "latest_commit": s["latest_commit"],
        "ecosystems_merged": s["ecosystems_merged"],
        "platforms_merged": s["platforms_merged"],
        "avg_test_ratio": s["avg_test_ratio"],
    }


@app.get("/l1/repositories")
def l1_repositories() -> list[dict]:
    """List of imported repos, identified opaquely by root_commit_hash."""
    return db.get_l1_repositories()


@app.delete("/l1/repositories/{root_hash}")
def l1_delete_repository(root_hash: str) -> dict:
    removed = db.delete_l1_repository(root_hash)
    if not removed:
        raise HTTPException(status_code=404, detail="repository not found")
    return {"ok": True, "root_commit_hash": root_hash}


@app.get("/export")
def export_data() -> dict:
    scores = db.get_current_scores()
    history = db.get_scores_history(90)
    return {
        "version": VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "scores": dataclasses.asdict(scores) if scores else None,
        "profile": db.get_all_profile(),
        "history": [dataclasses.asdict(s) for s in history],
    }

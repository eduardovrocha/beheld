from __future__ import annotations

import dataclasses
import json
from collections import Counter
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI

from insights import InsightGenerator
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

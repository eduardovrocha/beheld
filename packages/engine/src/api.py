from __future__ import annotations

import json
from collections import Counter
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import FastAPI

from classifiers.project_type import classify_project_type
from classifiers.workflow import classify_workflow
from extractors.commands import extract_platforms
from extractors.files import extract_ecosystems, extract_languages
from models import Session
from reader.jsonl_reader import SESSIONS_DIR, group_into_sessions, read_all_events
from scorers.growth_rate import compute_growth_rate
from scorers.prompt_quality import compute_prompt_quality
from scorers.tech_breadth import compute_tech_breadth
from scorers.test_maturity import compute_test_maturity
from storage.sqlite import DB_PATH, DevProfileDB

VERSION = "0.1.0"

db = DevProfileDB()


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_schema()
    yield
    db.close()


app = FastAPI(title="DevProfile Engine", version=VERSION, lifespan=lifespan)


# ── helpers ───────────────────────────────────────────────────────────────────


def _recompute_scores(sessions: list[Session]) -> None:
    if not sessions:
        return

    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    cutoff_recent = now - timedelta(days=30)
    cutoff_previous = now - timedelta(days=60)

    recent = [s for s in sessions if s.started_at >= cutoff_recent]
    previous = [s for s in sessions if cutoff_previous <= s.started_at < cutoff_recent]

    pq = compute_prompt_quality(sessions)
    tm = compute_test_maturity(sessions)
    tb = compute_tech_breadth(sessions)
    gr = compute_growth_rate(recent, previous)
    overall = (pq + tm + tb + gr) // 4

    db.save_scores(
        date=today,
        prompt_quality=pq,
        test_maturity=tm,
        tech_breadth=tb,
        growth_rate=gr,
        overall=overall,
        sessions_analyzed=len(sessions),
    )
    db.update_profile("total_sessions", str(len(sessions)))
    db.update_profile("last_scored_at", now.isoformat())
    db.update_profile("overall_score", str(overall))


def _build_signals(session: Session) -> list[tuple[str, str, int]]:
    all_exts: Counter = Counter(session.file_extensions)
    ecosystems = extract_ecosystems(all_exts)
    languages = extract_languages(all_exts)
    platforms = extract_platforms(session.commands)

    signals: list[tuple[str, str, int]] = []
    for p in platforms:
        signals.append(("platform", p, 1))
    for e in ecosystems:
        signals.append(("ecosystem", e, all_exts.get(e, 1)))
    for lang in languages:
        signals.append(("language", lang, 1))
    for tool in session.tools_used:
        count = sum(1 for ev in session.events if ev.tool_name == tool)
        signals.append(("tool", tool, count))
    if session.has_test_context:
        signals.append(("metric", "has_test_context", 1))
    return signals


# ── endpoints ────────────────────────────────────────────────────────────────


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": VERSION}


@app.post("/process")
def process() -> dict:
    """Read new JSONL events, persist sessions, recompute scores."""
    events = read_all_events()
    if not events:
        return {"status": "ok", "processed": 0}

    existing_ids = db.get_existing_session_ids()
    all_sessions = group_into_sessions(events)
    new_sessions = [s for s in all_sessions if s.session_id not in existing_ids]

    for session in new_sessions:
        all_exts: Counter = Counter(session.file_extensions)
        ecosystems = extract_ecosystems(all_exts)
        category, confidence = classify_project_type(
            session.commands, ecosystems, session.tools_used, all_exts
        )
        workflow = classify_workflow(session)

        db.save_session(
            session_id=session.session_id,
            source=session.source,
            started_at=session.started_at,
            ended_at=session.ended_at,
            duration_minutes=session.duration_minutes,
            total_turns=session.total_turns,
            cwd_hash=session.cwd_hash,
            project_category=category,
            project_confidence=confidence,
            workflow_pattern=workflow,
        )
        db.save_signals(session.session_id, _build_signals(session))

    _recompute_scores(all_sessions)
    return {"status": "ok", "processed": len(new_sessions)}


@app.get("/scores/current")
def scores_current() -> dict:
    row = db.get_current_scores()
    if row is None:
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
        **row,
        "sessions_today": db.count_sessions_on_date(today),
        "updated_at": row.get("date"),
        "top_insight": db.get_profile_value("top_insight"),
    }


@app.get("/scores/history")
def scores_history(days: int = 30) -> list[dict]:
    return db.get_scores_history(days)


@app.get("/profile/summary")
def profile_summary() -> dict:
    profile = db.get_profile()
    sessions = db.get_all_sessions()
    signals = db.get_all_signals()

    platforms = list({s["signal_value"] for s in signals if s["signal_type"] == "platform"})
    ecosystems = list({s["signal_value"] for s in signals if s["signal_type"] == "ecosystem"})

    workflows = [s["workflow_pattern"] for s in sessions if s.get("workflow_pattern")]
    wf_dist: dict[str, float] = {}
    if workflows:
        from collections import Counter as _Counter
        wf_count = _Counter(workflows)
        total = len(workflows)
        wf_dist = {k: round(v / total, 2) for k, v in wf_count.most_common()}

    categories = [s["project_category"] for s in sessions if s.get("project_category") and s["project_category"] != "unknown"]
    cat_dist: dict[str, float] = {}
    if categories:
        from collections import Counter as _Counter
        cat_count = _Counter(categories)
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
    """Rule-based insights with 24-hour cache."""
    cached = db.get_profile_value("insights_cache")
    cached_at_str = db.get_profile_value("insights_cached_at")

    if cached and cached_at_str:
        try:
            cached_at = datetime.fromisoformat(cached_at_str)
            age = (datetime.now(timezone.utc) - cached_at).total_seconds()
            if age < 86400:
                return json.loads(cached)
        except Exception:
            pass

    scores = db.get_current_scores()
    if not scores or scores.get("sessions_analyzed", 0) < 5:
        return {"insights": [], "generated_at": None, "requires_sessions": 5}

    result = _generate_insights(scores)
    db.update_profile("insights_cache", json.dumps(result))
    db.update_profile("insights_cached_at", datetime.now(timezone.utc).isoformat())

    if result.get("insights"):
        db.update_profile("top_insight", result["insights"][0])

    return result


def _generate_insights(scores: dict) -> dict:
    pq = scores.get("prompt_quality", 0)
    tm = scores.get("test_maturity", 0)
    tb = scores.get("tech_breadth", 0)
    gr = scores.get("growth_rate", 0)
    overall = scores.get("overall", 0)
    n = scores.get("sessions_analyzed", 0)

    items: list[str] = []

    if overall >= 80:
        items.append(f"Top {100 - overall}% em score geral — excelente uso do Claude")
    elif overall >= 60:
        items.append(f"Score geral {overall}/100 — acima da média")

    if pq >= 75:
        items.append("Qualidade de prompt acima da média — contexto rico e sessões longas")
    elif pq < 40:
        items.append("Prompts curtos detectados — adicionar contexto de arquivo melhora as respostas")

    if tm >= 70:
        items.append("Alta maturidade em testes — TDD e test coverage bem integrados")
    elif tm < 35:
        items.append(f"Testes em {int(tm * 0.35)}% das sessões — oportunidade de crescimento")

    if tb >= 80:
        items.append("Alta diversidade técnica — múltiplos ecossistemas e plataformas")

    if gr > 55:
        items.append("Crescimento positivo nos últimos 30 dias")
    elif gr < 45:
        items.append("Score estável — consistência é um ativo")

    if not items:
        items.append(f"Score geral: {overall}/100 baseado em {n} sessões")

    return {
        "insights": items[:4],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model": "rule-based",
    }


@app.get("/export")
def export_data() -> dict:
    return {
        "version": VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "scores": db.get_current_scores(),
        "profile": db.get_profile(),
        "history": db.get_scores_history(90),
    }

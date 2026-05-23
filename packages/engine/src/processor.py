from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from classifiers.project_type import classify
from coach import compute_workflow_metrics
from extractors.commands import detect_platforms
from extractors.tools import build_tool_sequence, detect_workflow
from extractors.files import detect_ecosystems, detect_languages
from models import Scores, Session, Signal, TechnicalSignals
from reader.jsonl_reader import JsonlReader
from scorers.base import L1Snapshot
from scorers.growth_rate import GrowthRateScorer
from scorers.overall import calculate_overall
from scorers.prompt_quality import PromptQualityScorer
from scorers.tech_breadth import TechBreadthScorer
from scorers.test_maturity import TestMaturityScorer
from storage.sqlite import BeheldDB


@dataclass
class ProcessResult:
    new_sessions: int
    scores_updated: bool = False


class Processor:
    def __init__(self, db: BeheldDB, reader: JsonlReader) -> None:
        self.db = db
        self.reader = reader

    def process_new(self) -> ProcessResult:
        new_sessions = self.reader.read_new_sessions()
        if not new_sessions:
            return ProcessResult(new_sessions=0)

        for session in new_sessions:
            prior_seq = self.db.get_session_tool_sequence(session.session_id)
            self._annotate_session(session, prior_seq)
            self.db.save_session(session)
            self.db.save_signals(session.session_id, self._build_signals(session))

        self._recompute_scores()
        return ProcessResult(new_sessions=len(new_sessions), scores_updated=True)

    # ── private helpers ───────────────────────────────────────────────────────

    def _annotate_session(self, session: Session, prior_tool_sequence: list[str] | None = None) -> None:
        fake_paths = [f"f{ext}" for ext in session.file_extensions.keys()]
        signals = TechnicalSignals(
            platforms=detect_platforms(session.commands),
            ecosystems=detect_ecosystems(fake_paths),
            languages=detect_languages(fake_paths),
            tools={t: session.tools_used.count(t) for t in set(session.tools_used)},
        )

        current_seq = build_tool_sequence(session)
        full_seq = (prior_tool_sequence or []) + current_seq
        session.tool_sequence = full_seq

        workflow = detect_workflow(full_seq)
        signals.workflow_pattern = workflow

        classification = classify(signals)
        session.project_category = classification.category
        session.project_confidence = classification.confidence
        session.workflow_pattern = workflow

    def _build_signals(self, session: Session) -> list[Signal]:
        fake_paths = [f"f{ext}" for ext in session.file_extensions.keys()]
        platforms = detect_platforms(session.commands)
        ecosystems = detect_ecosystems(fake_paths)
        languages = detect_languages(fake_paths)

        signals: list[Signal] = []
        for p, count in platforms.items():
            signals.append(Signal("platform", p, count))
        for e, count in ecosystems.items():
            signals.append(Signal("ecosystem", e, count))
        for lang, count in languages.items():
            signals.append(Signal("language", lang, count))
        for tool in set(session.tools_used):
            count = sum(1 for ev in session.events if ev.tool_name == tool)
            signals.append(Signal("tool", tool, max(count, 1)))
        if session.workflow_pattern != "unknown":
            signals.append(Signal("workflow", session.workflow_pattern, 1))
        return signals

    def _recompute_scores(self) -> None:
        all_sessions = self.db.get_all_sessions_as_objects()
        if not all_sessions:
            return

        now = datetime.now(timezone.utc)
        today = now.date().isoformat()
        cutoff_recent = now - timedelta(days=30)
        cutoff_previous = now - timedelta(days=60)

        recent = [s for s in all_sessions if s.started_at >= cutoff_recent]
        previous = [s for s in all_sessions if cutoff_previous <= s.started_at < cutoff_recent]

        l1 = L1Snapshot.from_summary(self.db.get_l1_summary())

        pq = PromptQualityScorer().score(all_sessions)
        tm = TestMaturityScorer().score(all_sessions, l1=l1)
        tb = TechBreadthScorer().score(all_sessions, l1=l1)
        gr = GrowthRateScorer().score(recent, previous, l1=l1)
        overall = calculate_overall(pq, tm, tb, gr)

        self.db.save_scores(
            Scores(
                date=today,
                prompt_quality=pq,
                test_maturity=tm,
                tech_breadth=tb,
                growth_rate=gr,
                overall=overall,
                sessions_analyzed=len(all_sessions),
            )
        )
        self.db.set_profile("total_sessions", str(len(all_sessions)))
        self.db.set_profile("last_scored_at", now.isoformat())
        self.db.set_profile("overall_score", str(overall))

        # Workflow metrics over the recent window — feeds coach + .beheld (F5).
        # Falls back to full history when recent window is sparse to avoid flaky values.
        metrics_window = recent if len(recent) >= 5 else all_sessions
        wf_metrics = compute_workflow_metrics(metrics_window)
        self.db.save_workflow_metrics(
            wf_metrics,
            period_days=30,
            sessions_analyzed=len(metrics_window),
        )

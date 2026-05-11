from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Union

import os

from models import Scores, Session, Signal

_DATA_HOME = Path(os.environ.get("DEVPROFILE_DATA_DIR", Path.home()))
DB_PATH = _DATA_HOME / ".devprofile" / "profile.db"

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_minutes REAL,
    total_turns INTEGER,
    cwd_hash TEXT,
    project_category TEXT,
    project_confidence REAL,
    workflow_pattern TEXT,
    has_test_context INTEGER DEFAULT 0,
    avg_prompt_length REAL DEFAULT 0.0,
    has_code_context_ratio REAL DEFAULT 0.0,
    event_count INTEGER DEFAULT 0,
    tools_json TEXT DEFAULT '[]',
    extensions_json TEXT DEFAULT '{}',
    commands_json TEXT DEFAULT '[]',
    tool_sequence_json TEXT DEFAULT '[]',
    processed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS technical_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT REFERENCES sessions(id),
    signal_type TEXT NOT NULL,
    signal_value TEXT NOT NULL,
    occurrences INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_signals_session ON technical_signals(session_id);
CREATE INDEX IF NOT EXISTS idx_signals_type ON technical_signals(signal_type);

CREATE TABLE IF NOT EXISTS scores (
    date TEXT NOT NULL PRIMARY KEY,
    prompt_quality INTEGER,
    test_maturity INTEGER,
    tech_breadth INTEGER,
    growth_rate INTEGER,
    overall INTEGER,
    sessions_analyzed INTEGER
);

CREATE TABLE IF NOT EXISTS profile (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


class DevProfileDB:
    def __init__(self, db_path: Union[Path, str] = DB_PATH) -> None:
        self.db_path = Path(db_path) if db_path != ":memory:" else Path(":memory:")
        self._in_memory = str(db_path) == ":memory:"
        if not self._in_memory:
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn: Optional[sqlite3.Connection] = None

    def connect(self) -> sqlite3.Connection:
        if self._conn is None:
            path = ":memory:" if self._in_memory else str(self.db_path)
            self._conn = sqlite3.connect(path, check_same_thread=False)
            self._conn.row_factory = sqlite3.Row
        return self._conn

    def init_schema(self) -> None:
        try:
            self.connect().executescript(SCHEMA_SQL)
        except sqlite3.DatabaseError:
            # DB is corrupted — close, delete, and recreate
            if self._conn:
                try:
                    self._conn.close()
                except Exception:
                    pass
                self._conn = None
            if not self._in_memory and self.db_path.exists():
                self.db_path.unlink()
            self.connect().executescript(SCHEMA_SQL)
        self._migrate_schema()

    def _migrate_schema(self) -> None:
        conn = self.connect()
        cols = {row[1] for row in conn.execute("PRAGMA table_info(sessions)").fetchall()}
        if "tool_sequence_json" not in cols:
            conn.execute("ALTER TABLE sessions ADD COLUMN tool_sequence_json TEXT DEFAULT '[]'")
            conn.commit()

    def close(self) -> None:
        if self._conn:
            self._conn.close()
            self._conn = None

    # ── sessions ──────────────────────────────────────────────────────────────

    def save_session(self, session: Session) -> None:
        from collections import Counter as _Counter
        conn = self.connect()
        now = datetime.now(timezone.utc).isoformat()

        existing = conn.execute(
            "SELECT * FROM sessions WHERE id = ?", (session.session_id,)
        ).fetchone()

        if existing is None:
            conn.execute(
                """
                INSERT INTO sessions
                (id, source, started_at, ended_at, duration_minutes, total_turns, cwd_hash,
                 project_category, project_confidence, workflow_pattern,
                 has_test_context, avg_prompt_length, has_code_context_ratio, event_count,
                 tools_json, extensions_json, commands_json, tool_sequence_json, processed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    session.session_id, session.source,
                    session.started_at.isoformat(),
                    session.ended_at.isoformat() if session.ended_at else None,
                    session.duration_minutes, session.total_turns, session.cwd_hash,
                    session.project_category, session.project_confidence, session.workflow_pattern,
                    int(session.has_test_context), session.avg_prompt_length,
                    session.has_code_context_ratio, session.event_count,
                    json.dumps(session.tools_used), json.dumps(dict(session.file_extensions)),
                    json.dumps(session.commands), json.dumps(session.tool_sequence), now,
                ),
            )
        else:
            old = dict(existing)
            old_count = old.get("event_count") or 0
            new_count = session.event_count
            total_count = old_count + new_count

            merged_tools = list(
                set(json.loads(old.get("tools_json") or "[]")) | set(session.tools_used)
            )
            merged_ext = _Counter(json.loads(old.get("extensions_json") or "{}")) + session.file_extensions
            old_cmds = json.loads(old.get("commands_json") or "[]")
            merged_cmds = old_cmds + [c for c in session.commands if c not in old_cmds]
            merged_seq = json.loads(old.get("tool_sequence_json") or "[]") + session.tool_sequence

            if total_count > 0:
                merged_prompt = (
                    (old.get("avg_prompt_length") or 0.0) * old_count
                    + session.avg_prompt_length * new_count
                ) / total_count
                merged_ctx = (
                    (old.get("has_code_context_ratio") or 0.0) * old_count
                    + session.has_code_context_ratio * new_count
                ) / total_count
            else:
                merged_prompt = session.avg_prompt_length
                merged_ctx = session.has_code_context_ratio

            ended_at = session.ended_at.isoformat() if session.ended_at else old.get("ended_at")
            duration = max(session.duration_minutes, old.get("duration_minutes") or 0.0)
            total_turns = session.total_turns or (old.get("total_turns") or 0)
            has_test = int(session.has_test_context or bool(old.get("has_test_context")))

            conn.execute(
                """
                UPDATE sessions SET
                    ended_at = ?, duration_minutes = ?, total_turns = ?,
                    project_category = ?, project_confidence = ?, workflow_pattern = ?,
                    has_test_context = ?, avg_prompt_length = ?, has_code_context_ratio = ?,
                    event_count = ?, tools_json = ?, extensions_json = ?, commands_json = ?,
                    tool_sequence_json = ?, processed_at = ?
                WHERE id = ?
                """,
                (
                    ended_at, duration, total_turns,
                    session.project_category, session.project_confidence, session.workflow_pattern,
                    has_test, merged_prompt, merged_ctx, total_count,
                    json.dumps(merged_tools), json.dumps(dict(merged_ext)), json.dumps(merged_cmds),
                    json.dumps(merged_seq), now, session.session_id,
                ),
            )
        conn.commit()

    def get_existing_session_ids(self) -> set[str]:
        rows = self.connect().execute("SELECT id FROM sessions").fetchall()
        return {row["id"] for row in rows}

    def get_session_tool_sequence(self, session_id: str) -> list[str]:
        row = self.connect().execute(
            "SELECT tool_sequence_json FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row is None:
            return []
        try:
            return json.loads(row["tool_sequence_json"] or "[]")
        except (json.JSONDecodeError, TypeError):
            return []

    def get_all_sessions_as_objects(self) -> list[Session]:
        """Reconstruct lightweight Session objects from DB for scoring."""
        from collections import Counter
        rows = self.connect().execute("SELECT * FROM sessions ORDER BY started_at").fetchall()
        sessions = []
        for row in rows:
            r = dict(row)
            try:
                started = datetime.fromisoformat(r["started_at"])
            except ValueError:
                continue
            ended = datetime.fromisoformat(r["ended_at"]) if r.get("ended_at") else None
            s = Session(
                session_id=r["id"],
                source=r["source"],
                started_at=started,
                ended_at=ended,
                duration_minutes=r.get("duration_minutes") or 0.0,
                total_turns=r.get("total_turns") or 0,
                cwd_hash=r.get("cwd_hash") or "",
                has_test_context=bool(r.get("has_test_context")),
                project_category=r.get("project_category") or "unknown",
                project_confidence=r.get("project_confidence") or 0.0,
                workflow_pattern=r.get("workflow_pattern") or "unknown",
                avg_prompt_length=r.get("avg_prompt_length") or 0.0,
                has_code_context_ratio=r.get("has_code_context_ratio") or 0.0,
                event_count=r.get("event_count") or 0,
            )
            try:
                s.tools_used = json.loads(r.get("tools_json") or "[]")
                s.file_extensions = Counter(json.loads(r.get("extensions_json") or "{}"))
                s.commands = json.loads(r.get("commands_json") or "[]")
                s.tool_sequence = json.loads(r.get("tool_sequence_json") or "[]")
            except (json.JSONDecodeError, TypeError):
                pass
            sessions.append(s)
        return sessions

    def count_sessions(self) -> int:
        row = self.connect().execute("SELECT COUNT(*) AS n FROM sessions").fetchone()
        return row["n"] if row else 0

    def count_sessions_on_date(self, date_str: str) -> int:
        row = self.connect().execute(
            "SELECT COUNT(*) AS n FROM sessions WHERE started_at LIKE ?",
            (f"{date_str}%",),
        ).fetchone()
        return row["n"] if row else 0

    # ── signals ───────────────────────────────────────────────────────────────

    def save_signals(self, session_id: str, signals: list[Signal]) -> None:
        conn = self.connect()
        conn.execute("DELETE FROM technical_signals WHERE session_id = ?", (session_id,))
        conn.executemany(
            "INSERT INTO technical_signals (session_id, signal_type, signal_value, occurrences) VALUES (?, ?, ?, ?)",
            [(session_id, s.signal_type, s.signal_value, s.occurrences) for s in signals],
        )
        conn.commit()

    def get_all_signals(self) -> list[dict]:
        rows = self.connect().execute("SELECT * FROM technical_signals").fetchall()
        return [dict(row) for row in rows]

    def get_distinct_signal_values(self, signal_type: str) -> set[str]:
        rows = self.connect().execute(
            "SELECT DISTINCT signal_value FROM technical_signals WHERE signal_type = ?",
            (signal_type,),
        ).fetchall()
        return {row["signal_value"] for row in rows}

    # ── scores ────────────────────────────────────────────────────────────────

    def save_scores(self, scores: Scores) -> None:
        conn = self.connect()
        conn.execute(
            """
            INSERT OR REPLACE INTO scores
            (date, prompt_quality, test_maturity, tech_breadth, growth_rate, overall, sessions_analyzed)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                scores.date,
                scores.prompt_quality,
                scores.test_maturity,
                scores.tech_breadth,
                scores.growth_rate,
                scores.overall,
                scores.sessions_analyzed,
            ),
        )
        conn.commit()

    def get_scores(self, date: str) -> Optional[Scores]:
        row = self.connect().execute(
            "SELECT * FROM scores WHERE date = ?", (date,)
        ).fetchone()
        if row is None:
            return None
        return _row_to_scores(dict(row))

    def get_current_scores(self) -> Optional[Scores]:
        row = self.connect().execute(
            "SELECT * FROM scores ORDER BY date DESC LIMIT 1"
        ).fetchone()
        return _row_to_scores(dict(row)) if row else None

    def get_scores_history(self, days: int = 30) -> list[Scores]:
        rows = self.connect().execute(
            "SELECT * FROM scores ORDER BY date DESC LIMIT ?", (days,)
        ).fetchall()
        return [_row_to_scores(dict(r)) for r in rows]

    # ── profile ───────────────────────────────────────────────────────────────

    def get_profile(self, key: str) -> Optional[str]:
        row = self.connect().execute(
            "SELECT value FROM profile WHERE key = ?", (key,)
        ).fetchone()
        return row["value"] if row else None

    def set_profile(self, key: str, value: str) -> None:
        conn = self.connect()
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT OR REPLACE INTO profile (key, value, updated_at) VALUES (?, ?, ?)",
            (key, value, now),
        )
        conn.commit()

    def get_all_profile(self) -> dict[str, str]:
        rows = self.connect().execute("SELECT key, value FROM profile").fetchall()
        return {row["key"]: row["value"] for row in rows}


def _row_to_scores(r: dict) -> Scores:
    return Scores(
        date=r["date"],
        prompt_quality=r["prompt_quality"] or 0,
        test_maturity=r["test_maturity"] or 0,
        tech_breadth=r["tech_breadth"] or 0,
        growth_rate=r["growth_rate"] or 0,
        overall=r["overall"] or 0,
        sessions_analyzed=r["sessions_analyzed"] or 0,
    )

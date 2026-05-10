from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

DB_PATH = Path.home() / ".devprofile" / "profile.db"

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
    def __init__(self, db_path: Path = DB_PATH) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn: Optional[sqlite3.Connection] = None

    def connect(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
            self._conn.row_factory = sqlite3.Row
        return self._conn

    def init_schema(self) -> None:
        self.connect().executescript(SCHEMA_SQL)

    def close(self) -> None:
        if self._conn:
            self._conn.close()
            self._conn = None

    # ── sessions ─────────────────────────────────────────────────────────────

    def get_existing_session_ids(self) -> set[str]:
        rows = self.connect().execute("SELECT id FROM sessions").fetchall()
        return {row["id"] for row in rows}

    def save_session(
        self,
        session_id: str,
        source: str,
        started_at: datetime,
        ended_at: Optional[datetime],
        duration_minutes: float,
        total_turns: int,
        cwd_hash: str,
        project_category: str,
        project_confidence: float,
        workflow_pattern: str,
    ) -> None:
        conn = self.connect()
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            """
            INSERT OR REPLACE INTO sessions
            (id, source, started_at, ended_at, duration_minutes, total_turns, cwd_hash,
             project_category, project_confidence, workflow_pattern, processed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id,
                source,
                started_at.isoformat(),
                ended_at.isoformat() if ended_at else None,
                duration_minutes,
                total_turns,
                cwd_hash,
                project_category,
                project_confidence,
                workflow_pattern,
                now,
            ),
        )
        conn.commit()

    def get_all_sessions(self) -> list[dict]:
        rows = self.connect().execute("SELECT * FROM sessions").fetchall()
        return [dict(row) for row in rows]

    def count_sessions(self) -> int:
        row = self.connect().execute("SELECT COUNT(*) AS n FROM sessions").fetchone()
        return row["n"] if row else 0

    def count_sessions_on_date(self, date_str: str) -> int:
        row = self.connect().execute(
            "SELECT COUNT(*) AS n FROM sessions WHERE started_at LIKE ?",
            (f"{date_str}%",),
        ).fetchone()
        return row["n"] if row else 0

    # ── signals ──────────────────────────────────────────────────────────────

    def save_signals(self, session_id: str, signals: list[tuple[str, str, int]]) -> None:
        conn = self.connect()
        conn.execute("DELETE FROM technical_signals WHERE session_id = ?", (session_id,))
        conn.executemany(
            "INSERT INTO technical_signals (session_id, signal_type, signal_value, occurrences) VALUES (?, ?, ?, ?)",
            [(session_id, t, v, n) for t, v, n in signals],
        )
        conn.commit()

    def get_all_signals(self) -> list[dict]:
        rows = self.connect().execute("SELECT * FROM technical_signals").fetchall()
        return [dict(row) for row in rows]

    # ── scores ───────────────────────────────────────────────────────────────

    def save_scores(
        self,
        date: str,
        prompt_quality: int,
        test_maturity: int,
        tech_breadth: int,
        growth_rate: int,
        overall: int,
        sessions_analyzed: int,
    ) -> None:
        conn = self.connect()
        conn.execute(
            """
            INSERT OR REPLACE INTO scores
            (date, prompt_quality, test_maturity, tech_breadth, growth_rate, overall, sessions_analyzed)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (date, prompt_quality, test_maturity, tech_breadth, growth_rate, overall, sessions_analyzed),
        )
        conn.commit()

    def get_current_scores(self) -> Optional[dict]:
        row = self.connect().execute("SELECT * FROM scores ORDER BY date DESC LIMIT 1").fetchone()
        return dict(row) if row else None

    def get_scores_history(self, days: int = 30) -> list[dict]:
        rows = self.connect().execute(
            "SELECT * FROM scores ORDER BY date DESC LIMIT ?", (days,)
        ).fetchall()
        return [dict(row) for row in rows]

    # ── profile ──────────────────────────────────────────────────────────────

    def update_profile(self, key: str, value: str) -> None:
        conn = self.connect()
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT OR REPLACE INTO profile (key, value, updated_at) VALUES (?, ?, ?)",
            (key, value, now),
        )
        conn.commit()

    def get_profile(self) -> dict[str, str]:
        rows = self.connect().execute("SELECT key, value FROM profile").fetchall()
        return {row["key"]: row["value"] for row in rows}

    def get_profile_value(self, key: str) -> Optional[str]:
        row = self.connect().execute(
            "SELECT value FROM profile WHERE key = ?", (key,)
        ).fetchone()
        return row["value"] if row else None

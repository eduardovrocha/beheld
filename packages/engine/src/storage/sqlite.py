from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional, Union

import os

from models import Scores, Session, Signal, WorkflowMetrics

_DATA_HOME = Path(os.environ.get("DEVPROFILE_DATA_DIR", Path.home()))
DB_PATH = _DATA_HOME / ".devprofile" / "profile.db"

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS workflow_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    computed_at TEXT NOT NULL,
    period_days INTEGER NOT NULL,
    sessions_analyzed INTEGER NOT NULL,
    metrics_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_metrics_computed_at
    ON workflow_metrics(computed_at);

CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL UNIQUE,
    previous_hash TEXT,
    created_at TEXT NOT NULL,
    bundle_path TEXT,
    payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON snapshots(created_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_previous_hash ON snapshots(previous_hash);
"""


@dataclass(frozen=True)
class Migration:
    version: int
    description: str
    apply: Callable[[sqlite3.Connection], None]


def _migration_1_add_tool_sequence_json(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(sessions)").fetchall()}
    if "tool_sequence_json" not in cols:
        conn.execute("ALTER TABLE sessions ADD COLUMN tool_sequence_json TEXT DEFAULT '[]'")


def _migration_2_add_workflow_metrics(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS workflow_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            computed_at TEXT NOT NULL,
            period_days INTEGER NOT NULL,
            sessions_analyzed INTEGER NOT NULL,
            metrics_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_workflow_metrics_computed_at
            ON workflow_metrics(computed_at);
        """
    )


def _migration_3_add_snapshots(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hash TEXT NOT NULL UNIQUE,
            previous_hash TEXT,
            created_at TEXT NOT NULL,
            bundle_path TEXT,
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON snapshots(created_at);
        CREATE INDEX IF NOT EXISTS idx_snapshots_previous_hash ON snapshots(previous_hash);
        """
    )


MIGRATIONS: list[Migration] = [
    Migration(1, "add tool_sequence_json to sessions", _migration_1_add_tool_sequence_json),
    Migration(2, "add workflow_metrics table", _migration_2_add_workflow_metrics),
    Migration(3, "add snapshots table (chain of .dpbundle)", _migration_3_add_snapshots),
]

LATEST_SCHEMA_VERSION = max((m.version for m in MIGRATIONS), default=0)


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
        self._migrate()

    def current_schema_version(self) -> int:
        conn = self.connect()
        try:
            row = conn.execute("SELECT MAX(version) AS v FROM schema_version").fetchone()
        except sqlite3.OperationalError:
            return 0
        if row is None or row["v"] is None:
            return 0
        return int(row["v"])

    def _migrate(self) -> None:
        conn = self.connect()
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                description TEXT NOT NULL,
                applied_at TEXT NOT NULL
            )
            """
        )
        conn.commit()

        current = self.current_schema_version()
        for migration in MIGRATIONS:
            if migration.version <= current:
                continue
            migration.apply(conn)
            conn.execute(
                "INSERT INTO schema_version (version, description, applied_at) VALUES (?, ?, ?)",
                (
                    migration.version,
                    migration.description,
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
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

    # ── workflow_metrics ──────────────────────────────────────────────────────

    def save_workflow_metrics(
        self,
        metrics: WorkflowMetrics,
        period_days: int,
        sessions_analyzed: int,
    ) -> None:
        from dataclasses import asdict
        conn = self.connect()
        now = datetime.now(timezone.utc).isoformat()
        canonical = json.dumps(asdict(metrics), sort_keys=True, separators=(",", ":"))
        conn.execute(
            """
            INSERT INTO workflow_metrics
            (computed_at, period_days, sessions_analyzed, metrics_json)
            VALUES (?, ?, ?, ?)
            """,
            (now, period_days, sessions_analyzed, canonical),
        )
        conn.commit()

    def get_latest_workflow_metrics(self) -> Optional[dict]:
        row = self.connect().execute(
            "SELECT * FROM workflow_metrics ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if row is None:
            return None
        return {
            "computed_at": row["computed_at"],
            "period_days": row["period_days"],
            "sessions_analyzed": row["sessions_analyzed"],
            "metrics": WorkflowMetrics.from_dict(json.loads(row["metrics_json"])),
        }

    def count_workflow_metrics(self) -> int:
        row = self.connect().execute(
            "SELECT COUNT(*) AS n FROM workflow_metrics"
        ).fetchone()
        return row["n"] if row else 0

    # ── snapshots (Phase 5 — .dpbundle chain) ─────────────────────────────────

    def save_snapshot(
        self,
        bundle_hash: str,
        previous_hash: Optional[str],
        payload_json: str,
        bundle_path: Optional[str] = None,
    ) -> int:
        """Persist a snapshot entry; returns the new row id.

        `bundle_hash` is the SHA-256 of `payload_json` prefixed with 'sha256:'.
        `previous_hash` is None only for the genesis snapshot.
        `bundle_path` may be None if the bundle file is managed elsewhere.
        """
        conn = self.connect()
        now = datetime.now(timezone.utc).isoformat()
        cur = conn.execute(
            """
            INSERT INTO snapshots (hash, previous_hash, created_at, bundle_path, payload_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            (bundle_hash, previous_hash, now, bundle_path, payload_json),
        )
        conn.commit()
        return cur.lastrowid or 0

    def get_latest_snapshot(self) -> Optional[dict]:
        row = self.connect().execute(
            "SELECT * FROM snapshots ORDER BY id DESC LIMIT 1"
        ).fetchone()
        return dict(row) if row else None

    def get_snapshot_by_hash(self, bundle_hash: str) -> Optional[dict]:
        row = self.connect().execute(
            "SELECT * FROM snapshots WHERE hash = ?", (bundle_hash,)
        ).fetchone()
        return dict(row) if row else None

    def list_snapshots(self, limit: int = 100) -> list[dict]:
        rows = self.connect().execute(
            "SELECT id, hash, previous_hash, created_at, bundle_path "
            "FROM snapshots ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    def count_snapshots(self) -> int:
        row = self.connect().execute("SELECT COUNT(*) AS n FROM snapshots").fetchone()
        return row["n"] if row else 0

    def validate_chain(self) -> dict:
        """Walk all snapshots in creation order; detect tampering.

        Two failure modes:
          - content_mismatch: stored `hash` doesn't match SHA-256 of `payload_json`
            (someone changed the payload but didn't re-hash).
          - link_mismatch:    `previous_hash` doesn't point to the prior row's hash
            (chain link broken — snapshot inserted, removed, or reordered).

        Returns {ok, snapshots_checked, broken_at?}.
        """
        rows = self.connect().execute(
            "SELECT id, hash, previous_hash, payload_json "
            "FROM snapshots ORDER BY id ASC"
        ).fetchall()

        prev_hash: Optional[str] = None
        for i, row in enumerate(rows):
            stored_hash = row["hash"]
            payload = row["payload_json"]
            computed = "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()
            if computed != stored_hash:
                return {
                    "ok": False,
                    "snapshots_checked": i,
                    "broken_at": {"hash": stored_hash, "reason": "content_mismatch"},
                }
            if row["previous_hash"] != prev_hash:
                return {
                    "ok": False,
                    "snapshots_checked": i,
                    "broken_at": {"hash": stored_hash, "reason": "link_mismatch"},
                }
            prev_hash = stored_hash

        return {"ok": True, "snapshots_checked": len(rows), "broken_at": None}

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

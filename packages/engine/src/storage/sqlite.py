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

_DATA_HOME = Path(os.environ.get("BEHELD_DATA_DIR", Path.home()))
DB_PATH = _DATA_HOME / ".beheld" / "profile.db"

# `tool_sequence_json` is appended every time `save_session` merges a new
# update.  Without a cap, a long-running session that survives many writes
# bloats the DB (observed 2 GB in a single 27-session profile — see the
# spawned task spec).  The classifier only needs a recent window; older
# events past this length are dropped on every save.
MAX_TOOL_SEQUENCE_LEN = 2000

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

CREATE TABLE IF NOT EXISTS l1_repositories (
    root_commit_hash TEXT PRIMARY KEY,
    imported_at TEXT NOT NULL,
    commit_count INTEGER NOT NULL,
    author_email_hash TEXT NOT NULL,
    first_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS l1_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root_commit_hash TEXT NOT NULL REFERENCES l1_repositories(root_commit_hash),
    file_extensions TEXT NOT NULL DEFAULT '{}',
    ecosystems TEXT NOT NULL DEFAULT '{}',
    platforms TEXT NOT NULL DEFAULT '{}',
    test_ratio REAL NOT NULL DEFAULT 0.0,
    timing TEXT NOT NULL DEFAULT '{}',
    first_commit_at TEXT,
    last_commit_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_l1_signals_repo ON l1_signals(root_commit_hash);

-- R1.2a — per-month commit counts per repo. Powers the GrowthRateScorer
-- baseline (first 12 months) vs current (last 6 months) window comparison
-- introduced in spec §7.2. Ecosystems/platforms/test_ratio per-month are
-- derived in get_l1_monthly_buckets() by joining with l1_signals (every
-- month a repo contributed inherits its global ecosystems/platforms and
-- its commit_count-weighted test_ratio). distinct_repos per window comes
-- from the repo_hashes set of buckets in that window.
CREATE TABLE IF NOT EXISTS l1_monthly_buckets (
    root_commit_hash TEXT NOT NULL REFERENCES l1_repositories(root_commit_hash),
    month TEXT NOT NULL,           -- ISO-8601 YYYY-MM
    commit_count INTEGER NOT NULL,
    PRIMARY KEY (root_commit_hash, month)
);
CREATE INDEX IF NOT EXISTS idx_l1_monthly_buckets_month ON l1_monthly_buckets(month);

CREATE TABLE IF NOT EXISTS identity_phrases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER UNIQUE REFERENCES snapshots(id),
    long TEXT NOT NULL,
    short TEXT NOT NULL,
    confidence TEXT NOT NULL,
    generation_path TEXT NOT NULL,
    model_used TEXT,
    generated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_identity_path ON identity_phrases(generation_path);

CREATE VIEW IF NOT EXISTS l1_aggregated AS
SELECT
    (SELECT COUNT(*) FROM l1_repositories) AS total_repos,
    (SELECT COALESCE(SUM(commit_count), 0) FROM l1_repositories) AS total_commits,
    (SELECT MIN(first_commit_at) FROM l1_signals WHERE first_commit_at IS NOT NULL) AS earliest_commit,
    (SELECT MAX(last_commit_at) FROM l1_signals WHERE last_commit_at IS NOT NULL) AS latest_commit,
    (SELECT COALESCE(json_group_array(json(file_extensions)), '[]') FROM l1_signals) AS all_extensions_json,
    (SELECT COALESCE(json_group_array(json(ecosystems)), '[]') FROM l1_signals) AS all_ecosystems_json,
    (SELECT COALESCE(json_group_array(json(platforms)), '[]') FROM l1_signals) AS all_platforms_json,
    (SELECT COALESCE(AVG(test_ratio), 0.0) FROM l1_signals) AS avg_test_ratio;

CREATE TABLE IF NOT EXISTS l1_language_weights (
    root_commit_hash TEXT NOT NULL REFERENCES l1_repositories(root_commit_hash),
    language TEXT NOT NULL,
    commit_count INTEGER NOT NULL,
    file_count INTEGER NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    PRIMARY KEY (root_commit_hash, language)
);

CREATE INDEX IF NOT EXISTS idx_l1_language_weights_lang
    ON l1_language_weights(language);

CREATE TABLE IF NOT EXISTS l1_architecture_patterns (
    root_commit_hash TEXT NOT NULL REFERENCES l1_repositories(root_commit_hash),
    pattern TEXT NOT NULL,
    confidence TEXT NOT NULL,
    PRIMARY KEY (root_commit_hash, pattern)
);

CREATE INDEX IF NOT EXISTS idx_l1_arch_patterns_pattern
    ON l1_architecture_patterns(pattern);
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


def _migration_5_truncate_tool_sequences(conn: sqlite3.Connection) -> None:
    """Auto-heal databases where `tool_sequence_json` grew unbounded before
    `MAX_TOOL_SEQUENCE_LEN` was introduced.  We slice the JSON in Python so
    we don't rely on the SQLite JSON1 extension being compiled in."""
    rows = conn.execute(
        "SELECT id, tool_sequence_json FROM sessions "
        "WHERE length(tool_sequence_json) > ?",
        (MAX_TOOL_SEQUENCE_LEN * 50,),  # >50 bytes/event ≈ way more than fits
    ).fetchall()
    for row_id, raw in rows:
        try:
            seq = json.loads(raw or "[]")
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(seq, list) or len(seq) <= MAX_TOOL_SEQUENCE_LEN:
            continue
        conn.execute(
            "UPDATE sessions SET tool_sequence_json = ? WHERE id = ?",
            (json.dumps(seq[-MAX_TOOL_SEQUENCE_LEN:]), row_id),
        )
    # Reclaim the space — without VACUUM the rows shrink but the file doesn't.
    # Must run outside the active transaction; the migration runner commits
    # right after `apply` returns, so we leave VACUUM to the explicit caller
    # of init_schema.  Marking via a flag lets _migrate() handle it cleanly.
    conn.execute("CREATE TEMP TABLE IF NOT EXISTS _pending_vacuum (id INTEGER)")
    conn.execute("INSERT INTO _pending_vacuum VALUES (1)")


def _migration_4_add_l1_tables(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS l1_repositories (
            root_commit_hash TEXT PRIMARY KEY,
            imported_at TEXT NOT NULL,
            commit_count INTEGER NOT NULL,
            author_email_hash TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS l1_signals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            root_commit_hash TEXT NOT NULL REFERENCES l1_repositories(root_commit_hash),
            file_extensions TEXT NOT NULL DEFAULT '{}',
            ecosystems TEXT NOT NULL DEFAULT '{}',
            platforms TEXT NOT NULL DEFAULT '{}',
            test_ratio REAL NOT NULL DEFAULT 0.0,
            timing TEXT NOT NULL DEFAULT '{}',
            first_commit_at TEXT,
            last_commit_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_l1_signals_repo ON l1_signals(root_commit_hash);

        CREATE VIEW IF NOT EXISTS l1_aggregated AS
        SELECT
            (SELECT COUNT(*) FROM l1_repositories) AS total_repos,
            (SELECT COALESCE(SUM(commit_count), 0) FROM l1_repositories) AS total_commits,
            (SELECT MIN(first_commit_at) FROM l1_signals WHERE first_commit_at IS NOT NULL) AS earliest_commit,
            (SELECT MAX(last_commit_at) FROM l1_signals WHERE last_commit_at IS NOT NULL) AS latest_commit,
            (SELECT COALESCE(json_group_array(json(file_extensions)), '[]') FROM l1_signals) AS all_extensions_json,
            (SELECT COALESCE(json_group_array(json(ecosystems)), '[]') FROM l1_signals) AS all_ecosystems_json,
            (SELECT COALESCE(json_group_array(json(platforms)), '[]') FROM l1_signals) AS all_platforms_json,
            (SELECT COALESCE(AVG(test_ratio), 0.0) FROM l1_signals) AS avg_test_ratio;
        """
    )


def _migration_7_add_first_seen_at(conn: sqlite3.Connection) -> None:
    """F5.7.2 — record when each repo was first imported.

    Backfills existing rows from imported_at so older databases keep a stable
    timestamp on the first migration. New rows write first_seen_at = imported_at
    at insert time."""
    cols = {row[1] for row in conn.execute("PRAGMA table_info(l1_repositories)").fetchall()}
    if "first_seen_at" not in cols:
        conn.execute("ALTER TABLE l1_repositories ADD COLUMN first_seen_at TEXT")
    conn.execute(
        "UPDATE l1_repositories SET first_seen_at = imported_at WHERE first_seen_at IS NULL"
    )


def _migration_6_add_identity_phrases(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS identity_phrases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_id INTEGER UNIQUE REFERENCES snapshots(id),
            long TEXT NOT NULL,
            short TEXT NOT NULL,
            confidence TEXT NOT NULL,
            generation_path TEXT NOT NULL,
            model_used TEXT,
            generated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_identity_path
            ON identity_phrases(generation_path);
        """
    )


def _migration_8_add_stack_tables(conn: sqlite3.Connection) -> None:
    """F6.12a — language-weight + architecture-pattern tables per repo."""
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS l1_language_weights (
            root_commit_hash TEXT NOT NULL
                REFERENCES l1_repositories(root_commit_hash),
            language TEXT NOT NULL,
            commit_count INTEGER NOT NULL,
            file_count INTEGER NOT NULL,
            first_seen TEXT NOT NULL,
            last_seen TEXT NOT NULL,
            PRIMARY KEY (root_commit_hash, language)
        );

        CREATE INDEX IF NOT EXISTS idx_l1_language_weights_lang
            ON l1_language_weights(language);

        CREATE TABLE IF NOT EXISTS l1_architecture_patterns (
            root_commit_hash TEXT NOT NULL
                REFERENCES l1_repositories(root_commit_hash),
            pattern TEXT NOT NULL,
            confidence TEXT NOT NULL,
            PRIMARY KEY (root_commit_hash, pattern)
        );

        CREATE INDEX IF NOT EXISTS idx_l1_arch_patterns_pattern
            ON l1_architecture_patterns(pattern);
        """
    )


def _migration_9_add_monthly_buckets(conn: sqlite3.Connection) -> None:
    """R1.2a — per-month commit counts per repo, powering GrowthRateScorer
    baseline (first 12 months) vs current (last 6 months) windows per
    spec §7.2. Legacy repos (imported before R1.2a) have NO rows in this
    table; the GrowthRateScorer returns None for users with empty
    monthly_buckets until they re-import. No backfill is attempted —
    raw commit timestamps were never persisted in earlier phases."""
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS l1_monthly_buckets (
            root_commit_hash TEXT NOT NULL
                REFERENCES l1_repositories(root_commit_hash),
            month TEXT NOT NULL,
            commit_count INTEGER NOT NULL,
            PRIMARY KEY (root_commit_hash, month)
        );

        CREATE INDEX IF NOT EXISTS idx_l1_monthly_buckets_month
            ON l1_monthly_buckets(month);
        """
    )


MIGRATIONS: list[Migration] = [
    Migration(1, "add tool_sequence_json to sessions", _migration_1_add_tool_sequence_json),
    Migration(2, "add workflow_metrics table", _migration_2_add_workflow_metrics),
    Migration(3, "add snapshots table (chain of .beheld)", _migration_3_add_snapshots),
    Migration(4, "add L1 tables (repositories + signals + aggregated view)", _migration_4_add_l1_tables),
    Migration(5, "truncate runaway tool_sequence_json (cap to MAX_TOOL_SEQUENCE_LEN)",
              _migration_5_truncate_tool_sequences),
    Migration(6, "add identity_phrases table", _migration_6_add_identity_phrases),
    Migration(7, "add first_seen_at to l1_repositories (F5.7.2)", _migration_7_add_first_seen_at),
    Migration(8, "add l1 stack tables (language_weights + architecture_patterns) F6.12a",
              _migration_8_add_stack_tables),
    Migration(9, "add l1_monthly_buckets (R1.2a — GrowthRateScorer windows)",
              _migration_9_add_monthly_buckets),
]

LATEST_SCHEMA_VERSION = max((m.version for m in MIGRATIONS), default=0)


class BeheldDB:
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
            if not self._in_memory:
                # WAL lets the periodic processor and on-demand readers/writers
                # (L1 import, MCP tool queries) coexist without "database is
                # locked"; busy_timeout gives any contender 5s to wait out a
                # concurrent transaction instead of failing immediately.
                self._conn.execute("PRAGMA journal_mode=WAL")
                self._conn.execute("PRAGMA busy_timeout=5000")
                self._conn.execute("PRAGMA synchronous=NORMAL")
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

        # If any migration flagged a pending VACUUM (e.g. migration 5 after
        # truncating bloated rows), run it now so disk space is reclaimed.
        pending = conn.execute(
            "SELECT name FROM sqlite_temp_master WHERE name = '_pending_vacuum'"
        ).fetchone()
        if pending is not None:
            conn.execute("DROP TABLE _pending_vacuum")
            # VACUUM requires no open transaction — sqlite3 auto-begins one on
            # mutating statements, so commit first.
            conn.commit()
            try:
                conn.execute("VACUUM")
            except sqlite3.OperationalError:
                # In-memory DBs or rare lock states — skip; the row-level
                # truncate already capped the data, only disk reclaim is lost.
                pass

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
            # Cap at the most recent window — unbounded growth ate 2 GB in a
            # real-world session before this fix.
            if len(merged_seq) > MAX_TOOL_SEQUENCE_LEN:
                merged_seq = merged_seq[-MAX_TOOL_SEQUENCE_LEN:]

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

    # ── snapshots (Phase 5 — .beheld chain) ─────────────────────────────────

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

    # ── L1 (git repository signals) ───────────────────────────────────────────

    def save_l1_repository(
        self,
        root_commit_hash: str,
        imported_at: str,
        commit_count: int,
        author_email_hash: str,
    ) -> bool:
        """Idempotent insert. Returns True if a new row was created, False if a
        repository with this root_commit_hash already exists.

        On first insert, first_seen_at is set equal to imported_at; on re-import
        the existing row is preserved (INSERT OR IGNORE), so first_seen_at stays
        anchored to the first time the repo entered the L1 (F5.7.2)."""
        conn = self.connect()
        cur = conn.execute(
            """
            INSERT OR IGNORE INTO l1_repositories
            (root_commit_hash, imported_at, commit_count, author_email_hash, first_seen_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (root_commit_hash, imported_at, commit_count, author_email_hash, imported_at),
        )
        conn.commit()
        return cur.rowcount > 0

    def save_l1_signals(
        self,
        root_commit_hash: str,
        file_extensions: dict,
        ecosystems: dict,
        platforms: dict,
        test_ratio: float,
        timing: dict,
        first_commit_at: Optional[str],
        last_commit_at: Optional[str],
    ) -> None:
        """Replace existing signals for a repo with a fresh row (1:1 with
        l1_repositories)."""
        conn = self.connect()
        conn.execute("DELETE FROM l1_signals WHERE root_commit_hash = ?", (root_commit_hash,))
        conn.execute(
            """
            INSERT INTO l1_signals
            (root_commit_hash, file_extensions, ecosystems, platforms,
             test_ratio, timing, first_commit_at, last_commit_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                root_commit_hash,
                json.dumps(file_extensions, sort_keys=True),
                json.dumps(ecosystems, sort_keys=True),
                json.dumps(platforms, sort_keys=True),
                float(test_ratio),
                json.dumps(timing, sort_keys=True),
                first_commit_at,
                last_commit_at,
            ),
        )
        conn.commit()

    def get_l1_summary(self) -> dict:
        """Aggregate L1 signals across all imported repos. Safe on empty DB."""
        row = self.connect().execute("SELECT * FROM l1_aggregated").fetchone()
        if row is None:
            return {
                "total_repos": 0,
                "total_commits": 0,
                "earliest_commit": None,
                "latest_commit": None,
                "extensions_merged": {},
                "ecosystems_merged": {},
                "platforms_merged": {},
                "avg_test_ratio": 0.0,
            }

        ext_arr = json.loads(row["all_extensions_json"] or "[]")
        eco_arr = json.loads(row["all_ecosystems_json"] or "[]")
        plat_arr = json.loads(row["all_platforms_json"] or "[]")

        extensions_merged: dict[str, int] = {}
        for d in ext_arr:
            for k, v in d.items():
                extensions_merged[k] = extensions_merged.get(k, 0) + int(v)

        ecosystems_merged: dict[str, bool] = {}
        for d in eco_arr:
            for k, v in d.items():
                if v:
                    ecosystems_merged[k] = True

        platforms_merged: dict[str, bool] = {}
        for d in plat_arr:
            for k, v in d.items():
                if v:
                    platforms_merged[k] = True

        return {
            "total_repos": int(row["total_repos"] or 0),
            "total_commits": int(row["total_commits"] or 0),
            "earliest_commit": row["earliest_commit"],
            "latest_commit": row["latest_commit"],
            "extensions_merged": extensions_merged,
            "ecosystems_merged": ecosystems_merged,
            "platforms_merged": platforms_merged,
            "avg_test_ratio": float(row["avg_test_ratio"] or 0.0),
            "monthly_buckets": self.get_l1_monthly_buckets(),
        }

    def save_l1_monthly_buckets(
        self,
        root_commit_hash: str,
        commits_by_month: dict[str, int],
    ) -> None:
        """R1.2a — store per-month commit counts for a repo. Replaces any
        existing rows for the same repo (idempotent re-import).

        `commits_by_month` is `{"YYYY-MM": commit_count, ...}`. Empty
        months are NOT inserted. Callers compute this from the git log
        timestamps in `git_extractor.extract`."""
        conn = self.connect()
        conn.execute(
            "DELETE FROM l1_monthly_buckets WHERE root_commit_hash = ?",
            (root_commit_hash,),
        )
        if not commits_by_month:
            conn.commit()
            return
        conn.executemany(
            "INSERT INTO l1_monthly_buckets "
            "(root_commit_hash, month, commit_count) VALUES (?, ?, ?)",
            [
                (root_commit_hash, month, int(count))
                for month, count in commits_by_month.items()
                if count > 0
            ],
        )
        conn.commit()

    def get_l1_monthly_buckets(self) -> dict[str, dict]:
        """R1.2a — return per-month rollup across all imported repos.

        Each month maps to a dict with:
          - commit_count (int): sum across repos
          - test_ratio (float): commit-count-weighted average across repos
          - ecosystems (list[str]): union from contributing repos
          - platforms (list[str]): union from contributing repos
          - repo_hashes (list[str]): set of repo hashes that contributed

        Empty dict when no monthly_buckets rows exist (legacy data — user
        hasn't re-imported since R1.2a)."""
        conn = self.connect()
        rows = conn.execute(
            """
            SELECT b.month, b.root_commit_hash, b.commit_count,
                   s.ecosystems, s.platforms, s.test_ratio
            FROM l1_monthly_buckets b
            JOIN l1_signals s
              ON s.root_commit_hash = b.root_commit_hash
            ORDER BY b.month
            """
        ).fetchall()
        out: dict[str, dict] = {}
        # Accumulators: month → {commits, weighted_test_sum, ecos, plats, repos}
        for r in rows:
            month = r["month"]
            slot = out.setdefault(
                month,
                {
                    "commit_count": 0,
                    "_weighted_test_sum": 0.0,
                    "ecosystems": set(),
                    "platforms": set(),
                    "repo_hashes": set(),
                },
            )
            n = int(r["commit_count"])
            slot["commit_count"] += n
            slot["_weighted_test_sum"] += float(r["test_ratio"] or 0.0) * n
            try:
                eco = json.loads(r["ecosystems"] or "{}")
                slot["ecosystems"].update(k for k, v in eco.items() if v)
            except (TypeError, json.JSONDecodeError):
                pass
            try:
                plat = json.loads(r["platforms"] or "{}")
                slot["platforms"].update(k for k, v in plat.items() if v)
            except (TypeError, json.JSONDecodeError):
                pass
            slot["repo_hashes"].add(r["root_commit_hash"])
        # Finalize: compute weighted avg test_ratio, convert sets to sorted lists.
        finalized: dict[str, dict] = {}
        for month, slot in out.items():
            commits = slot["commit_count"]
            test_avg = (slot["_weighted_test_sum"] / commits) if commits > 0 else 0.0
            finalized[month] = {
                "commit_count": commits,
                "test_ratio": test_avg,
                "ecosystems": sorted(slot["ecosystems"]),
                "platforms": sorted(slot["platforms"]),
                "repo_hashes": sorted(slot["repo_hashes"]),
            }
        return finalized

    def get_l1_repositories(self) -> list[dict]:
        rows = self.connect().execute(
            "SELECT root_commit_hash, imported_at, commit_count, first_seen_at "
            "FROM l1_repositories ORDER BY imported_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    def delete_l1_repository(self, root_commit_hash: str) -> bool:
        """Cascade-delete a repo and its signals. Returns True if a repo was
        removed, False if none existed with that hash."""
        conn = self.connect()
        conn.execute("DELETE FROM l1_signals WHERE root_commit_hash = ?", (root_commit_hash,))
        # F6.12a + R1.2a cascade — keep the FK constraint clean.
        conn.execute(
            "DELETE FROM l1_language_weights WHERE root_commit_hash = ?",
            (root_commit_hash,),
        )
        conn.execute(
            "DELETE FROM l1_architecture_patterns WHERE root_commit_hash = ?",
            (root_commit_hash,),
        )
        conn.execute(
            "DELETE FROM l1_monthly_buckets WHERE root_commit_hash = ?",
            (root_commit_hash,),
        )
        cur = conn.execute(
            "DELETE FROM l1_repositories WHERE root_commit_hash = ?", (root_commit_hash,)
        )
        conn.commit()
        return cur.rowcount > 0

    # ── L1 stack (F6.12a) ─────────────────────────────────────────────────────

    def save_l1_language_weights(
        self,
        root_commit_hash: str,
        weights: list,
    ) -> None:
        """Replace any existing language-weight rows for this repo.

        `weights` is a list of objects with attributes language, commit_count,
        file_count, first_seen, last_seen (typically `LanguageWeight` from
        the extractor, but any duck-typed object works for tests)."""
        conn = self.connect()
        conn.execute(
            "DELETE FROM l1_language_weights WHERE root_commit_hash = ?",
            (root_commit_hash,),
        )
        conn.executemany(
            """
            INSERT INTO l1_language_weights
            (root_commit_hash, language, commit_count, file_count, first_seen, last_seen)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    root_commit_hash,
                    w.language,
                    int(w.commit_count),
                    int(w.file_count),
                    w.first_seen,
                    w.last_seen,
                )
                for w in weights
            ],
        )
        conn.commit()

    def save_l1_architecture_patterns(
        self,
        root_commit_hash: str,
        patterns: list,
    ) -> None:
        """Replace any existing architecture-pattern rows for this repo.

        `patterns` is a list of objects with attributes pattern, confidence."""
        conn = self.connect()
        conn.execute(
            "DELETE FROM l1_architecture_patterns WHERE root_commit_hash = ?",
            (root_commit_hash,),
        )
        conn.executemany(
            """
            INSERT INTO l1_architecture_patterns
            (root_commit_hash, pattern, confidence)
            VALUES (?, ?, ?)
            """,
            [(root_commit_hash, p.pattern, p.confidence) for p in patterns],
        )
        conn.commit()

    def get_l1_stack(self) -> dict:
        """Aggregate language weights + architecture patterns across all
        imported repos. Returns the shape consumed by GET /l1/stack."""
        conn = self.connect()
        lang_rows = conn.execute(
            """
            SELECT language,
                   SUM(commit_count) AS total_commits,
                   SUM(file_count)   AS total_files,
                   MIN(first_seen)   AS first_seen,
                   MAX(last_seen)    AS last_seen
            FROM l1_language_weights
            GROUP BY language
            ORDER BY total_commits DESC, language ASC
            """
        ).fetchall()

        # Strong overrides weak when a pattern appears under both confidences
        # across different repos. MAX() on the raw text is wrong ("weak" >
        # "strong" lexicographically), so we rank explicitly with CASE.
        pattern_rows = conn.execute(
            """
            SELECT pattern,
                   COUNT(DISTINCT root_commit_hash) AS repo_count,
                   CASE WHEN MAX(CASE confidence WHEN 'strong' THEN 1 ELSE 0 END) = 1
                        THEN 'strong'
                        ELSE 'weak'
                   END AS confidence
            FROM l1_architecture_patterns
            GROUP BY pattern
            ORDER BY repo_count DESC, pattern ASC
            """
        ).fetchall()

        repos_analyzed = conn.execute(
            "SELECT COUNT(DISTINCT root_commit_hash) FROM l1_language_weights"
        ).fetchone()[0]

        total_commits = sum(int(r["total_commits"] or 0) for r in lang_rows)

        def _ym(iso_date: Optional[str]) -> str:
            return (iso_date or "")[:7]

        language_distribution = []
        for r in lang_rows:
            commits = int(r["total_commits"] or 0)
            pct = round((commits / total_commits) * 100, 1) if total_commits else 0.0
            language_distribution.append({
                "language": r["language"],
                "commit_count": commits,
                "file_count": int(r["total_files"] or 0),
                "first_seen": _ym(r["first_seen"]),
                "last_seen": _ym(r["last_seen"]),
                "weight_pct": pct,
            })

        architecture_patterns = [
            {
                "pattern": r["pattern"],
                "repo_count": int(r["repo_count"] or 0),
                "confidence": r["confidence"],
            }
            for r in pattern_rows
        ]

        return {
            "language_distribution": language_distribution,
            "architecture_patterns": architecture_patterns,
            "total_commits_analyzed": total_commits,
            "repos_analyzed": int(repos_analyzed or 0),
        }

    # ── identity_phrases (Phase 6 — public portrait) ──────────────────────────

    def save_identity_phrase(
        self,
        long: str,
        short: str,
        confidence: str,
        generation_path: str,
        model_used: Optional[str] = None,
        snapshot_id: Optional[int] = None,
    ) -> int:
        """Insert or replace the identity phrase for a snapshot.

        Returns the row id. Replace-on-snapshot semantics let the orchestrator
        regenerate a portrait without leaving orphan rows behind.
        """
        conn = self.connect()
        now = datetime.now(timezone.utc).isoformat()

        if snapshot_id is not None:
            conn.execute(
                "DELETE FROM identity_phrases WHERE snapshot_id = ?",
                (snapshot_id,),
            )

        cur = conn.execute(
            """
            INSERT INTO identity_phrases
            (snapshot_id, long, short, confidence, generation_path, model_used, generated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (snapshot_id, long, short, confidence, generation_path, model_used, now),
        )
        conn.commit()
        return cur.lastrowid or 0

    def get_identity_phrase(self, snapshot_id: int) -> Optional[dict]:
        row = self.connect().execute(
            "SELECT * FROM identity_phrases WHERE snapshot_id = ?",
            (snapshot_id,),
        ).fetchone()
        return dict(row) if row else None

    def get_latest_identity_phrase(self) -> Optional[dict]:
        row = self.connect().execute(
            "SELECT * FROM identity_phrases ORDER BY id DESC LIMIT 1"
        ).fetchone()
        return dict(row) if row else None

    def count_identity_phrases_by_path(self) -> dict[str, int]:
        rows = self.connect().execute(
            "SELECT generation_path, COUNT(*) AS n FROM identity_phrases GROUP BY generation_path"
        ).fetchall()
        return {row["generation_path"]: row["n"] for row in rows}

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

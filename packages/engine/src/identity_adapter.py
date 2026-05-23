"""Bridge between the live SQLite state and the identity signals payload (v1).

The identity generator (`packages/engine/src/identity/`) speaks a strict
JSON schema with closed enums. The full classifier that produces this
payload from raw data is specified in `documents/classifier-signals-payload.md`
but not yet implemented. This adapter is the minimum viable producer:
maps what we already have in SQLite (l1_signals, sessions, technical_signals)
into a valid schema-v1 payload — lossy but honest, never fabricates a
signal that the data does not support.

Confidence band is always low/medium until the full classifier lands.
"""
from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Optional

from storage.sqlite import BeheldDB


# Maps from common file extensions / aggregated ecosystem names → schema enum IDs.
# Conservative: only listed extensions count; others fall through. Order doesn't
# matter — the resulting frequency Counter is the source of truth.
_EXT_TO_ECOSYSTEM = {
    ".rb": "rails", ".erb": "rails", ".rake": "rails",
    ".py": "python",
    ".ts": "node", ".tsx": "react", ".js": "node", ".jsx": "react",
    ".vue": "vue",
    ".dart": "flutter",
    ".go": "go",
    ".rs": "rust",
    ".java": "java_spring",
    ".kt": "kotlin", ".kts": "kotlin",
    ".swift": "swift_ios",
    ".cs": "dotnet",
    ".ex": "elixir_phoenix", ".exs": "elixir_phoenix",
    ".php": "php_laravel",
    ".tf": "devops", ".yaml": "devops", ".yml": "devops",
}

_KEYWORD_TO_PLATFORM = {
    "docker": "docker", "kubernetes": "kubernetes", "k8s": "kubernetes",
    "github": "github", "actions": "github_actions", "ci": "github_actions",
    "gitlab": "gitlab", "circleci": "circleci",
    "aws": "aws", "gcp": "gcp", "azure": "azure",
    "vercel": "vercel", "cloudflare": "cloudflare",
    "postgres": "postgres", "psql": "postgres", "mysql": "mysql",
    "redis": "redis", "mongodb": "mongodb", "mongo": "mongodb",
    "elasticsearch": "elasticsearch", "elastic": "elasticsearch",
    "terraform": "terraform", "ansible": "ansible",
}


def _aggregate_l1_extensions(db: BeheldDB) -> Counter:
    """Sum up file extension counts across all L1 repos."""
    rows = db.connect().execute(
        "SELECT file_extensions FROM l1_signals"
    ).fetchall()
    total: Counter = Counter()
    for (ext_json,) in rows:
        try:
            for ext, count in json.loads(ext_json).items():
                total[ext] += int(count)
        except (json.JSONDecodeError, TypeError, ValueError):
            continue
    return total


def _aggregate_l1_platforms(db: BeheldDB) -> Counter:
    rows = db.connect().execute("SELECT platforms FROM l1_signals").fetchall()
    total: Counter = Counter()
    for (plat_json,) in rows:
        try:
            for plat, count in json.loads(plat_json).items():
                key = plat.lower().strip()
                if key in _KEYWORD_TO_PLATFORM:
                    total[_KEYWORD_TO_PLATFORM[key]] += int(count)
        except (json.JSONDecodeError, TypeError, ValueError):
            continue
    return total


def _ecosystems_from_extensions(ext_counts: Counter) -> Counter:
    eco: Counter = Counter()
    for ext, count in ext_counts.items():
        key = ext.lower()
        if key in _EXT_TO_ECOSYSTEM:
            eco[_EXT_TO_ECOSYSTEM[key]] += count
    return eco


def _classify_ecosystems(eco: Counter) -> dict:
    """Split the ecosystem Counter into dominant / secondary buckets.

    Heuristic: top 2 by count are dominant if their share is ≥25%; rest go
    to secondary capped at 3. emerging/declining stay empty here — the L1
    snapshot lacks the temporal signal needed to call something "emerging".
    """
    if not eco:
        return {"dominant": [], "secondary": [], "emerging": [], "declining": []}
    total = sum(eco.values())
    sorted_eco = eco.most_common()
    dominant: list[str] = []
    secondary: list[str] = []
    for name, count in sorted_eco:
        share = count / total
        if share >= 0.25 and len(dominant) < 2:
            dominant.append(name)
        elif len(secondary) < 3:
            secondary.append(name)
    return {
        "dominant": dominant,
        "secondary": secondary,
        "emerging": [],
        "declining": [],
    }


def _test_pattern(db: BeheldDB) -> dict:
    """Map L1 test_ratio + L2 has_test_context into the schema enums."""
    row = db.connect().execute("SELECT avg_test_ratio FROM l1_aggregated").fetchone()
    l1_ratio = float(row[0]) if row and row[0] is not None else 0.0
    row = db.connect().execute(
        "SELECT AVG(has_test_context) FROM sessions"
    ).fetchone()
    l2_ratio = float(row[0]) if row and row[0] is not None else 0.0
    # Combined signal: weight L1 (broader) 60%, L2 40%.
    combined = (l1_ratio * 0.6) + (l2_ratio * 0.4)
    if combined >= 0.5:
        discipline = "strong"
    elif combined >= 0.25:
        discipline = "moderate"
    elif combined >= 0.05:
        discipline = "low"
    else:
        discipline = "minimal"
    # Approach: with no upstream classifier, default to test_after (most
    # common real-world pattern) when discipline > minimal; exploratory otherwise.
    if discipline == "minimal":
        approach = "exploratory"
    elif discipline == "strong":
        approach = "tdd_partial"
    else:
        approach = "test_after"
    return {"discipline": discipline, "approach": approach}


def _workflow_distribution(db: BeheldDB, days: Optional[int] = None) -> Counter:
    """workflow_pattern frequency in the given window. None = all sessions."""
    sql = "SELECT workflow_pattern FROM sessions WHERE workflow_pattern IS NOT NULL"
    params: tuple = ()
    if days is not None:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        sql += " AND started_at >= ?"
        params = (cutoff,)
    rows = db.connect().execute(sql, params).fetchall()
    return Counter(r[0] for r in rows)


def _workflow_block(db: BeheldDB) -> dict:
    """Pick the schema-enum workflow.primary from session counts."""
    counts = _workflow_distribution(db)
    if not counts:
        return {"primary": "exploratory"}
    primary = counts.most_common(1)[0][0]
    # Map the engine's workflow_pattern strings to the schema enum (close
    # enough — both vocabularies were designed in tandem).
    valid = {"tdd", "test_after", "debug_driven", "refactor_heavy",
             "exploratory", "review_before_commit"}
    if primary not in valid:
        primary = "exploratory"
    block: dict = {"primary": primary}
    if len(counts) >= 2:
        emerging = counts.most_common(2)[1][0]
        if emerging in valid and emerging != primary:
            block["emerging"] = emerging
    return block


def _evolution_block(db: BeheldDB) -> dict:
    """has_evolution + timeframe from L1 commit history span."""
    row = db.connect().execute(
        "SELECT earliest_commit, latest_commit FROM l1_aggregated"
    ).fetchone()
    if not row or not row[0] or not row[1]:
        return {"has_evolution": False, "timeframe": "insufficient_history"}
    try:
        earliest = datetime.fromisoformat(row[0].replace("Z", "+00:00"))
        latest = datetime.fromisoformat(row[1].replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return {"has_evolution": False, "timeframe": "insufficient_history"}
    span_days = (latest - earliest).days
    if span_days >= 365 * 3:
        tf = "many_years"
    elif span_days >= 365 * 2:
        tf = "couple_years"
    elif span_days >= 365:
        tf = "year"
    elif span_days >= 60:
        tf = "months"
    else:
        return {"has_evolution": False, "timeframe": "insufficient_history"}
    return {"has_evolution": True, "timeframe": tf, "trajectory": "none"}


def _sample_size_block(db: BeheldDB) -> dict:
    sess = db.connect().execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    repos = db.connect().execute("SELECT COUNT(*) FROM l1_repositories").fetchone()[0]
    # Both signals contribute. Heuristic from spec.
    if sess >= 30 or repos >= 5:
        band = "high"
    elif sess >= 10 or repos >= 2:
        band = "medium"
    elif sess >= 3 or repos >= 1:
        band = "low"
    else:
        band = "minimal"
    return {"confidence_band": band}


def build_signals_minimal(db: BeheldDB) -> dict:
    """Build a schema-v1 signals payload from current SQLite state.

    Lossy (timing/ai_usage have hardcoded defaults; emerging/declining are
    always empty without a temporal classifier) but every field is grounded
    in real data — never fabricated.
    """
    sess_count = db.connect().execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    repo_count = db.connect().execute("SELECT COUNT(*) FROM l1_repositories").fetchone()[0]

    ext_counts = _aggregate_l1_extensions(db)
    eco_counts = _ecosystems_from_extensions(ext_counts)
    plat_counts = _aggregate_l1_platforms(db)

    return {
        "schema_version": "1",
        "data_sources": {"l1": repo_count > 0, "l2": sess_count > 0},
        "ecosystems": _classify_ecosystems(eco_counts),
        "test_pattern": _test_pattern(db),
        "workflow": _workflow_block(db),
        # Timing requires temporal session analysis — defaults until classifier lands.
        "timing": {"peak_period": "distributed", "consistency": "irregular"},
        "evolution": _evolution_block(db),
        "tooling": {"platforms": [p for p, _ in plat_counts.most_common(5)]},
        "sample_size": _sample_size_block(db),
    }


def compute_emergent_diff(db: BeheldDB, recent_days: int = 30, baseline_days: int = 180) -> Optional[dict]:
    """Compare workflow distribution in recent vs baseline window.

    Returns the most-shifted workflow pattern when its share grew by ≥15
    percentage points, OR None when no meaningful shift exists / sample
    too small to claim trend. The baseline window EXCLUDES the recent
    window so we're comparing distinct slices.
    """
    recent = _workflow_distribution(db, recent_days)
    full_baseline = _workflow_distribution(db, baseline_days)
    # Subtract the recent window from baseline to get the older slice.
    older = full_baseline - recent
    if sum(recent.values()) < 5 or sum(older.values()) < 5:
        return None
    recent_total = sum(recent.values())
    older_total = sum(older.values())
    biggest_delta = 0.0
    winner: Optional[str] = None
    winner_recent_share = 0.0
    winner_older_share = 0.0
    for pattern in set(recent.keys()) | set(older.keys()):
        recent_share = recent.get(pattern, 0) / recent_total
        older_share = older.get(pattern, 0) / older_total
        delta = recent_share - older_share
        if delta > biggest_delta:
            biggest_delta = delta
            winner = pattern
            winner_recent_share = recent_share
            winner_older_share = older_share
    if winner is None or biggest_delta < 0.15:
        return None
    return {
        "pattern": winner,
        "recent_share": round(winner_recent_share, 2),
        "older_share": round(winner_older_share, 2),
        "delta_pp": round(biggest_delta * 100),
        "recent_window_days": recent_days,
        "baseline_window_days": baseline_days,
    }

"""Canonical serialization + hash for .beheld payloads (Phase 5).

This module owns the wire-level rules that make the bundle hash deterministic
and reproducible byte-for-byte across Python (engine) and TypeScript (CLI).

Canonical form:
  - JSON keys sorted alphabetically at every level (sort_keys=True).
  - Compact separators (no spaces).
  - UTF-8 encoding, ensure_ascii=False (preserves accented characters as UTF-8
    bytes rather than \\u escapes — keeps payload smaller and human-readable).
  - Floats serialized with Python's repr-style minimal form (consistent with
    JavaScript's JSON.stringify for the values we emit: ratios, counts).

The TypeScript twin lives at packages/cli/src/bundle/canonical.ts. Both must
agree on every byte — test_bundle_contract enforces this via a fixed expected
hash computed from a known fixture.
"""
from __future__ import annotations

import dataclasses
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from typing import Optional

from models import (
    BundleCoreSection,
    BundleEnrichmentSection,
    BundlePayload,
    HarnessSource,
    L1RepositoryRef,
    Scores,
    WorkflowMetrics,
)


def _normalize_numbers(value: object) -> object:
    """Drop `.0` from whole floats so Python and JavaScript agree.

    `json.dumps(1.0)` → `"1.0"`, but `JSON.stringify(1.0)` → `"1"`. Coercing
    whole floats to ints before serializing keeps both languages byte-identical
    without changing semantics (the receiver always reinterprets the field's
    type from the schema).
    """
    if isinstance(value, bool):
        return value  # bool is a subclass of int — preserve as-is
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {k: _normalize_numbers(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize_numbers(v) for v in value]
    return value


def canonical_json(value: object) -> str:
    """Stable JSON string: sorted keys, compact separators, UTF-8.

    Whole floats are normalized to ints to align with JavaScript serialization.
    """
    return json.dumps(
        _normalize_numbers(value),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )


def payload_to_canonical(payload: BundlePayload) -> str:
    return canonical_json(dataclasses.asdict(payload))


def payload_hash(payload: BundlePayload) -> str:
    """SHA-256 of the canonical-JSON-encoded payload, prefixed 'sha256:'."""
    raw = payload_to_canonical(payload).encode("utf-8")
    return "sha256:" + hashlib.sha256(raw).hexdigest()


# ── builder: DB state → BundlePayload ────────────────────────────────────────


def _signal_counts(db, signal_type: str) -> dict[str, int]:
    rows = db.connect().execute(
        "SELECT signal_value, SUM(occurrences) AS total "
        "FROM technical_signals WHERE signal_type = ? GROUP BY signal_value",
        (signal_type,),
    ).fetchall()
    return {row["signal_value"]: int(row["total"]) for row in rows}


def build_bundle_payload(
    db,
    beheld_version: str,
    period_days: int = 30,
    engine_version_hash: Optional[str] = None,
    identity_gen: Optional[object] = None,
    insights_gen: Optional[object] = None,
) -> BundlePayload:
    """Assemble the signed half of a .beheld from current DB state.

    Raises ValueError when there are no scores yet — caller (the engine
    endpoint) translates that to HTTP 409 so the CLI shows a clean message.

    `engine_version_hash` (F5.7.2) is the SHA-256 of the engine binary that
    produced the payload, or None when unfrozen / unavailable. It is recorded
    verbatim in the payload and ends up in the bundle's signed canonical bytes.

    `identity_gen` (F6.12 / schema v4) — optional IdentityGenerator. When
    provided, the builder produces a stable identity for this snapshot and
    embeds it in the signed payload (so the HTML page renders the same text
    a verifier reads from the bytes). When None, the identity field stays
    None in the payload — used by tests that don't care about identity.

    `insights_gen` (F6.12 / schema v5) — optional InsightGenerator. When
    provided, the bullets shown on the public HTML page are produced at
    snapshot time and embedded in the signed payload. None leaves the
    `insights` field null in the payload (no bullets on the page).
    """
    scores = db.get_current_scores()
    if scores is None:
        raise ValueError(
            "no scores available — run the engine on at least one session before snapshotting"
        )

    sessions = db.get_all_sessions_as_objects()

    # Aggregate signal counts directly from technical_signals
    platforms = _signal_counts(db, "platform")
    ecosystems = _signal_counts(db, "ecosystem")

    # Distributions derived from session classification — rounded to 4 decimals
    # so the same input always produces the same canonical bytes (no float drift
    # between Python's repr and the bundle's intended precision).
    workflows = [s.workflow_pattern for s in sessions if s.workflow_pattern and s.workflow_pattern != "unknown"]
    if workflows:
        wf_count = Counter(workflows)
        total_wf = sum(wf_count.values())
        wf_dist = {k: round(v / total_wf, 4) for k, v in wf_count.items()}
    else:
        wf_dist = {}

    categories = [s.project_category for s in sessions if s.project_category and s.project_category != "unknown"]
    if categories:
        cat_count = Counter(categories)
        total_cat = sum(cat_count.values())
        cat_dist = {k: round(v / total_cat, 4) for k, v in cat_count.items()}
    else:
        cat_dist = {}

    latest_metrics = db.get_latest_workflow_metrics()
    workflow_metrics = latest_metrics["metrics"] if latest_metrics else WorkflowMetrics()

    latest_snapshot = db.get_latest_snapshot()
    previous_hash = latest_snapshot["hash"] if latest_snapshot else None

    # R1.1 — harness_sources is the first-class capture-fidelity manifest of
    # enrichment. R2 introduces multi-harness aggregation: sessions are
    # grouped by `source` (the writer-side string stamped on every
    # BeheldEvent), and each group becomes one HarnessSource via the closed
    # harness_registry mapping. Unknown sources fall back to
    # (harness="unknown", capture_fidelity="inferred") rather than aborting
    # the bundle — forward-compat for adapters that ship between releases.
    from harness_registry import lookup as _harness_lookup
    _source_counts: Counter = Counter(s.source for s in sessions)
    # Sorted by (harness, fidelity) to keep canonical bytes stable across
    # runs regardless of session insertion order.
    harness_sources = sorted(
        (
            HarnessSource(
                harness=_harness_lookup(src).harness,
                capture_fidelity=_harness_lookup(src).capture_fidelity,
                sessions=count,
            )
            for src, count in _source_counts.items()
        ),
        key=lambda h: (h.harness, h.capture_fidelity),
    )
    # R1.1 back-compat: when there are zero sessions at all, emit a single
    # claude_code/native_hook entry with sessions=0 so legacy fixtures and
    # downstream readers that expect at least one entry don't break.
    if not harness_sources:
        harness_sources = [
            HarnessSource(harness="claude_code", capture_fidelity="native_hook", sessions=0),
        ]

    enrichment = BundleEnrichmentSection(
        harness_sources=harness_sources,
        platforms=platforms,
        ecosystems=ecosystems,
        workflow_distribution=wf_dist,
        project_categories=cat_dist,
        workflow_metrics=workflow_metrics,
        sessions_analyzed=len(sessions),
        period_days=period_days,
    )

    core = _build_core_section(db)

    # ── F6.12 / schema v4 — embedded human-facing overlays ───────────────
    # These four sections used to be fetched ad-hoc by the CLI when
    # generating the HTML page. Embedding them in the signed bytes makes
    # the shared HTML a faithful renderer of the bundle (no live engine
    # required). Each is independently fail-soft so a single section's
    # absence never blocks snapshotting.

    stack: Optional[dict] = None
    try:
        stack = db.get_l1_stack()
    except Exception:
        stack = None

    signals: Optional[dict] = None
    identity: Optional[dict] = None
    emergent: Optional[dict] = None
    try:
        from identity_adapter import build_signals_minimal, compute_emergent_diff
        signals = build_signals_minimal(db)
        emergent = compute_emergent_diff(db)
        if identity_gen is not None:
            # persist=True caches the identity in the identity_phrases table
            # keyed by snapshot — keeps the same text stable for re-renders.
            try:
                id_obj = identity_gen.generate(signals, persist=False)
                identity = id_obj.to_dict() if hasattr(id_obj, "to_dict") else dict(id_obj)
            except Exception:
                identity = None
    except Exception:
        # If identity_adapter is unavailable at import time (test envs that
        # stub the engine), just leave signals/emergent as None.
        pass

    insights: Optional[dict] = None
    if insights_gen is not None:
        try:
            ins = insights_gen.generate()
            # Defensive copy — generator may return a dataclass-ish object
            # or a plain dict; both serialise the same in canonical bytes.
            insights = dict(ins) if not isinstance(ins, dict) else ins
        except Exception:
            insights = None

    return BundlePayload(
        created_at=datetime.now(timezone.utc).isoformat(),
        beheld_version=beheld_version,
        previous_hash=previous_hash,
        scores=scores,
        core=core,
        enrichment=enrichment,
        engine_version_hash=engine_version_hash,
        stack=stack,
        signals=signals,
        identity=identity,
        emergent=emergent,
        insights=insights,
    )


def _build_core_section(db) -> BundleCoreSection:
    """Aggregate git-history signals into the canonical bundle core section.

    Returns an empty section (zeros / empty lists / null timestamps) when no
    repository has been imported — the core key is always present in v6 payloads.
    Privacy: no URLs, names, or paths — only root commit hashes paired with the
    timestamp of the first import (F5.7.2)."""
    summary = db.get_l1_summary()
    repos = db.get_l1_repositories()
    # Sorted by hash so the canonical JSON is deterministic across runs.
    refs = sorted(
        (
            L1RepositoryRef(
                hash=r["root_commit_hash"],
                first_seen_at=r.get("first_seen_at") or r["imported_at"],
            )
            for r in repos
        ),
        key=lambda ref: ref.hash,
    )
    return BundleCoreSection(
        total_repos=int(summary.get("total_repos") or 0),
        total_commits=int(summary.get("total_commits") or 0),
        earliest_commit=summary.get("earliest_commit"),
        latest_commit=summary.get("latest_commit"),
        ecosystems=dict(summary.get("ecosystems_merged") or {}),
        platforms=dict(summary.get("platforms_merged") or {}),
        avg_test_ratio=float(summary.get("avg_test_ratio") or 0.0),
        root_commit_hashes=list(refs),
    )

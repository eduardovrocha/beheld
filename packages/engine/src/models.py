from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


# ── raw event from JSONL ──────────────────────────────────────────────────────

@dataclass
class BeheldEvent:
    event_id: str
    session_id: str
    source: str
    event_type: str
    timestamp: str
    duration_ms: Optional[int] = None
    tool_name: Optional[str] = None
    file_extension: Optional[str] = None
    command_sanitized: Optional[str] = None
    prompt_length: Optional[int] = None
    has_test_context: Optional[bool] = None
    cwd_hash: Optional[str] = None
    metadata: dict = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict) -> BeheldEvent:
        return cls(
            event_id=d["event_id"],
            session_id=d["session_id"],
            source=d.get("source", "claude-code"),
            event_type=d["event_type"],
            timestamp=d["timestamp"],
            duration_ms=d.get("duration_ms"),
            tool_name=d.get("tool_name"),
            file_extension=d.get("file_extension"),
            command_sanitized=d.get("command_sanitized"),
            prompt_length=d.get("prompt_length"),
            has_test_context=d.get("has_test_context"),
            cwd_hash=d.get("cwd_hash"),
            metadata=d.get("metadata", {}),
        )


# ── aggregated session ────────────────────────────────────────────────────────

@dataclass
class Session:
    session_id: str
    source: str
    started_at: datetime
    ended_at: Optional[datetime]
    duration_minutes: float
    # Raw event list (populated from JSONL; empty for DB-reconstructed sessions)
    events: list[BeheldEvent] = field(default_factory=list)
    tools_used: list[str] = field(default_factory=list)
    file_extensions: Counter = field(default_factory=Counter)
    commands: list[str] = field(default_factory=list)
    cwd_hash: str = ""
    total_turns: int = 0
    has_test_context: bool = False
    # Classifier output (set by Processor)
    project_category: str = "unknown"
    project_confidence: float = 0.0
    workflow_pattern: str = "unknown"
    # Pre-computed aggregates (set by Processor; used by scorers for DB sessions)
    avg_prompt_length: float = 0.0
    has_code_context_ratio: float = 0.0
    event_count: int = 0
    # Accumulated ordered tool sequence (persisted for incremental classification)
    tool_sequence: list[str] = field(default_factory=list)


# ── storage types ─────────────────────────────────────────────────────────────

@dataclass
class Signal:
    signal_type: str   # "platform" | "ecosystem" | "language" | "tool" | "workflow"
    signal_value: str
    occurrences: int = 1


@dataclass
class Scores:
    date: str
    prompt_quality: int
    test_maturity: int
    tech_breadth: int
    growth_rate: int
    overall: int
    sessions_analyzed: int


# ── classification / extraction ───────────────────────────────────────────────

@dataclass
class TechnicalSignals:
    platforms: dict[str, int] = field(default_factory=dict)
    ecosystems: dict[str, int] = field(default_factory=dict)
    languages: dict[str, int] = field(default_factory=dict)
    tools: dict[str, int] = field(default_factory=dict)
    workflow_pattern: str = "unknown"
    tool_sequence: list[str] = field(default_factory=list)


@dataclass
class ProjectClassification:
    category: str
    confidence: float
    signals_used: list[str] = field(default_factory=list)


# ── coach feature ─────────────────────────────────────────────────────────────
#
# Types below back the /coach endpoint and the beheld_coach MCP tool.
# Design constraints (see Phase 5 — .beheld):
# - WorkflowMetrics fields are scalars only (deterministic JSON canonical form).
# - Pattern objects are derived, never persisted; they don't enter the bundle.
# - CoachPayload is the wire format consumed by host LLMs (Claude Code etc.).

# Allowed values (documentation; not enforced at type level to keep the dataclass
# style consistent with the rest of the module):
#   data_freshness:    "live" | "cache" | "insufficient"
#   trend_30d:         "up" | "stable" | "down"
#   severity:          "low" | "medium" | "high"
#   session_phase_hint:"feature_work" | "debug" | "refactor" | "exploration" | "unknown"

COACH_PAYLOAD_VERSION = 1


@dataclass(frozen=True)
class WorkflowMetrics:
    """Aggregated, deterministic metrics over a window of sessions.

    All fields are scalars in stable units (ratios in [0,1], minutes, counts).
    Defaults are 0.0 — callers should check `sessions_analyzed` on the parent
    record to know whether metrics are meaningful.
    """
    test_after_ratio: float = 0.0
    test_first_ratio: float = 0.0
    median_test_delay_min: float = 0.0
    edit_to_test_lag_min: float = 0.0
    bash_to_read_ratio: float = 0.0
    prompt_avg_chars: float = 0.0
    prompt_median_chars: float = 0.0
    session_avg_duration_min: float = 0.0
    tool_variety_avg: float = 0.0
    ecosystem_concentration: float = 0.0

    @classmethod
    def from_dict(cls, d: dict) -> WorkflowMetrics:
        valid = {f for f in cls.__dataclass_fields__}
        return cls(**{k: float(d.get(k, 0.0)) for k in valid})


@dataclass(frozen=True)
class Pattern:
    """A behavioural pattern detected from workflow_metrics + summary.

    Derived (never persisted). `metric` carries only the numbers cited in
    `evidence` so the LLM can quote without hallucinating.
    """
    id: str
    label: str
    evidence: str
    metric: dict[str, float] = field(default_factory=dict)
    confidence: float = 0.0
    trend_30d: str = "stable"
    severity: str = "low"
    applies_to_current_session: bool = False


@dataclass(frozen=True)
class SessionContext:
    """Hints about the session in which coach was invoked.

    Allows `detect_patterns` to mark `applies_to_current_session` accurately.
    """
    current_project_category: str = "unknown"
    ecosystems_recent: list[str] = field(default_factory=list)
    session_phase_hint: str = "unknown"


@dataclass(frozen=True)
class CoachingGuidance:
    """Constant instructions for the host LLM on how to use the payload.

    Versioned with the engine; not user-editable.
    """
    tone: str
    must: list[str]
    must_not: list[str]
    good_example: str
    bad_example: str


@dataclass(frozen=True)
class CoachPayload:
    """Top-level response of GET /coach. Consumed by beheld_coach MCP tool."""
    version: int
    as_of: str
    data_freshness: str
    scores: Scores
    context_for_session: SessionContext
    patterns: list[Pattern]
    coaching_guidance: CoachingGuidance
    suggested_followups: list[str] = field(default_factory=list)


# ── signed snapshot (.beheld) — Phase 5 ─────────────────────────────────────
#
# Wire format contract. Identical shape in TypeScript (cli/src/bundle/types.ts).
# Any change here MUST bump BUNDLE_VERSION and update the TS twin in the same
# commit — the cross-language canonical hash test (test_bundle_contract) catches
# drift.

BUNDLE_VERSION = "4"


@dataclass(frozen=True)
class L1RepositoryRef:
    """Reference to an imported repository in the L1 section.

    `hash` is the opaque root-commit SHA. `first_seen_at` is the ISO-8601 UTC
    timestamp of the first time this repo was imported (immutable across
    re-imports — see F5.7.2)."""
    hash: str
    first_seen_at: str


@dataclass(frozen=True)
class BundleL1Section:
    """Git-history signals (Phase 6 / L1). Empty values when no repository has
    been imported — never absent from a v2 payload."""
    total_repos: int
    total_commits: int
    earliest_commit: Optional[str]
    latest_commit: Optional[str]
    ecosystems: dict[str, bool]
    platforms: dict[str, bool]
    avg_test_ratio: float
    root_commit_hashes: list[L1RepositoryRef]


@dataclass(frozen=True)
class BundleL2Section:
    """Session signals (Phase 2–5 / L2). Same shape as the legacy
    `BundleSignals` — the rename reflects the new layered model."""
    platforms: dict[str, int]
    ecosystems: dict[str, int]
    workflow_distribution: dict[str, float]
    project_categories: dict[str, float]
    workflow_metrics: WorkflowMetrics
    sessions_analyzed: int
    period_days: int


# Back-compat alias for any external code that imported the old name.
BundleSignals = BundleL2Section


@dataclass(frozen=True)
class BundlePayload:
    """The signed half of a .beheld. SHA-256 of canonical_json(payload) is
    embedded in the parent Bundle.hash; that same canonical_json is what
    Ed25519 signs.

    Schema v2 (Phase 6): `signals` was replaced by separate `l1` and `l2`
    sections so verifiers can inspect each layer independently.

    F5.7.2 added `engine_version_hash` (SHA-256 of the engine binary that
    produced the payload). Null when running unfrozen or when hashing fails.

    Schema v4 (F6.12 — public retrato fidelity): four new fields embed the
    human-facing overlays that were previously fetched ad-hoc by the CLI
    when generating the HTML page. With these included in the signed bytes,
    the shared HTML becomes a faithful renderer of the bundle — no live
    engine required to view what's on the page.

    The new fields are typed as Optional[dict] rather than dedicated
    dataclasses for two reasons: (1) they're produced by modules
    (identity_adapter, identity, l1.stack_aggregator) that already return
    JSON-shaped dicts, and forcing them through frozen dataclasses adds
    plumbing without verifier benefit; (2) the inner shape can evolve
    independently of the wrapper schema — only the wrapper-level field
    names are part of the cross-language contract."""
    created_at: str
    beheld_version: str
    previous_hash: Optional[str]
    scores: Scores
    l1: BundleL1Section
    l2: BundleL2Section
    engine_version_hash: Optional[str] = None
    stack: Optional[dict] = None
    signals: Optional[dict] = None
    identity: Optional[dict] = None
    emergent: Optional[dict] = None


@dataclass(frozen=True)
class AttestationGithub:
    """Snapshot of the GitHub identity bound to a developer's pubkey at
    attestation time (Phase 5 / F5.6)."""
    user_id: int
    login: str
    verified_at: str


@dataclass(frozen=True)
class AttestationPayload:
    """Signed half of an identity attestation. The verifier reconstructs the
    canonical JSON of this object and checks the signature against the
    platform key identified by `platform_key_id`."""
    type: str
    platform_key_id: str
    dev_pubkey: str
    github: AttestationGithub
    attested_at: str


@dataclass(frozen=True)
class BundleAttestation:
    """Wrapper-level identity attestation. Optional — bundles without one
    verify as `identity_unverified`. Adding one does NOT change the bundle
    payload hash (the hash is over `payload` only)."""
    payload: AttestationPayload
    signature: str  # "ed25519:<base64>"


@dataclass(frozen=True)
class Bundle:
    """Top-level .beheld wire format. `version` is the bundle schema version,
    independent of beheld_version (which tracks the app).

    Schema v3 (Phase 5 / F5.6) adds the optional `attestation` field at the
    wrapper level. v1, v2, and v3 are all readable by current verifiers; the
    presence or absence of attestation just shifts the identity-verification
    tier reported to the user."""
    version: str
    payload: BundlePayload
    hash: str          # "sha256:<hex>"
    signature: str     # "ed25519:<hex>"
    public_key: str    # "ed25519:<base64url-x>"
    attestation: Optional[BundleAttestation] = None  # F5.6 — optional, wrapper-level

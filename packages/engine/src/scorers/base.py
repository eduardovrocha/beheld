"""Shared types for core/enrichment aware scorers (R1.2 — was L1/L2 Phase 6).

core       = signals derived from git repository history (imported via /l1/import).
enrichment = signals derived from Claude Code / Continue.dev sessions (existing).

Each scorer declares two ClassVars:

  data_sources: list[DataSource]
    Which layers the scorer consumes. Pure documentation — runtime behavior
    is governed by the .score() method's own logic.

  fallback_when_enrichment_missing: bool (default True via Protocol)
    When True (default), scorer runs with core-only when enrichment is
    absent and produces a numeric score. When False, scorer returns None
    when enrichment is absent (dimension disappears from the profile —
    spec §3 / R1.2 principle "honestidade de captura").

Scorers must NEVER conflate layers — combination is explicit and weighted.
The neutral-50 fallback for empty L2 (legacy behavior) is REMOVED in R1.2:
scorers with fallback=True use core-only; scorers with fallback=False
return None.

Naming note (R1.2): the wire format uses `payload.core`/`payload.enrichment`
(spec §3.2). Internally, the dataclass keeps the name `L1Snapshot` to avoid
churning 3 import sites; the data it holds is "core" data in v6 wire terms.
The `data_sources` Literal carries the canonical core/enrichment names —
that's what the spec requires."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import ClassVar, Literal

DataSource = Literal["core", "enrichment"]


@dataclass
class MonthlyBucket:
    """Per-month rollup of L1 commit activity. Powers the GrowthRateScorer
    baseline (first 12 months) vs current (last 6 months) window comparison
    introduced in R1.2 (spec §7.2).

    `month` is ISO-8601 YYYY-MM. All other fields are aggregates across all
    repos imported by the user for that month. Empty months are NOT included
    in the dict (callers iterate keys present).

    `repo_hashes` powers diversity_signal = (distinct_repos(curr) -
    distinct_repos(base)) / 3, per spec §7.2."""

    month: str
    commit_count: int = 0
    test_ratio: float = 0.0
    ecosystems: set[str] = field(default_factory=set)
    platforms: set[str] = field(default_factory=set)
    repo_hashes: set[str] = field(default_factory=set)


@dataclass
class L1Snapshot:
    """Aggregated core (L1) signals — built from `db.get_l1_summary()`.

    An empty snapshot (`is_empty == True`) means no repo has been imported.
    Under R1.2 semantics, core is the always-present baseline; scorers with
    `fallback_when_enrichment_missing=True` use core-only when enrichment
    is absent (no neutral-50 fallback)."""

    total_repos: int = 0
    total_commits: int = 0
    extensions: dict[str, int] = field(default_factory=dict)
    ecosystems: dict[str, bool] = field(default_factory=dict)
    platforms: dict[str, bool] = field(default_factory=dict)
    avg_test_ratio: float = 0.0
    earliest_commit: str | None = None
    latest_commit: str | None = None
    # R1.2 — per-month rollup keyed by "YYYY-MM". Empty when L1Importer was
    # run pre-R1.2 (legacy data). Tests with new GrowthRateScorer must seed
    # this directly; the L1Importer extension in Phase 3 populates it at
    # ingestion time.
    monthly_buckets: dict[str, MonthlyBucket] = field(default_factory=dict)

    @property
    def is_empty(self) -> bool:
        return self.total_repos == 0

    @property
    def total_history_months(self) -> int:
        """Approximate calendar months between earliest and latest commit.
        Returns 0 if either bound is missing. Used by GrowthRateScorer to
        decide between <6mo (None), 6-18mo (low-confidence 50/50 split),
        and ≥18mo (canonical 12mo baseline + 6mo current)."""
        if not self.earliest_commit or not self.latest_commit:
            return 0
        try:
            ey, em = self.earliest_commit[:7].split("-")
            ly, lm = self.latest_commit[:7].split("-")
            return (int(ly) - int(ey)) * 12 + (int(lm) - int(em))
        except (ValueError, IndexError):
            return 0

    @classmethod
    def from_summary(cls, summary: dict | None) -> "L1Snapshot":
        if not summary:
            return cls()
        raw_buckets = summary.get("monthly_buckets") or {}
        buckets: dict[str, MonthlyBucket] = {}
        for month, payload in raw_buckets.items():
            if not isinstance(payload, dict):
                continue
            buckets[month] = MonthlyBucket(
                month=month,
                commit_count=int(payload.get("commit_count") or 0),
                test_ratio=float(payload.get("test_ratio") or 0.0),
                ecosystems=set(payload.get("ecosystems") or []),
                platforms=set(payload.get("platforms") or []),
                repo_hashes=set(payload.get("repo_hashes") or []),
            )
        return cls(
            total_repos=int(summary.get("total_repos") or 0),
            total_commits=int(summary.get("total_commits") or 0),
            extensions=dict(summary.get("extensions_merged") or {}),
            ecosystems=dict(summary.get("ecosystems_merged") or {}),
            platforms=dict(summary.get("platforms_merged") or {}),
            avg_test_ratio=float(summary.get("avg_test_ratio") or 0.0),
            earliest_commit=summary.get("earliest_commit"),
            latest_commit=summary.get("latest_commit"),
            monthly_buckets=buckets,
        )

    @property
    def ecosystem_keys(self) -> set[str]:
        return {k for k, v in self.ecosystems.items() if v}

    @property
    def platform_keys(self) -> set[str]:
        return {k for k, v in self.platforms.items() if v}

    def buckets_in_range(self, start_month: str, end_month: str) -> list[MonthlyBucket]:
        """All buckets where `start_month <= month <= end_month` (ISO YYYY-MM
        string compare is lex-correct since both fields are zero-padded).
        Used by GrowthRateScorer to extract baseline vs current windows."""
        return [
            b for m, b in self.monthly_buckets.items()
            if start_month <= m <= end_month
        ]


# Re-exported so scorer modules can declare data_sources via a single import.
__all__ = ["DataSource", "L1Snapshot", "MonthlyBucket", "ClassVar"]

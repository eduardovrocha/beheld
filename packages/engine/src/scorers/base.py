"""Shared types for L1/L2 aware scorers (Phase 6).

L1 = signals derived from git repository history (imported via /l1/import).
L2 = signals derived from Claude Code / Continue.dev sessions (existing).

Each scorer declares which layers it consumes via the `data_sources` ClassVar.
Scorers must NEVER conflate layers — combination is explicit and weighted."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import ClassVar, Literal

DataSource = Literal["l1", "l2"]


@dataclass
class L1Snapshot:
    """Aggregated L1 signals — built from `db.get_l1_summary()`.

    An empty snapshot (`is_empty == True`) means no repo has been imported;
    scorers fall back to L2-only behavior in that case."""

    total_repos: int = 0
    total_commits: int = 0
    extensions: dict[str, int] = field(default_factory=dict)
    ecosystems: dict[str, bool] = field(default_factory=dict)
    platforms: dict[str, bool] = field(default_factory=dict)
    avg_test_ratio: float = 0.0

    @property
    def is_empty(self) -> bool:
        return self.total_repos == 0

    @classmethod
    def from_summary(cls, summary: dict | None) -> "L1Snapshot":
        if not summary:
            return cls()
        return cls(
            total_repos=int(summary.get("total_repos") or 0),
            total_commits=int(summary.get("total_commits") or 0),
            extensions=dict(summary.get("extensions_merged") or {}),
            ecosystems=dict(summary.get("ecosystems_merged") or {}),
            platforms=dict(summary.get("platforms_merged") or {}),
            avg_test_ratio=float(summary.get("avg_test_ratio") or 0.0),
        )

    @property
    def ecosystem_keys(self) -> set[str]:
        return {k for k, v in self.ecosystems.items() if v}

    @property
    def platform_keys(self) -> set[str]:
        return {k for k, v in self.platforms.items() if v}


# Re-exported so scorer modules can declare data_sources via a single import.
__all__ = ["DataSource", "L1Snapshot", "ClassVar"]

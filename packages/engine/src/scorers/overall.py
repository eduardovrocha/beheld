from __future__ import annotations

from typing import Optional

# Each dimension declares both its overall weight AND the layer(s) it consumes.
# `sources` is documentation for consumers (CLI, dashboard, beheld); the
# actual layer combination happens inside each scorer.
#
# R1.2 — `sources` strings renamed l1/l2 → core/enrichment per spec §3.2.
# Weight values are UNCHANGED (sum to 1.0).
WEIGHTS = {
    "prompt_quality": {"weight": 0.30, "sources": ["enrichment"]},
    "test_maturity":  {"weight": 0.30, "sources": ["core", "enrichment"]},
    "tech_breadth":   {"weight": 0.25, "sources": ["core", "enrichment"]},
    "growth_rate":    {"weight": 0.15, "sources": ["core", "enrichment"]},
}
assert abs(sum(v["weight"] for v in WEIGHTS.values()) - 1.0) < 1e-9, "Pesos devem somar 1.0"


def _w(key: str) -> float:
    return WEIGHTS[key]["weight"]


def calculate_overall(
    prompt_quality: Optional[int],
    test_maturity: Optional[int],
    tech_breadth: Optional[int],
    growth_rate: Optional[int],
) -> Optional[int]:
    """Weighted overall score with renormalization for absent dimensions.

    R1.2 — a scorer with `fallback_when_enrichment_missing = False` (today
    only PromptQuality) returns None when its source data is absent. The
    overall must NOT pretend an absent dimension is 0 — instead, drop it
    and renormalize the remaining weights so present dimensions still sum
    to 1.0 of the renormalized weight.

    Returns None when ALL inputs are None (no dimension observed)."""
    present: list[tuple[int, float]] = []
    if prompt_quality is not None:
        present.append((prompt_quality, _w("prompt_quality")))
    if test_maturity is not None:
        present.append((test_maturity, _w("test_maturity")))
    if tech_breadth is not None:
        present.append((tech_breadth, _w("tech_breadth")))
    if growth_rate is not None:
        present.append((growth_rate, _w("growth_rate")))

    if not present:
        return None

    total_weight = sum(w for _, w in present)
    if total_weight == 0:
        return None
    raw = sum(score * w for score, w in present) / total_weight
    return round(raw)

from __future__ import annotations

# Each dimension declares both its overall weight AND the layer(s) it consumes.
# `sources` is documentation for consumers (CLI, dashboard, dpbundle); the
# actual layer combination happens inside each scorer.
WEIGHTS = {
    "prompt_quality": {"weight": 0.30, "sources": ["l2"]},
    "test_maturity":  {"weight": 0.30, "sources": ["l1", "l2"]},
    "tech_breadth":   {"weight": 0.25, "sources": ["l1", "l2"]},
    "growth_rate":    {"weight": 0.15, "sources": ["l1", "l2"]},
}
assert abs(sum(v["weight"] for v in WEIGHTS.values()) - 1.0) < 1e-9, "Pesos devem somar 1.0"


def _w(key: str) -> float:
    return WEIGHTS[key]["weight"]


def calculate_overall(
    prompt_quality: int,
    test_maturity: int,
    tech_breadth: int,
    growth_rate: int,
) -> int:
    raw = (
        prompt_quality * _w("prompt_quality")
        + test_maturity * _w("test_maturity")
        + tech_breadth  * _w("tech_breadth")
        + growth_rate   * _w("growth_rate")
    )
    return round(raw)

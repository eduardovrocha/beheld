from __future__ import annotations

WEIGHTS = {
    "prompt_quality": 0.30,
    "test_maturity":  0.30,
    "tech_breadth":   0.25,
    "growth_rate":    0.15,
}
assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9, "Pesos devem somar 1.0"


def calculate_overall(
    prompt_quality: int,
    test_maturity: int,
    tech_breadth: int,
    growth_rate: int,
) -> int:
    raw = (
        prompt_quality * WEIGHTS["prompt_quality"]
        + test_maturity * WEIGHTS["test_maturity"]
        + tech_breadth  * WEIGHTS["tech_breadth"]
        + growth_rate   * WEIGHTS["growth_rate"]
    )
    return round(raw)

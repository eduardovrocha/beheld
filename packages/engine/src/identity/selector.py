"""Decide whether the LLM or the rule-based fallback should generate the
identity phrase for a given signals payload.

The decision is by expected output quality, not by LLM availability — the
fallback is a legitimate path, not a safety net. On thin signals the LLM
would invent context to hit the 22-word minimum; a deterministic, honest
template beats a forced, speculative paragraph.
"""
from __future__ import annotations

from typing import Literal

GenerationPath = Literal["llm", "fallback"]


def select_generation_path(payload: dict) -> GenerationPath:
    """Pick the generation path before any LLM call is attempted."""
    sample = payload["sample_size"]["confidence_band"]
    has_evolution = payload["evolution"]["has_evolution"]
    eco_dominant = len(payload["ecosystems"]["dominant"])
    eco_emerging = len(payload["ecosystems"]["emerging"])

    if sample == "minimal":
        return "fallback"

    if sample == "low" and not has_evolution and eco_emerging == 0:
        return "fallback"

    if eco_dominant == 0:
        return "fallback"

    return "llm"

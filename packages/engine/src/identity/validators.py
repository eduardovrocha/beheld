"""Payload-and-output validation for the identity phrase generator.

Two validation surfaces:

1. `validate_payload`  — runs against the JSON Schema before any generation
   path is selected. A failure here means the classifier produced an invalid
   payload; the orchestrator falls straight to the minimal template.

2. `validate_output`   — runs on every generation result (LLM or fallback).
   Splits into "security" rules (blacklist, forbidden opening, trailing
   punctuation, confidence enum) applied to both paths and "quality" rules
   (word counts) applied with relaxed bounds for the fallback.
"""
from __future__ import annotations

from typing import Literal

import jsonschema

from .schema import SIGNALS_SCHEMA_V1

GenerationPath = Literal["llm", "fallback"]

WORD_COUNT_RANGES: dict[str, dict[str, tuple[int, int]]] = {
    "llm":      {"long": (22, 35), "short": (3, 7)},
    "fallback": {"long": (12, 25), "short": (1, 5)},
}

# Adjetivos avaliativos e buzzwords proibidos em identity_long. Mantém a
# frase como descrição de comportamento — não como elogio.
BLACKLIST: set[str] = {
    "talentoso", "experiente", "versátil", "sólido", "habilidoso",
    "expert", "senior", "ninja", "rockstar", "passionate", "driven",
    "skilled", "proficient", "excepcional", "extraordinário",
    "incomparável", "destaque", "elite", "full-stack",
}

VALID_CONFIDENCE = {"high", "medium", "low"}

_FORBIDDEN_OPENING = "Você é um desenvolvedor"
_PUNCT_STRIP = ".,;:!?\"'()[]"


def validate_payload(payload: dict) -> None:
    """Raise jsonschema.ValidationError if payload doesn't match v1 schema."""
    jsonschema.validate(payload, SIGNALS_SCHEMA_V1)


def validate_output(
    output: dict,
    path: GenerationPath,
) -> tuple[bool, str | None]:
    """Return (is_valid, error_reason). Reasons are stable identifiers used
    for telemetry and retry logic — do not turn them into free text."""
    if not isinstance(output, dict):
        return False, "not_a_dict"

    for key in ("identity_long", "identity_short", "confidence"):
        if key not in output or not isinstance(output[key], str):
            return False, f"missing_or_non_string_{key}"

    long_text = output["identity_long"]
    short_text = output["identity_short"]
    confidence = output["confidence"]

    # ── security rules (both paths) ───────────────────────────────────────
    long_words_lower = [w.strip(_PUNCT_STRIP).lower() for w in long_text.split()]
    if any(w in BLACKLIST for w in long_words_lower):
        return False, "blacklist_violation"

    if long_text.startswith(_FORBIDDEN_OPENING):
        return False, "forbidden_opening"

    if short_text.rstrip().endswith((".", "!", "?")):
        return False, "trailing_punctuation"

    if confidence not in VALID_CONFIDENCE:
        return False, "invalid_confidence"

    # ── quality rules (range varies by path) ──────────────────────────────
    ranges = WORD_COUNT_RANGES[path]
    long_count = len(long_text.split())
    short_count = len(short_text.split())

    long_lo, long_hi = ranges["long"]
    if not (long_lo <= long_count <= long_hi):
        return False, f"long_word_count_out_of_range_{path}"

    short_lo, short_hi = ranges["short"]
    if not (short_lo <= short_count <= short_hi):
        return False, f"short_word_count_out_of_range_{path}"

    return True, None

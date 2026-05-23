"""Validator tests — schema, blacklist, word-count ranges, dual rules."""
from __future__ import annotations

import jsonschema
import pytest

from identity.validators import (
    BLACKLIST, WORD_COUNT_RANGES, validate_output, validate_payload,
)


# ── validate_payload (schema check) ───────────────────────────────────────────

def test_payload_valid_against_schema(payload_rich):
    validate_payload(payload_rich)  # should not raise


def test_payload_missing_required_field_fails(payload_rich):
    del payload_rich["ecosystems"]
    with pytest.raises(jsonschema.ValidationError):
        validate_payload(payload_rich)


def test_payload_unknown_ecosystem_fails(payload_rich):
    payload_rich["ecosystems"]["dominant"] = ["cobol"]
    with pytest.raises(jsonschema.ValidationError):
        validate_payload(payload_rich)


def test_payload_wrong_schema_version_fails(payload_rich):
    payload_rich["schema_version"] = "2"
    with pytest.raises(jsonschema.ValidationError):
        validate_payload(payload_rich)


def test_payload_additional_property_fails(payload_rich):
    payload_rich["mystery_field"] = "leaked"
    with pytest.raises(jsonschema.ValidationError):
        validate_payload(payload_rich)


# ── validate_output: security (both paths) ────────────────────────────────────

def _ok_llm() -> dict:
    return {
        "identity_long": (
            "Dev backend de raiz Rails que migrou para Python nos últimos "
            "dois anos, com forte disciplina de testes e ritmo concentrado "
            "entre 14h e 19h."
        ),
        "identity_short": "Dev backend · Rails → Python",
        "confidence": "high",
    }


def test_output_happy_llm_path():
    ok, reason = validate_output(_ok_llm(), "llm")
    assert ok, reason


def test_output_blacklist_rejected_llm():
    out = _ok_llm()
    out["identity_long"] = out["identity_long"].replace("forte", "talentoso")
    ok, reason = validate_output(out, "llm")
    assert not ok
    assert reason == "blacklist_violation"


def test_output_blacklist_rejected_fallback():
    out = {
        "identity_long": "Dev Node experiente com testes e ritmo distribuído ao longo do dia hoje.",
        "identity_short": "Backend · Node",
        "confidence": "low",
    }
    ok, reason = validate_output(out, "fallback")
    assert not ok
    assert reason == "blacklist_violation"


@pytest.mark.parametrize("bad_word", sorted(BLACKLIST))
def test_each_blacklist_word_is_rejected(bad_word):
    out = {
        "identity_long": (
            f"Dev backend {bad_word} com disciplina forte de testes e ritmo "
            f"concentrado nas tardes, trabalhando em Docker e Postgres."
        ),
        "identity_short": "Backend · Rails",
        "confidence": "high",
    }
    ok, reason = validate_output(out, "llm")
    assert not ok
    assert reason == "blacklist_violation"


def test_output_forbidden_opening_rejected():
    out = _ok_llm()
    out["identity_long"] = "Você é um desenvolvedor que escreve código todo dia muito bem, com testes e ritmo concentrado nas tardes em Postgres."
    ok, reason = validate_output(out, "llm")
    assert not ok
    assert reason == "forbidden_opening"


def test_output_trailing_punctuation_in_short_rejected():
    out = _ok_llm()
    out["identity_short"] = "Dev backend · Rails."
    ok, reason = validate_output(out, "llm")
    assert not ok
    assert reason == "trailing_punctuation"


def test_output_invalid_confidence_rejected():
    out = _ok_llm()
    out["confidence"] = "absolute"
    ok, reason = validate_output(out, "llm")
    assert not ok
    assert reason == "invalid_confidence"


def test_output_missing_field_rejected():
    out = _ok_llm()
    del out["identity_short"]
    ok, reason = validate_output(out, "llm")
    assert not ok
    assert "identity_short" in reason


# ── validate_output: quality (word counts per path) ───────────────────────────

def test_short_phrase_too_long_for_llm():
    out = _ok_llm()
    out["identity_short"] = "Dev backend especialista em Rails e Python e Docker"  # 8 words
    ok, reason = validate_output(out, "llm")
    assert not ok
    assert reason == "short_word_count_out_of_range_llm"


def test_long_phrase_too_short_for_llm():
    out = _ok_llm()
    out["identity_long"] = "Dev backend Rails Python testes."  # 5 words
    ok, reason = validate_output(out, "llm")
    assert not ok
    assert reason == "long_word_count_out_of_range_llm"


def test_fallback_accepts_shorter_long_phrase():
    out = {
        "identity_long": "Dev Node em fase inicial de captura do perfil, com primeiros sinais em GitHub.",  # 14 words
        "identity_short": "Backend · Node",
        "confidence": "low",
    }
    ok, reason = validate_output(out, "fallback")
    assert ok, reason


def test_llm_rejects_what_fallback_accepts():
    out = {
        "identity_long": "Dev Node em fase inicial de captura do perfil, com primeiros sinais em GitHub.",
        "identity_short": "Backend · Node",
        "confidence": "low",
    }
    # 14 words for long is in [12, 25] (fallback) but below 22 (llm)
    fb_ok, _ = validate_output(out, "fallback")
    llm_ok, llm_reason = validate_output(out, "llm")
    assert fb_ok
    assert not llm_ok
    assert llm_reason == "long_word_count_out_of_range_llm"


def test_fallback_accepts_single_word_short():
    out = {
        "identity_long": "Dev Python com disciplina moderada de testes e ritmo distribuído ao longo do dia.",
        "identity_short": "Python",  # 1 word, ok for fallback
        "confidence": "low",
    }
    ok, reason = validate_output(out, "fallback")
    assert ok, reason


def test_llm_rejects_single_word_short():
    out = {
        "identity_long": (
            "Dev backend de raiz Rails que migrou para Python nos últimos "
            "dois anos, com forte disciplina de testes e ritmo concentrado "
            "entre 14h e 19h."
        ),
        "identity_short": "Python",
        "confidence": "high",
    }
    ok, reason = validate_output(out, "llm")
    assert not ok
    assert reason == "short_word_count_out_of_range_llm"


def test_word_count_ranges_constant_shape():
    assert WORD_COUNT_RANGES["llm"]["long"] == (22, 35)
    assert WORD_COUNT_RANGES["llm"]["short"] == (3, 7)
    assert WORD_COUNT_RANGES["fallback"]["long"] == (12, 25)
    assert WORD_COUNT_RANGES["fallback"]["short"] == (1, 5)

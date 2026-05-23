"""LLMGenerator — retry loop, JSON parsing, validation."""
from __future__ import annotations

import json

import pytest

from identity.llm import LLMGenerator, MAX_ATTEMPTS, MODEL_NAME


class _StubCall:
    """Captures call args and returns a scripted sequence of responses."""

    def __init__(self, responses: list):
        self._responses = list(responses)
        self.calls: list[tuple[str, int, float, str, str]] = []

    def __call__(self, model, max_tokens, temperature, system, user_content):
        self.calls.append((model, max_tokens, temperature, system, user_content))
        if not self._responses:
            raise AssertionError("stub ran out of scripted responses")
        item = self._responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


_GOOD_RESPONSE = json.dumps({
    "identity_long": (
        "Dev backend de raiz Rails que migrou para Python nos últimos dois anos, "
        "com forte disciplina de testes e ritmo concentrado entre 14h e 19h."
    ),
    "identity_short": "Dev backend · Rails → Python",
    "confidence": "high",
})


def test_llm_happy_path_first_attempt(payload_rich):
    stub = _StubCall([_GOOD_RESPONSE])
    gen = LLMGenerator(call_fn=stub)
    result = gen.generate(payload_rich)
    assert result is not None
    assert result["identity_short"] == "Dev backend · Rails → Python"
    assert len(stub.calls) == 1
    # The model id is what the spec requires
    assert stub.calls[0][0] == MODEL_NAME


def test_llm_retries_after_invalid_json_then_succeeds(payload_rich):
    stub = _StubCall(["not a json {{", _GOOD_RESPONSE])
    gen = LLMGenerator(call_fn=stub)
    result = gen.generate(payload_rich)
    assert result is not None
    assert len(stub.calls) == 2


def test_llm_retries_after_blacklist_violation_then_succeeds(payload_rich):
    bad = json.dumps({
        "identity_long": (
            "Você é talentoso, com forte disciplina de testes e ritmo concentrado "
            "nas tardes em Docker e Postgres todos os dias úteis da semana cheia."
        ),
        "identity_short": "Dev backend · Rails → Python",
        "confidence": "high",
    })
    stub = _StubCall([bad, _GOOD_RESPONSE])
    gen = LLMGenerator(call_fn=stub)
    result = gen.generate(payload_rich)
    assert result is not None
    assert len(stub.calls) == 2


def test_llm_gives_up_after_max_attempts(payload_rich):
    # All three attempts return invalid JSON
    stub = _StubCall(["bad", "still bad", "also bad"])
    gen = LLMGenerator(call_fn=stub)
    result = gen.generate(payload_rich)
    assert result is None
    assert len(stub.calls) == MAX_ATTEMPTS


def test_llm_transport_error_counts_as_attempt(payload_rich):
    err = RuntimeError("network exploded")
    stub = _StubCall([err, err, err])
    gen = LLMGenerator(call_fn=stub)
    result = gen.generate(payload_rich)
    assert result is None
    assert len(stub.calls) == MAX_ATTEMPTS


def test_llm_tolerates_fenced_code_block(payload_rich):
    fenced = "```json\n" + _GOOD_RESPONSE + "\n```"
    stub = _StubCall([fenced])
    gen = LLMGenerator(call_fn=stub)
    result = gen.generate(payload_rich)
    assert result is not None


def test_llm_passes_payload_in_user_message(payload_rich):
    stub = _StubCall([_GOOD_RESPONSE])
    gen = LLMGenerator(call_fn=stub)
    gen.generate(payload_rich)
    _, _, _, _, user_content = stub.calls[0]
    assert "rails" in user_content  # ecosystem id present
    assert "schema_version" in user_content

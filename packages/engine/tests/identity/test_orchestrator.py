"""Orchestrator — full flow: schema → path → LLM/fallback → minimal."""
from __future__ import annotations

import json

import pytest

from identity.fallback import FallbackGenerator
from identity.llm import LLMGenerator, MODEL_NAME
from identity.orchestrator import IdentityGenerator, IdentityResult, MINIMAL_TEMPLATE


class _Stub:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = 0

    def __call__(self, *args):
        self.calls += 1
        item = self._responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


_GOOD = json.dumps({
    "identity_long": (
        "Dev backend de raiz Rails que migrou para Python nos últimos dois anos, "
        "com forte disciplina de testes e ritmo concentrado entre 14h e 19h."
    ),
    "identity_short": "Dev backend · Rails → Python",
    "confidence": "high",
})


def _build_orchestrator(llm_responses=None) -> IdentityGenerator:
    stub = _Stub(llm_responses or [_GOOD])
    return IdentityGenerator(
        db=None,
        llm=LLMGenerator(call_fn=stub),
        fallback=FallbackGenerator(),
    ), stub


# ── happy path ───────────────────────────────────────────────────────────────

def test_orchestrator_llm_happy(payload_rich):
    orch, stub = _build_orchestrator([_GOOD])
    result = orch.generate(payload_rich, persist=False)
    assert isinstance(result, IdentityResult)
    assert result.generation_path == "llm"
    assert result.model_used == MODEL_NAME
    assert stub.calls == 1


def test_orchestrator_fallback_for_minimal_band(payload_minimal):
    orch, stub = _build_orchestrator([_GOOD])  # LLM should never be called
    result = orch.generate(payload_minimal, persist=False)
    assert result.generation_path == "fallback"
    assert result.model_used is None
    assert result.confidence == "low"
    assert stub.calls == 0  # selector short-circuited


def test_orchestrator_fallback_for_low_band_no_evolution(payload_flutter_low):
    orch, stub = _build_orchestrator([_GOOD])
    result = orch.generate(payload_flutter_low, persist=False)
    assert result.generation_path == "fallback"
    assert stub.calls == 0


# ── LLM failure → fallback ───────────────────────────────────────────────────

def test_orchestrator_falls_back_after_llm_exhausts(payload_rich):
    orch, stub = _build_orchestrator(["bad", "still bad", "also bad"])
    result = orch.generate(payload_rich, persist=False)
    assert result.generation_path == "fallback"
    assert result.model_used is None
    assert stub.calls == 3  # all retries consumed


# ── minimal template (catastrophic) ──────────────────────────────────────────

def test_orchestrator_minimal_on_invalid_payload(payload_rich):
    payload_rich["ecosystems"]["dominant"] = ["cobol"]  # schema violation
    orch, _ = _build_orchestrator([_GOOD])
    result = orch.generate(payload_rich, persist=False)
    assert result.generation_path == "minimal_template"
    assert result.identity_long == MINIMAL_TEMPLATE["identity_long"]
    assert result.identity_short == MINIMAL_TEMPLATE["identity_short"]


def test_orchestrator_minimal_when_fallback_safety_fails(payload_minimal, monkeypatch):
    """Simulate a fallback that emits a blacklisted word — security rule
    forces minimal_template even when fallback's quality range is relaxed."""
    class BadFallback:
        def generate(self, payload):
            return {
                # Contains "talentoso" → security rule violation
                "identity_long": "Dev Node talentoso com primeiros sinais em GitHub hoje.",
                "identity_short": "Backend · Node",
                "confidence": "low",
            }
    orch = IdentityGenerator(db=None, llm=LLMGenerator(call_fn=_Stub([])),
                             fallback=BadFallback())
    result = orch.generate(payload_minimal, persist=False)
    assert result.generation_path == "minimal_template"


# ── persistence ──────────────────────────────────────────────────────────────

def test_orchestrator_persists_to_db(tmp_path, payload_rich):
    from storage.sqlite import BeheldDB
    db = BeheldDB(tmp_path / "p.db")
    db.init_schema()

    orch = IdentityGenerator(
        db=db,
        llm=LLMGenerator(call_fn=_Stub([_GOOD])),
        fallback=FallbackGenerator(),
    )
    result = orch.generate(payload_rich, snapshot_id=None, persist=True)

    latest = db.get_latest_identity_phrase()
    assert latest is not None
    assert latest["long"] == result.identity_long
    assert latest["short"] == result.identity_short
    assert latest["generation_path"] == "llm"
    assert latest["model_used"] == MODEL_NAME


def test_orchestrator_persists_with_snapshot_id(tmp_path, payload_minimal):
    from storage.sqlite import BeheldDB
    db = BeheldDB(tmp_path / "p.db")
    db.init_schema()
    # Create a snapshot to link to
    snap_id = db.save_snapshot(
        bundle_hash="sha256:" + "0" * 64,
        previous_hash=None,
        payload_json="{}",
        bundle_path=None,
    )

    orch = IdentityGenerator(db=db)
    result = orch.generate(payload_minimal, snapshot_id=snap_id, persist=True)

    fetched = db.get_identity_phrase(snap_id)
    assert fetched is not None
    assert fetched["generation_path"] == result.generation_path


def test_orchestrator_replaces_phrase_on_same_snapshot(tmp_path, payload_minimal):
    from storage.sqlite import BeheldDB
    db = BeheldDB(tmp_path / "p.db")
    db.init_schema()
    snap_id = db.save_snapshot("sha256:" + "0" * 64, None, "{}")

    orch = IdentityGenerator(db=db)
    orch.generate(payload_minimal, snapshot_id=snap_id, persist=True)
    orch.generate(payload_minimal, snapshot_id=snap_id, persist=True)

    counts = db.count_identity_phrases_by_path()
    assert sum(counts.values()) == 1  # replace, not append

"""Path selection — LLM vs fallback decision."""
from __future__ import annotations

from identity.selector import select_generation_path


def test_rich_payload_routes_to_llm(payload_rich):
    assert select_generation_path(payload_rich) == "llm"


def test_minimal_band_routes_to_fallback(payload_minimal):
    assert select_generation_path(payload_minimal) == "fallback"


def test_low_band_without_evolution_or_emerging_routes_to_fallback(payload_flutter_low):
    assert select_generation_path(payload_flutter_low) == "fallback"


def test_low_band_with_evolution_still_routes_to_llm(payload_flutter_low):
    payload_flutter_low["evolution"]["has_evolution"] = True
    payload_flutter_low["evolution"]["trajectory"] = "test_maturity_growth"
    assert select_generation_path(payload_flutter_low) == "llm"


def test_low_band_with_emerging_still_routes_to_llm(payload_flutter_low):
    payload_flutter_low["ecosystems"]["emerging"] = ["python"]
    assert select_generation_path(payload_flutter_low) == "llm"


def test_no_dominant_routes_to_fallback(payload_rich):
    payload_rich["ecosystems"]["dominant"] = []
    assert select_generation_path(payload_rich) == "fallback"


def test_generalist_two_dominants_routes_to_llm(payload_generalist):
    # medium band + two dominants is enough narrative for the LLM
    assert select_generation_path(payload_generalist) == "llm"


def test_go_to_rust_routes_to_llm(payload_go_to_rust):
    assert select_generation_path(payload_go_to_rust) == "llm"

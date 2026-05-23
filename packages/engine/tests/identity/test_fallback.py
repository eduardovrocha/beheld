"""Fallback templates — long (A/B) and short (hierarchy cases 1–4)."""
from __future__ import annotations

import pytest

from identity.fallback import FallbackGenerator
from identity.labels import DOMAIN_LABELS
from identity.validators import validate_output


@pytest.fixture
def gen() -> FallbackGenerator:
    return FallbackGenerator()


# ── identity_long: Template A (minimal) ───────────────────────────────────────

def test_long_template_a_renders_for_minimal_band(gen, payload_minimal):
    out = gen.generate(payload_minimal)
    assert "Dev Node em fase inicial de captura do perfil" in out["identity_long"]
    assert "GitHub" in out["identity_long"]


def test_template_a_uses_first_platform_when_multiple(gen, payload_minimal):
    payload_minimal["tooling"]["platforms"] = ["github_actions", "github", "docker"]
    out = gen.generate(payload_minimal)
    assert "GitHub Actions" in out["identity_long"]


# ── identity_long: Template B (low / fallback secondary) ──────────────────────

def test_long_template_b_renders_for_flutter_low(gen, payload_flutter_low):
    out = gen.generate(payload_flutter_low)
    assert "Dev Flutter" in out["identity_long"]
    assert "disciplina moderada de testes" in out["identity_long"]
    assert "concentrado nas noites" in out["identity_long"]
    assert "GitHub" in out["identity_long"]


def test_long_template_b_omits_evolution_temporal(gen, payload_flutter_low):
    """Template B doesn't claim evolution that isn't there."""
    out = gen.generate(payload_flutter_low)
    assert "últimos" not in out["identity_long"]
    assert "anos" not in out["identity_long"]


# ── identity_short: hierarchy ─────────────────────────────────────────────────

def test_short_case_1_with_emerging(gen, payload_rich):
    """dominant=[rails], emerging=[python] → "Backend · Rails → Python" """
    out = gen.generate(payload_rich)
    assert out["identity_short"] == "Backend · Rails → Python"


def test_short_case_1_with_declining(gen, payload_go_to_rust):
    """dominant=[rust], declining=[go] → "Sistemas · Go → Rust" """
    out = gen.generate(payload_go_to_rust)
    assert out["identity_short"] == "Sistemas · Go → Rust"


def test_short_case_2_with_secondary(gen, payload_flutter_low):
    """dominant=[flutter], secondary=[dotnet] → "Mobile · Flutter e Dotnet"

    Different domains (Mobile vs Backend) → falls back to "Generalista".
    """
    out = gen.generate(payload_flutter_low)
    assert out["identity_short"] == "Generalista · Flutter e Dotnet"


def test_short_case_2_two_dominants(gen, payload_generalist):
    """Two dominants in different domains → "Generalista · Node e Python" """
    out = gen.generate(payload_generalist)
    assert out["identity_short"] == "Generalista · Node e Python"


def test_short_case_3_only_dominant_with_mapping(gen, payload_minimal):
    """dominant=[node], no secondary/emerging/declining → "Backend · Node" """
    out = gen.generate(payload_minimal)
    assert out["identity_short"] == "Backend · Node"


def test_short_case_4_only_dominant_no_mapping(gen, payload_minimal):
    """python sozinho não tem domain → cai no caso 4."""
    payload_minimal["ecosystems"]["dominant"] = ["python"]
    out = gen.generate(payload_minimal)
    assert out["identity_short"] == "Python"


# ── domain mapping coverage ───────────────────────────────────────────────────

@pytest.mark.parametrize("eco_id,expected_domain", sorted(DOMAIN_LABELS.items()))
def test_domain_mapping_renders_case_3(gen, payload_minimal, eco_id, expected_domain):
    payload_minimal["ecosystems"]["dominant"] = [eco_id]
    out = gen.generate(payload_minimal)
    assert out["identity_short"].startswith(f"{expected_domain} ·"), out["identity_short"]


# ── confidence and validation ─────────────────────────────────────────────────

def test_fallback_always_confidence_low(
    gen, payload_minimal, payload_flutter_low, payload_rich
):
    for payload in (payload_minimal, payload_flutter_low, payload_rich):
        assert gen.generate(payload)["confidence"] == "low"


def test_fallback_output_passes_validation_for_minimal(gen, payload_minimal):
    out = gen.generate(payload_minimal)
    ok, reason = validate_output(out, "fallback")
    assert ok, reason


def test_fallback_output_passes_validation_for_low(gen, payload_flutter_low):
    out = gen.generate(payload_flutter_low)
    ok, reason = validate_output(out, "fallback")
    assert ok, reason

"""Rule-based identity phrase generator.

Produces honest, deterministic prose from limited signals. Used when:

- `select_generation_path` returns "fallback" up front (sinais minimais
  ou escassos demais para o LLM narrar sem inventar)
- The LLM path exhausted its retries without producing a valid output

Confidence is always "low" — fallback never claims high certainty.
"""
from __future__ import annotations

from typing import Literal

from .labels import (
    DOMAIN_LABELS, ECOSYSTEM_LABELS, PLATFORM_LABELS,
    TEST_DISCIPLINE_LABELS, TIMING_LABELS, join_platforms,
)


def _eco_label(eco_id: str) -> str:
    return ECOSYSTEM_LABELS.get(eco_id, eco_id.title())


def _platform_label(plat_id: str) -> str:
    return PLATFORM_LABELS.get(plat_id, plat_id.title())


def _first_or_none(seq: list[str]) -> str | None:
    return seq[0] if seq else None


def _build_long(payload: dict) -> str:
    """Pick template A (sinais mínimos) or B (sinais escassos) based on
    confidence band, then render."""
    sample = payload["sample_size"]["confidence_band"]
    dominant = _first_or_none(payload["ecosystems"]["dominant"]) or "node"
    eco_label = _eco_label(dominant)
    platforms = payload["tooling"]["platforms"]

    if sample == "minimal":
        # Template A — honesto sobre dados escassos, sem julgar o dev.
        # "primeiros sinais" preserva dignidade enquanto sinaliza que o
        # retrato ainda está em construção.
        primary_platform = _platform_label(platforms[0]) if platforms else "GitHub"
        return (
            f"Dev {eco_label} em fase inicial de captura do perfil, "
            f"com primeiros sinais em {primary_platform}."
        )

    # Template B — sinais escassos mas existem (low / fallback após LLM falhou).
    discipline = payload["test_pattern"]["discipline"]
    peak = payload["timing"]["peak_period"]
    test_label = TEST_DISCIPLINE_LABELS.get(discipline, "disciplina moderada")
    timing_label = TIMING_LABELS.get(peak, "distribuído ao longo do dia")
    platforms_label = join_platforms(platforms, limit=2) if platforms else "ferramentas próprias"

    return (
        f"Dev {eco_label} com {test_label} de testes "
        f"e ritmo {timing_label}, trabalhando com {platforms_label}."
    )


def _build_short(payload: dict) -> str:
    """Top-down hierarchy: first matching case wins.

    1. Transformação clara (emerging ou declining)
    2. Secondary relevante (ou segundo dominant)
    3. Apenas dominant, com mapping de domínio
    4. Apenas dominant, sem mapping (caso raro de 1 palavra)
    """
    ecos = payload["ecosystems"]
    dominant = ecos["dominant"]
    secondary = ecos["secondary"]
    emerging = ecos["emerging"]
    declining = ecos["declining"]

    if not dominant:
        # Should never happen for fallback path (selector requires dominant),
        # but guard anyway. Caller can intercept and use minimal template.
        return "Retrato em construção"

    dom_id = dominant[0]
    dom_label = _eco_label(dom_id)
    domain = DOMAIN_LABELS.get(dom_id)

    # Caso 1 — transformação
    if declining:
        old = _eco_label(declining[0])
        head = domain or dom_label
        return f"{head} · {old} → {dom_label}"
    if emerging:
        new = _eco_label(emerging[0])
        head = domain or dom_label
        return f"{head} · {dom_label} → {new}"

    # Caso 2 — secondary OU segundo dominant
    second_id: str | None = None
    if len(dominant) >= 2:
        second_id = dominant[1]
    elif secondary:
        second_id = secondary[0]

    if second_id is not None:
        second_label = _eco_label(second_id)
        # "Generalista" é o head honesto quando os dois ecosystems não
        # convergem no mesmo bucket de domínio — forçar o domínio do
        # primeiro depreciaria o segundo.
        domain_second = DOMAIN_LABELS.get(second_id)
        head = domain if (domain and domain_second == domain) else "Generalista"
        return f"{head} · {dom_label} e {second_label}"

    # Caso 3 — domain mapping disponível
    if domain:
        return f"{domain} · {dom_label}"

    # Caso 4 — sem mapping; nome bruto (1 palavra). Badge SVG ajusta layout.
    return dom_label


class FallbackGenerator:
    """Stateless generator. Caller is the orchestrator."""

    def generate(self, payload: dict) -> dict:
        return {
            "identity_long": _build_long(payload),
            "identity_short": _build_short(payload),
            "confidence": "low",
        }

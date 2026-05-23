"""Top-level driver for the identity phrase generator.

Glues together: schema validation → path selection → LLM or fallback →
output validation → fallback-after-LLM-failure → minimal template → persist.

The minimal template is the real safety net. It exists for catastrophic
states (classifier bug, corrupted payload, fallback itself failed safety
validation). Quando usado, sinaliza alerta interno.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal, Optional

import jsonschema

from .fallback import FallbackGenerator
from .llm import LLMGenerator, MODEL_NAME
from .selector import GenerationPath, select_generation_path
from .validators import validate_output, validate_payload

logger = logging.getLogger(__name__)

GenerationPathStored = Literal["llm", "fallback", "minimal_template"]


MINIMAL_TEMPLATE: dict = {
    "identity_long": "Retrato em construção — primeiros sinais sendo capturados.",
    "identity_short": "Retrato em construção",
    "confidence": "low",
}


@dataclass(frozen=True)
class IdentityResult:
    identity_long: str
    identity_short: str
    confidence: str
    generation_path: GenerationPathStored
    model_used: Optional[str]

    def to_dict(self) -> dict:
        return {
            "identity_long": self.identity_long,
            "identity_short": self.identity_short,
            "confidence": self.confidence,
            "generation_path": self.generation_path,
            "model_used": self.model_used,
        }


class IdentityGenerator:
    """Orchestrates the full flow described in the spec.

    Usage:
        gen = IdentityGenerator(db)
        result = gen.generate(signals_payload, snapshot_id=42)
    """

    def __init__(
        self,
        db=None,
        llm: Optional[LLMGenerator] = None,
        fallback: Optional[FallbackGenerator] = None,
    ) -> None:
        self._db = db
        self._llm = llm or LLMGenerator()
        self._fallback = fallback or FallbackGenerator()

    def generate(
        self,
        payload: dict,
        snapshot_id: Optional[int] = None,
        persist: bool = True,
    ) -> IdentityResult:
        # Step 0 — validate the payload against the v1 schema. A failure here
        # is a classifier bug; jump straight to the minimal template.
        try:
            validate_payload(payload)
        except jsonschema.ValidationError as exc:
            logger.error("identity payload failed schema validation: %s", exc.message)
            return self._emit_minimal(snapshot_id, persist, reason="schema_violation")

        # Step 1 — pick the path based on signal richness.
        path: GenerationPath = select_generation_path(payload)

        # Step 2 — LLM path with retries.
        if path == "llm":
            llm_output = self._llm.generate(payload)
            if llm_output is not None:
                return self._emit(
                    llm_output, "llm", MODEL_NAME, snapshot_id, persist,
                )
            # LLM gave up after MAX_ATTEMPTS — drop into fallback.
            logger.warning("LLM exhausted retries; falling back to template path")
            path = "fallback"

        # Step 3 — fallback path.
        fallback_output = self._fallback.generate(payload)
        ok, reason = validate_output(fallback_output, "fallback")
        if ok:
            return self._emit(
                fallback_output, "fallback", None, snapshot_id, persist,
            )

        logger.error("fallback output failed validation: %s", reason)
        return self._emit_minimal(snapshot_id, persist, reason=reason)

    # ── internals ─────────────────────────────────────────────────────────

    def _emit(
        self,
        output: dict,
        path: GenerationPathStored,
        model_used: Optional[str],
        snapshot_id: Optional[int],
        persist: bool,
    ) -> IdentityResult:
        result = IdentityResult(
            identity_long=output["identity_long"],
            identity_short=output["identity_short"],
            confidence=output["confidence"],
            generation_path=path,
            model_used=model_used,
        )
        if persist and self._db is not None:
            self._db.save_identity_phrase(
                long=result.identity_long,
                short=result.identity_short,
                confidence=result.confidence,
                generation_path=result.generation_path,
                model_used=result.model_used,
                snapshot_id=snapshot_id,
            )
        return result

    def _emit_minimal(
        self,
        snapshot_id: Optional[int],
        persist: bool,
        reason: Optional[str],
    ) -> IdentityResult:
        # Alerta interno — em produção, este caminho dispara monitoramento.
        # O logger é o ponto de instrumentação (handler externo coleta).
        logger.error("minimal_template emitted (reason=%s, snapshot_id=%s)",
                     reason, snapshot_id)
        return self._emit(
            MINIMAL_TEMPLATE, "minimal_template", None, snapshot_id, persist,
        )

"""Identity phrase generator — destila sinais comportamentais em frase pública.

Public API:

- `IdentityGenerator`    — orchestrator wiring LLM + fallback + minimal template
- `IdentityResult`       — frozen dataclass returned by generate()
- `select_generation_path` — pure decision function (LLM vs fallback)
- `validate_payload`     — JSON Schema check before any generation
- `validate_output`      — security + quality rules per path
- `MINIMAL_TEMPLATE`     — last-resort phrase for catastrophic failures

See `documents/identity-phrase-generator.md` for the full spec.
"""
from __future__ import annotations

from .fallback import FallbackGenerator
from .llm import LLMGenerator, MODEL_NAME, SYSTEM_PROMPT
from .orchestrator import IdentityGenerator, IdentityResult, MINIMAL_TEMPLATE
from .selector import select_generation_path
from .validators import (
    BLACKLIST,
    WORD_COUNT_RANGES,
    validate_output,
    validate_payload,
)

__all__ = [
    "IdentityGenerator",
    "IdentityResult",
    "FallbackGenerator",
    "LLMGenerator",
    "MODEL_NAME",
    "SYSTEM_PROMPT",
    "MINIMAL_TEMPLATE",
    "select_generation_path",
    "validate_payload",
    "validate_output",
    "BLACKLIST",
    "WORD_COUNT_RANGES",
]

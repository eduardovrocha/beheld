"""
Resolução de ambiente para o scoring engine.

Espelha `packages/cli/src/config/env.ts` no comportamento:

    BEHELD_ENV=production   (default) → beheld.dev + rekor.sigstore.dev
    BEHELD_ENV=development            → localhost:3000 + rekor.sigstage.dev

Default é `production` porque a CLI (que orquestra o engine) é distribuída
via `curl | sh` e precisa apontar a infra real sem nenhuma config.

Overrides individuais têm precedência sobre `BEHELD_ENV`:

    BEHELD_API_URL    → sobrescreve API base (Rails)
    BEHELD_PORTAL_URL → sobrescreve portal URL
    BEHELD_REKOR_URL  → sobrescreve Rekor URL
    BEHELD_OLLAMA_URL → sobrescreve Ollama (default é local, raramente trocado)

O engine hoje não faz chamadas remotas para beheld.dev / Rekor — toda
interação remota acontece via CLI/MCP. Este módulo existe para:
  1. Manter consistência arquitetural entre CLI (TS) e engine (Python).
  2. Suportar override do Ollama URL para testes.
  3. Estar pronto para uso quando o engine precisar dessas URLs.
"""

from __future__ import annotations

import os
from typing import Literal

BeheldEnv = Literal["production", "development"]

_DEFAULTS = {
    "production": {
        "api": "https://beheld.dev",
        "portal": "https://beheld.dev",
        "rekor": "https://rekor.sigstore.dev",
    },
    "development": {
        "api": "http://localhost:3000",
        "portal": "http://localhost:3000",
        "rekor": "https://rekor.sigstage.dev",
    },
}

_OLLAMA_DEFAULT = "http://localhost:11434"


def _strip_trailing(url: str) -> str:
    return url.rstrip("/")


def get_env() -> BeheldEnv:
    """Reads BEHELD_ENV from the environment. Defaults to 'production'.

    Unknown values fall back to 'production' silently so a typo never
    takes the engine offline. Aliases: 'dev', 'local' → 'development'.
    """
    raw = os.environ.get("BEHELD_ENV", "").strip().lower()
    if raw in ("development", "dev", "local"):
        return "development"
    return "production"


def get_api_base_url() -> str:
    """Backend Rails base URL. Override via BEHELD_API_URL."""
    override = os.environ.get("BEHELD_API_URL", "").strip()
    if override:
        return _strip_trailing(override)
    return _DEFAULTS[get_env()]["api"]


def get_portal_url() -> str:
    """Portal público URL. Override via BEHELD_PORTAL_URL."""
    override = os.environ.get("BEHELD_PORTAL_URL", "").strip()
    if override:
        return _strip_trailing(override)
    return _DEFAULTS[get_env()]["portal"]


def get_rekor_url() -> str:
    """Sigstore transparency log URL. Override via BEHELD_REKOR_URL."""
    override = os.environ.get("BEHELD_REKOR_URL", "").strip()
    if override:
        return _strip_trailing(override)
    return _DEFAULTS[get_env()]["rekor"]


def get_ollama_url() -> str:
    """Ollama base URL (always local in practice). Override via BEHELD_OLLAMA_URL."""
    override = os.environ.get("BEHELD_OLLAMA_URL", "").strip()
    if override:
        return _strip_trailing(override)
    return _OLLAMA_DEFAULT


def get_api_url() -> str:
    """Convenience: `<api>/api`."""
    return f"{get_api_base_url()}/api"

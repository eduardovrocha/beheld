"""Tests for `packages/engine/src/config.py` env resolution."""

from __future__ import annotations

import os

import pytest

from config import (
    get_env,
    get_api_base_url,
    get_portal_url,
    get_rekor_url,
    get_ollama_url,
    get_api_url,
)

ENV_KEYS = [
    "BEHELD_ENV",
    "BEHELD_API_URL",
    "BEHELD_PORTAL_URL",
    "BEHELD_REKOR_URL",
    "BEHELD_OLLAMA_URL",
]


@pytest.fixture(autouse=True)
def clean_env():
    saved = {k: os.environ.get(k) for k in ENV_KEYS}
    for k in ENV_KEYS:
        os.environ.pop(k, None)
    yield
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


# ── get_env ──────────────────────────────────────────────────────────────────

def test_get_env_default_is_production():
    assert get_env() == "production"


def test_get_env_production_explicit():
    os.environ["BEHELD_ENV"] = "production"
    assert get_env() == "production"


def test_get_env_development():
    os.environ["BEHELD_ENV"] = "development"
    assert get_env() == "development"


@pytest.mark.parametrize("alias", ["dev", "local", "  Development  "])
def test_get_env_aliases_map_to_development(alias: str):
    os.environ["BEHELD_ENV"] = alias
    assert get_env() == "development"


def test_unknown_value_falls_back_to_production():
    os.environ["BEHELD_ENV"] = "staging"
    assert get_env() == "production"


# ── get_api_base_url ─────────────────────────────────────────────────────────

def test_api_base_default_is_beheld_dev():
    assert get_api_base_url() == "https://beheld.dev"


def test_api_base_development_is_localhost():
    os.environ["BEHELD_ENV"] = "development"
    assert get_api_base_url() == "http://localhost:3000"


def test_api_base_override_wins_over_beheld_env():
    os.environ["BEHELD_ENV"] = "production"
    os.environ["BEHELD_API_URL"] = "http://localhost:9999"
    assert get_api_base_url() == "http://localhost:9999"


def test_api_base_override_strips_trailing_slash():
    os.environ["BEHELD_API_URL"] = "http://localhost:3000///"
    assert get_api_base_url() == "http://localhost:3000"


def test_empty_override_falls_back_to_default():
    os.environ["BEHELD_API_URL"] = ""
    assert get_api_base_url() == "https://beheld.dev"


# ── get_portal_url ───────────────────────────────────────────────────────────

def test_portal_default_is_beheld_dev():
    assert get_portal_url() == "https://beheld.dev"


def test_portal_development_is_localhost():
    os.environ["BEHELD_ENV"] = "development"
    assert get_portal_url() == "http://localhost:3000"


def test_portal_override():
    os.environ["BEHELD_PORTAL_URL"] = "http://example.local"
    assert get_portal_url() == "http://example.local"


# ── get_rekor_url ────────────────────────────────────────────────────────────

def test_rekor_default_is_sigstore():
    assert get_rekor_url() == "https://rekor.sigstore.dev"


def test_rekor_development_is_sigstage():
    os.environ["BEHELD_ENV"] = "development"
    assert get_rekor_url() == "https://rekor.sigstage.dev"


def test_rekor_override():
    os.environ["BEHELD_REKOR_URL"] = "https://custom.example/"
    assert get_rekor_url() == "https://custom.example"


# ── get_ollama_url ───────────────────────────────────────────────────────────

def test_ollama_default_is_localhost_11434():
    assert get_ollama_url() == "http://localhost:11434"


def test_ollama_override():
    os.environ["BEHELD_OLLAMA_URL"] = "http://127.0.0.1:11435"
    assert get_ollama_url() == "http://127.0.0.1:11435"


# ── get_api_url ──────────────────────────────────────────────────────────────

def test_api_url_default():
    assert get_api_url() == "https://beheld.dev/api"


def test_api_url_development():
    os.environ["BEHELD_ENV"] = "development"
    assert get_api_url() == "http://localhost:3000/api"

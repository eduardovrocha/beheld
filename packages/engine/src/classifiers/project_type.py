from __future__ import annotations

import os

from config import get_ollama_url
from models import ProjectClassification, TechnicalSignals

PROJECT_CATEGORIES = [
    "api_backend",
    "cli_tool",
    "mobile",
    "web3_blockchain",
    "automation_ai",
    "library_sdk",
    "saas_b2b",
    "financial_data",
]

# Vote mappings: signal key → category
_ECOSYSTEM_VOTES: dict[str, str] = {
    "rails": "api_backend",
    "node": "api_backend",
    "react": "api_backend",
    "python": "api_backend",
    "go": "api_backend",
    "rust": "library_sdk",
    "java": "api_backend",
    "dotnet": "api_backend",
    "php": "api_backend",
    "elixir": "api_backend",
    "flutter": "mobile",
    "swift": "mobile",
    "blockchain": "web3_blockchain",
    "devops": "api_backend",
}

_LANGUAGE_VOTES: dict[str, str] = {
    "solidity": "web3_blockchain",
    "dart": "mobile",
    "swift": "mobile",
    "kotlin": "mobile",
    "r": "financial_data",
}

_PLATFORM_VOTES: dict[str, str] = {
    "mobile": "mobile",
    "blockchain": "web3_blockchain",
    "database": "api_backend",
    "docker": "api_backend",
    "cloud_infra": "api_backend",
    "testing": "api_backend",
    "ci_cd": "api_backend",
    "github": "api_backend",
}

BUSINESS_DOMAIN_TERMS = frozenset([
    "revenue", "customer", "sales", "marketing", "invoice", "employee",
    "payroll", "crm", "erp", "accounting", "insurance", "healthcare",
    "legal", "compliance", "tax", "audit", "billing", "subscription",
])


def _heuristic(signals: TechnicalSignals) -> tuple[str, float, list[str]]:
    votes: dict[str, int] = {c: 0 for c in PROJECT_CATEGORIES}
    matched: list[str] = []

    for eco in signals.ecosystems:
        if eco in _ECOSYSTEM_VOTES:
            votes[_ECOSYSTEM_VOTES[eco]] += 1
            matched.append(f"ecosystem:{eco}")

    for lang in signals.languages:
        if lang in _LANGUAGE_VOTES:
            votes[_LANGUAGE_VOTES[lang]] += 1
            matched.append(f"language:{lang}")

    for platform in signals.platforms:
        if platform in _PLATFORM_VOTES:
            votes[_PLATFORM_VOTES[platform]] += 1
            matched.append(f"platform:{platform}")

    if not any(votes.values()):
        return "unknown", 0.0, []

    best = max(votes, key=lambda k: votes[k])
    # 3 distinct signals → confidence 1.0
    confidence = min(votes[best] / 3.0, 1.0)

    if confidence < 0.30:
        return "unknown", confidence, []

    return best, confidence, matched


def _sanitize_ok(text: str) -> bool:
    lower = text.lower()
    return not any(term in lower for term in BUSINESS_DOMAIN_TERMS)


def _classify_with_anthropic(signals: TechnicalSignals) -> str:
    import anthropic  # lazy import — optional dependency

    signal_desc = ", ".join(
        list(signals.ecosystems.keys())[:5]
        + list(signals.languages.keys())[:3]
        + list(signals.platforms.keys())[:3]
    )
    prompt = (
        f"Based on these technical signals: {signal_desc}\n"
        f"Classify the project type. Reply with ONLY one of these exact words:\n"
        f"{', '.join(PROJECT_CATEGORIES)}\nNo explanation, just the category name."
    )
    client = anthropic.Anthropic()
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=20,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text.strip().lower()


def _classify_with_ollama(signals: TechnicalSignals) -> str:
    import json
    import urllib.request

    signal_desc = ", ".join(
        list(signals.ecosystems.keys())[:5] + list(signals.languages.keys())[:3]
    )
    prompt = f"Technical signals: {signal_desc}\nReply with ONE word from: {', '.join(PROJECT_CATEGORIES)}"
    data = json.dumps(
        {"model": "qwen2.5-coder:14b", "prompt": prompt, "stream": False}
    ).encode()
    req = urllib.request.Request(
        f"{get_ollama_url()}/api/generate",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310
        result = json.loads(resp.read())
    return result.get("response", "").strip().lower()


def classify(signals: TechnicalSignals) -> ProjectClassification:
    """Two-step classifier: local heuristics first, AI fallback when confidence < 0.70."""
    category, confidence, signals_used = _heuristic(signals)

    if confidence >= 0.70:
        return ProjectClassification(category, confidence, signals_used)

    # AI step
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    try:
        raw = _classify_with_anthropic(signals) if api_key else _classify_with_ollama(signals)
        if raw in PROJECT_CATEGORIES and _sanitize_ok(raw):
            return ProjectClassification(raw, 0.65, signals_used + [f"ai:{raw}"])
    except Exception:
        pass

    return ProjectClassification(category, confidence, signals_used)

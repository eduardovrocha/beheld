from __future__ import annotations

from extractors.commands import extract_platforms


def classify_platforms(commands: list[str]) -> list[str]:
    return extract_platforms(commands)

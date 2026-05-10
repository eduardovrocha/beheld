from __future__ import annotations

from extractors.commands import detect_platforms


def classify_platforms(commands: list[str]) -> dict[str, int]:
    return detect_platforms(commands)

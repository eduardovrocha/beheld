"""Canonical file-extension → programming-language mapping (F6.12a).

Used by the L1 extractor to weight a developer's commits by language. Kept
narrow on purpose: only extensions whose presence is unambiguous evidence of
authoring a given language. Markup, config, and asset extensions are listed
in `_IGNORED_EXTENSIONS` so a noise-heavy commit (e.g. one with 30 .md files)
doesn't inflate any language's commit count.

The function signature accepts an extension with or without leading dot, and
both lowercase and original-case input — git ls-tree returns mixed cases."""

from __future__ import annotations

from typing import Optional


# Canonical map. Keys MUST start with `.` and be lowercase.
EXTENSION_TO_LANGUAGE: dict[str, str] = {
    ".rb": "Ruby",
    ".py": "Python",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".go": "Go",
    ".java": "Java",
    ".dart": "Dart",
    ".ex": "Elixir",
    ".exs": "Elixir",
    ".rs": "Rust",
    ".cs": "C#",
    ".php": "PHP",
    ".swift": "Swift",
    ".kt": "Kotlin",
    ".c": "C",
    ".h": "C",
    ".cpp": "C++",
    ".hpp": "C++",
    ".scala": "Scala",
    ".clj": "Clojure",
    ".hs": "Haskell",
    ".lua": "Lua",
    ".r": "R",
    ".m": "Objective-C",
}


# Extensions deliberately excluded from language attribution. Documentation,
# config, markup, and asset files don't represent authored code in a language.
_IGNORED_EXTENSIONS: frozenset[str] = frozenset({
    ".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".lock",
    ".env", ".gitignore", ".svg", ".png", ".jpg", ".jpeg", ".ico",
    ".css", ".scss", ".sass", ".less", ".html", ".htm", ".xml", ".sql",
})


def get_language(extension: str) -> Optional[str]:
    """Map a file extension to its canonical language name.

    Returns None for extensions that are either explicitly ignored (config,
    markup, assets) or not mapped to a known language. Input is normalized:
    leading dot is added if missing and case is lowered.
    """
    if not extension:
        return None
    ext = extension if extension.startswith(".") else "." + extension
    ext = ext.lower()
    if ext in _IGNORED_EXTENSIONS:
        return None
    return EXTENSION_TO_LANGUAGE.get(ext)

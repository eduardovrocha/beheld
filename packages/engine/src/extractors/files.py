from __future__ import annotations

import os

# Maps file extension → ecosystem label
EXTENSION_TO_ECOSYSTEM: dict[str, str] = {
    ".rb": "rails",
    ".erb": "rails",
    ".gemspec": "rails",
    ".ts": "node",
    ".tsx": "react",
    ".js": "node",
    ".jsx": "react",
    ".mjs": "node",
    ".cjs": "node",
    ".vue": "node",
    ".svelte": "node",
    ".py": "python",
    ".ipynb": "python",
    ".dart": "flutter",
    ".tf": "devops",
    ".hcl": "devops",
    ".yaml": "devops",
    ".yml": "devops",
    ".sh": "devops",
    ".bash": "devops",
    ".dockerfile": "devops",
    ".sol": "blockchain",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "java",
    ".swift": "swift",
    ".cs": "dotnet",
    ".php": "php",
    ".ex": "elixir",
    ".exs": "elixir",
    ".hs": "haskell",
    ".elm": "elm",
    ".clj": "clojure",
    ".scala": "scala",
    ".r": "r",
    ".R": "r",
}

# Also match by filename (e.g., "Gemfile", "Dockerfile", "package.json")
FILENAME_TO_ECOSYSTEM: dict[str, str] = {
    "Gemfile": "rails",
    "Rakefile": "rails",
    "package.json": "node",
    "yarn.lock": "node",
    "bun.lockb": "node",
    "requirements.txt": "python",
    "pyproject.toml": "python",
    "setup.py": "python",
    "Pipfile": "python",
    "pubspec.yaml": "flutter",
    "Dockerfile": "devops",
    "docker-compose.yml": "devops",
    "docker-compose.yaml": "devops",
    ".github": "devops",
    "go.mod": "go",
    "Cargo.toml": "rust",
    "pom.xml": "java",
    "build.gradle": "java",
    "Package.swift": "swift",
    "hardhat.config.js": "blockchain",
    "foundry.toml": "blockchain",
}

TEST_FILE_PATTERNS = (".spec.", ".test.", "_spec.", "_test.")

# Extension → programming language
EXTENSION_TO_LANGUAGE: dict[str, str] = {
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".rb": "ruby",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".swift": "swift",
    ".dart": "dart",
    ".cs": "csharp",
    ".php": "php",
    ".ex": "elixir",
    ".exs": "elixir",
    ".hs": "haskell",
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
    ".sql": "sql",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".sol": "solidity",
    ".scala": "scala",
    ".clj": "clojure",
    ".r": "r",
    ".R": "r",
}


def detect_ecosystems(paths: list[str]) -> dict[str, int]:
    """
    Map file paths / extensions / names to ecosystems.
    Returns {ecosystem: count}.
    """
    if not paths:
        return {}
    result: dict[str, int] = {}
    for path in paths:
        if not path:
            continue
        # Filename-based match
        basename = os.path.basename(path)
        if basename in FILENAME_TO_ECOSYSTEM:
            eco = FILENAME_TO_ECOSYSTEM[basename]
            result[eco] = result.get(eco, 0) + 1
            continue
        # Extension-based match
        _, ext = os.path.splitext(path)
        if ext and ext in EXTENSION_TO_ECOSYSTEM:
            eco = EXTENSION_TO_ECOSYSTEM[ext]
            result[eco] = result.get(eco, 0) + 1
    return result


def detect_languages(paths: list[str]) -> dict[str, int]:
    result: dict[str, int] = {}
    for path in paths:
        if not path:
            continue
        _, ext = os.path.splitext(path)
        if ext and ext in EXTENSION_TO_LANGUAGE:
            lang = EXTENSION_TO_LANGUAGE[ext]
            result[lang] = result.get(lang, 0) + 1
    return result


def is_test_path(path: str) -> bool:
    return any(pat in path for pat in TEST_FILE_PATTERNS)

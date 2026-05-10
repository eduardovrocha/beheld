from __future__ import annotations

from collections import Counter

EXTENSION_TO_LANGUAGE: dict[str, str] = {
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".rb": "ruby",
    ".java": "java",
    ".kt": "kotlin",
    ".go": "go",
    ".rs": "rust",
    ".swift": "swift",
    ".cs": "csharp",
    ".php": "php",
    ".ex": "elixir",
    ".exs": "elixir",
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
    ".sql": "sql",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".dart": "dart",
    ".lua": "lua",
    ".r": "r",
    ".scala": "scala",
    ".clj": "clojure",
    ".hs": "haskell",
    ".elm": "elm",
    ".vue": "javascript",
    ".svelte": "javascript",
}

EXTENSION_TO_ECOSYSTEM: dict[str, str] = {
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "react",
    ".js": "javascript",
    ".jsx": "react",
    ".mjs": "javascript",
    ".rb": "ruby",
    ".java": "java",
    ".kt": "kotlin",
    ".go": "go",
    ".rs": "rust",
    ".swift": "swift",
    ".cs": "csharp",
    ".php": "php",
    ".ex": "elixir",
    ".exs": "elixir",
    ".tf": "terraform",
    ".sol": "solidity",
    ".dart": "dart",
    ".vue": "vue",
    ".svelte": "svelte",
    ".html": "html_css",
    ".css": "html_css",
    ".scss": "html_css",
    ".sass": "html_css",
}

TEST_FILE_PATTERNS = (".spec.", ".test.", "_spec.", "_test.")


def extract_languages(extensions: Counter) -> list[str]:
    return sorted({EXTENSION_TO_LANGUAGE[ext] for ext in extensions if ext in EXTENSION_TO_LANGUAGE})


def extract_ecosystems(extensions: Counter) -> list[str]:
    return sorted({EXTENSION_TO_ECOSYSTEM[ext] for ext in extensions if ext in EXTENSION_TO_ECOSYSTEM})


def has_test_files(file_extensions: Counter) -> bool:
    return any(any(pat in ext for pat in TEST_FILE_PATTERNS) for ext in file_extensions)


def compute_test_file_ratio(file_extensions: Counter) -> float:
    total = sum(file_extensions.values())
    if total == 0:
        return 0.0
    test_count = sum(
        count
        for ext, count in file_extensions.items()
        if any(pat in ext for pat in TEST_FILE_PATTERNS)
    )
    return test_count / total

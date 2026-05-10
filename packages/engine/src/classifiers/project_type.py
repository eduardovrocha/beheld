from __future__ import annotations

from collections import Counter

PROJECT_CATEGORIES = [
    "saas_b2b",
    "api_backend",
    "financial_data",
    "mobile",
    "web3_blockchain",
    "automation_ai",
    "library_sdk",
    "cli_tool",
]

# Signals (command fragments, ecosystem names, tool names, file extensions)
# that indicate each project category.
CATEGORY_SIGNALS: dict[str, list[str]] = {
    "cli_tool": ["argparse", "click ", "commander", "cobra", "clap", "argv", "subcommand", ".sh"],
    "api_backend": [
        "fastapi",
        "flask",
        "django",
        "rails",
        "express",
        "nestjs",
        "gin ",
        "actix",
        "sinatra",
        "hapi",
        "fiber",
    ],
    "mobile": ["flutter", "react-native", "reactnative", ".swift", ".kt", "xcodebuild", "pod install", "gradle"],
    "web3_blockchain": ["solidity", "hardhat", "foundry", "ethers", "web3", "anchor ", "truffle", ".sol"],
    "automation_ai": [
        "openai",
        "anthropic",
        "langchain",
        "huggingface",
        "transformers",
        "torch",
        "tensorflow",
        "keras",
        "sklearn",
    ],
    "library_sdk": [
        "npm publish",
        "gem push",
        "pypi",
        "pip publish",
        "crates.io",
        "setup.py",
        "pyproject.toml",
        "cargo publish",
    ],
    "saas_b2b": ["stripe", "auth0", "oauth", "tenant", "subscription", "billing", "multitenancy"],
    "financial_data": [
        "pandas",
        "numpy",
        "matplotlib",
        "jupyter",
        ".csv",
        ".parquet",
        "dbt ",
        "airflow",
        "spark",
        "pyspark",
    ],
}


def classify_project_type(
    commands: list[str],
    ecosystems: list[str],
    tools_used: list[str],
    file_extensions: Counter,
) -> tuple[str, float]:
    """Rule-based project type classification. Returns (category, confidence)."""
    scores: dict[str, int] = {cat: 0 for cat in PROJECT_CATEGORIES}

    all_text = (
        " ".join(commands).lower()
        + " " + " ".join(ecosystems).lower()
        + " " + " ".join(tools_used).lower()
        + " " + " ".join(file_extensions.keys()).lower()
    )

    for category, signals in CATEGORY_SIGNALS.items():
        for signal in signals:
            if signal.lower() in all_text:
                scores[category] += 1

    if not any(scores.values()):
        return "unknown", 0.0

    best_category = max(scores, key=lambda k: scores[k])
    best_score = scores[best_category]

    # 3 matching signals → confidence 1.0
    confidence = min(best_score / 3.0, 1.0)

    if confidence < 0.30:
        return "unknown", confidence

    return best_category, confidence

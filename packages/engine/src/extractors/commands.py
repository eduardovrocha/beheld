from __future__ import annotations

PLATFORM_SIGNALS: dict[str, list[str]] = {
    "docker": ["docker ", "docker-compose", "podman"],
    "github": ["gh ", "git push", "git pull", "git commit", "git clone"],
    "cloud_infra": ["aws ", "gcloud ", "az ", "terraform ", "kubectl ", "helm "],
    "ci_cd": ["gh workflow", "act ", "circleci", "jenkins"],
    "database": ["psql", "mysql", "redis-cli", "prisma migrate", "rails db", "alembic", "mongosh"],
    "testing": ["rspec", "jest ", "pytest", "playwright", "vitest", "cypress", "mocha", "minitest"],
    "mobile": ["flutter", "pod install", "gradle", "xcodebuild", "adb ", "fastlane"],
    "blockchain": ["hardhat", "foundry", "truffle", "anchor ", "forge "],
}

ADVANCED_TOOL_PREFIXES = ("computer_use", "web_search", "mcp__", "bash_20", "text_editor")


def extract_platforms(commands: list[str]) -> list[str]:
    if not commands:
        return []
    cmd_text = " ".join(commands).lower()
    return sorted(
        platform
        for platform, signals in PLATFORM_SIGNALS.items()
        if any(sig.lower() in cmd_text for sig in signals)
    )


def has_advanced_tools(tools_used: list[str]) -> bool:
    return any(
        t.lower().startswith(prefix) for t in tools_used for prefix in ADVANCED_TOOL_PREFIXES
    )

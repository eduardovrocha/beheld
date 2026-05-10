from __future__ import annotations

PLATFORM_SIGNALS: dict[str, list[str]] = {
    "docker": ["docker ", "docker-compose", "podman"],
    "github": ["gh ", "git push", "git pull", "git commit", "git clone"],
    "cloud_infra": ["aws ", "gcloud ", "az ", "terraform ", "kubectl ", "helm "],
    "ci_cd": ["gh workflow", "act ", "circleci", "jenkins", ".github/workflows"],
    "database": ["psql", "mysql", "redis-cli", "prisma migrate", "rails db", "alembic", "mongosh"],
    "testing": ["rspec", "jest ", "pytest", "playwright", "vitest", "cypress", "mocha", "minitest"],
    "mobile": ["flutter", "pod install", "gradle", "xcodebuild", "adb ", "fastlane"],
    "blockchain": ["hardhat", "foundry", "truffle", "anchor ", "forge "],
}


def detect_platforms(commands: list[str]) -> dict[str, int]:
    """Return {platform: match_count} for each detected platform."""
    if not commands:
        return {}
    result: dict[str, int] = {}
    for cmd in commands:
        cmd_lower = cmd.lower()
        for platform, signals in PLATFORM_SIGNALS.items():
            matches = sum(1 for sig in signals if sig.lower() in cmd_lower)
            if matches:
                result[platform] = result.get(platform, 0) + matches
    return result

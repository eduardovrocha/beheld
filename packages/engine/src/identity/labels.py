"""Human-readable labels for the fallback templates.

Ecosystems and platforms come from closed enums in identity.schema; these
maps render the canonical IDs into the strings that appear in the public
HTML/OG/badge surfaces.
"""
from __future__ import annotations

# Maps from ecosystem ID to the high-level domain bucket used in
# identity_short (e.g. "Flutter" → "Mobile"). Ecosystems intentionally
# absent fall through to Case 4 (raw label) — add here when patterns
# stabilize in production.
DOMAIN_LABELS: dict[str, str] = {
    "flutter":        "Mobile",
    "swift_ios":      "Mobile",
    "kotlin":         "Mobile",
    "rails":          "Backend",
    "django":         "Backend",
    "fastapi":        "Backend",
    "node":           "Backend",
    "java_spring":    "Backend",
    "dotnet":         "Backend",
    "elixir_phoenix": "Backend",
    "php_laravel":    "Backend",
    "rust":           "Sistemas",
    "go":             "Sistemas",
    "react":          "Frontend",
    "vue":            "Frontend",
    "next":           "Frontend",
    "devops":         "DevOps",
}

ECOSYSTEM_LABELS: dict[str, str] = {
    "rails": "Rails",
    "node": "Node",
    "react": "React",
    "vue": "Vue",
    "next": "Next",
    "python": "Python",
    "django": "Django",
    "fastapi": "FastAPI",
    "flutter": "Flutter",
    "go": "Go",
    "rust": "Rust",
    "java_spring": "Spring",
    "kotlin": "Kotlin",
    "swift_ios": "Swift",
    "dotnet": "Dotnet",
    "elixir_phoenix": "Elixir",
    "php_laravel": "Laravel",
    "ruby_other": "Ruby",
    "devops": "DevOps",
}

PLATFORM_LABELS: dict[str, str] = {
    "docker": "Docker",
    "kubernetes": "Kubernetes",
    "github": "GitHub",
    "github_actions": "GitHub Actions",
    "gitlab": "GitLab",
    "gitlab_ci": "GitLab CI",
    "circleci": "CircleCI",
    "aws": "AWS",
    "gcp": "GCP",
    "azure": "Azure",
    "vercel": "Vercel",
    "cloudflare": "Cloudflare",
    "postgres": "Postgres",
    "mysql": "MySQL",
    "redis": "Redis",
    "mongodb": "MongoDB",
    "elasticsearch": "Elasticsearch",
    "terraform": "Terraform",
    "ansible": "Ansible",
    "blockchain": "Blockchain",
}

TEST_DISCIPLINE_LABELS: dict[str, str] = {
    "strong":   "forte disciplina",
    "moderate": "disciplina moderada",
    "low":      "hábito ainda em formação",
    "minimal":  "primeiros sinais",
}

TIMING_LABELS: dict[str, str] = {
    "morning":     "concentrado nas manhãs",
    "afternoon":   "concentrado nas tardes",
    "evening":     "concentrado nas noites",
    "late_night":  "concentrado de madrugada",
    "distributed": "distribuído ao longo do dia",
}


def join_platforms(platform_ids: list[str], limit: int = 2) -> str:
    """Join up to `limit` platform labels with 'e' between the last two.

    Examples:
        ["github"]                       → "GitHub"
        ["github", "github_actions"]     → "GitHub e GitHub Actions"
        ["docker", "github", "postgres"] → "Docker e GitHub"  (limit=2)
    """
    labels = [PLATFORM_LABELS.get(p, p.title()) for p in platform_ids[:limit]]
    if len(labels) == 0:
        return ""
    if len(labels) == 1:
        return labels[0]
    return f"{labels[0]} e {labels[1]}"

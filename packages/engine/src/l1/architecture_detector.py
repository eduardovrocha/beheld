"""Architecture pattern detection (F6.12a).

Infers architecture patterns from a repository's directory shape ONLY. The
detector NEVER opens, reads, or hashes any file — it consumes exclusively the
path listing produced by `git ls-tree -r HEAD --name-only`. This invariant is
enforced by `test_architecture_never_reads_file_content` (monkeypatches the
builtin `open`).

Manifests that hint at runtime libraries (bull, celery, sidekiq) are evaluated
through *the path of the manifest file itself*, never its content — and only
when the F6.2 ecosystem detector has already confirmed the relevant ecosystem.
The `ecosystems` arg lets the caller pass that pre-extracted signal so we don't
re-walk paths.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from typing import Iterable, Literal, Optional

Confidence = Literal["strong", "weak"]


@dataclass(frozen=True)
class ArchitecturePattern:
    pattern: str
    confidence: Confidence


# ── path listing source ──────────────────────────────────────────────────────


def list_tree(repo_path: str, env: Optional[dict] = None) -> list[str]:
    """Return every file path tracked at HEAD. Bare-clone safe.

    Uses `git ls-tree -r HEAD --name-only` so we get only paths — no blob
    fetching, no working-tree dependency. Returns [] on any git failure so a
    listing error never aborts the import."""
    try:
        result = subprocess.run(
            ["git", "-C", repo_path, "ls-tree", "-r", "HEAD", "--name-only"],
            check=True,
            capture_output=True,
            text=True,
            env=env,
            timeout=30,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return []
    return [line for line in result.stdout.splitlines() if line.strip()]


# ── individual detectors ─────────────────────────────────────────────────────
#
# Each detector returns the matched confidence or None. They all operate on
# the same in-memory `paths` list so the cost of detection is linear in the
# number of files — no repeated tree walks.


def _detect_mvc(paths: Iterable[str]) -> Optional[Confidence]:
    paths = list(paths)
    has_app_models = any("app/models/" in p for p in paths)
    has_app_controllers = any("app/controllers/" in p for p in paths)
    has_app_views = any("app/views/" in p for p in paths)
    if has_app_models and has_app_controllers and has_app_views:
        return "strong"
    has_models = any(p.startswith("models/") or "/models/" in p for p in paths)
    has_controllers = any(
        p.startswith("controllers/") or "/controllers/" in p for p in paths
    )
    if has_models and has_controllers:
        return "weak"
    return None


def _detect_monorepo(paths: Iterable[str]) -> Optional[Confidence]:
    paths = list(paths)
    strong_manifests = [
        p
        for p in paths
        if (p.startswith("packages/") or "/packages/" in p)
        and (p.endswith("/package.json") or p.endswith("/Cargo.toml"))
    ]
    # Restrict to direct `packages/<name>/<manifest>` to avoid counting
    # node_modules-style nested copies as separate packages.
    direct_packages = {
        p.split("/")[1]
        for p in strong_manifests
        if p.startswith("packages/") and len(p.split("/")) >= 3
    }
    if len(direct_packages) >= 3:
        return "strong"

    weak_dirs = {
        p.split("/")[1]
        for p in paths
        if p.startswith("packages/") and len(p.split("/")) >= 3
    }
    if len(weak_dirs) >= 2:
        return "weak"
    return None


def _detect_microservices(paths: Iterable[str]) -> Optional[Confidence]:
    # Dockerfiles inside subdirectories (depth ≥ 2 means at least one parent).
    dockerfile_dirs = {
        "/".join(p.split("/")[:-1])
        for p in paths
        if p.endswith("/Dockerfile") and len(p.split("/")) >= 2
    }
    if len(dockerfile_dirs) >= 3:
        return "strong"
    if len(dockerfile_dirs) >= 2:
        return "weak"
    return None


def _detect_graphql(paths: Iterable[str]) -> Optional[Confidence]:
    paths = list(paths)
    if any(p.endswith("schema.graphql") or "/graphql/schema" in p for p in paths):
        return "strong"
    graphql_files = [p for p in paths if p.endswith(".graphql")]
    resolver_dirs = [p for p in paths if "/resolvers/" in p or p.startswith("resolvers/")]
    if len(graphql_files) >= 2 or len(resolver_dirs) >= 2:
        return "weak"
    return None


def _detect_rest_api(paths: Iterable[str]) -> Optional[Confidence]:
    paths = list(paths)
    has_views = any(p.startswith("views/") or "/views/" in p for p in paths)
    has_routes = any(p.startswith("routes/") or "/routes/" in p for p in paths)
    has_controllers = any(
        p.startswith("controllers/") or "/controllers/" in p for p in paths
    )
    if (has_routes or has_controllers) and not has_views:
        return "strong"
    if has_routes:
        return "weak"
    return None


def _detect_serverless(paths: Iterable[str]) -> Optional[Confidence]:
    paths = list(paths)
    if any(p == "serverless.yml" or p == "serverless.yaml" for p in paths):
        return "strong"
    if any(p.startswith("functions/") or "/functions/" in p for p in paths):
        return "weak"
    if any(p.endswith(".lambda.ts") or p.endswith(".lambda.js") for p in paths):
        return "weak"
    return None


def _detect_event_driven(
    paths: Iterable[str], ecosystems: dict
) -> Optional[Confidence]:
    paths = list(paths)
    # Strong: explicit job/queue infrastructure files.
    if any(p == "sidekiq.yml" or p.endswith("/sidekiq.yml") for p in paths):
        return "strong"
    if any(p == "Procfile" or p.endswith("/Procfile") for p in paths):
        # Procfile alone is weak; the spec requires worker+queue evidence too,
        # which we approximate via a `queues/` or `workers/` directory.
        if any(
            "queues/" in p or "/workers/" in p or p.startswith("workers/")
            for p in paths
        ):
            return "strong"
    # If the ecosystem detector (F6.2) flagged node and a package.json sits at
    # the root, we still don't read it — but the presence of a `workers/` dir
    # combined with the node ecosystem is a strong-enough signal for the bull
    # heuristic the spec describes without ever opening a manifest.
    has_node = bool(ecosystems.get("node"))
    has_python = bool(ecosystems.get("python"))
    has_worker_dir = any(
        p.startswith("workers/") or "/workers/" in p or p.startswith("jobs/")
        or "/jobs/" in p or p.startswith("queues/") or "/queues/" in p
        for p in paths
    )
    if has_worker_dir and (has_node or has_python):
        return "weak"
    if has_worker_dir:
        return "weak"
    return None


def _detect_iac(paths: Iterable[str]) -> Optional[Confidence]:
    paths = list(paths)
    tf_files = [p for p in paths if p.endswith(".tf")]
    has_terraform_dir = any(
        p.startswith("terraform/") or "/terraform/" in p for p in paths
    )
    if len(tf_files) >= 3 or has_terraform_dir:
        return "strong"
    if 1 <= len(tf_files) <= 2:
        return "weak"
    if any(p.startswith("pulumi/") or "/pulumi/" in p for p in paths):
        return "weak"
    return None


def _detect_container_orchestration(
    paths: Iterable[str],
) -> Optional[Confidence]:
    paths = list(paths)
    if any(
        p.startswith("k8s/")
        or "/k8s/" in p
        or p.startswith("kubernetes/")
        or "/kubernetes/" in p
        or p == "helm/Chart.yaml"
        or p.endswith("/helm/Chart.yaml")
        for p in paths
    ):
        return "strong"
    has_manifests_yaml = any(
        (p.startswith("manifests/") or "/manifests/" in p)
        and (p.endswith(".yaml") or p.endswith(".yml"))
        for p in paths
    )
    has_charts = any(p.startswith("charts/") or "/charts/" in p for p in paths)
    if has_manifests_yaml or has_charts:
        return "weak"
    return None


def _detect_ci_cd(paths: Iterable[str]) -> Optional[Confidence]:
    paths = list(paths)
    if any(".github/workflows/" in p for p in paths):
        return "strong"
    if any(p == ".gitlab-ci.yml" or p.endswith("/.gitlab-ci.yml") for p in paths):
        return "strong"
    if any(
        p == ".circleci/config.yml" or p.endswith("/.circleci/config.yml") for p in paths
    ):
        return "strong"
    if any(p == "Jenkinsfile" or p.endswith("/Jenkinsfile") for p in paths):
        return "weak"
    if any(p == ".drone.yml" or p.endswith("/.drone.yml") for p in paths):
        return "weak"
    return None


# ── public entry point ──────────────────────────────────────────────────────


_DETECTORS = (
    ("mvc", _detect_mvc),
    ("monorepo", _detect_monorepo),
    ("microservices", _detect_microservices),
    ("graphql", _detect_graphql),
    ("rest_api", _detect_rest_api),
    ("serverless", _detect_serverless),
    ("iac", _detect_iac),
    ("container_orchestration", _detect_container_orchestration),
    ("ci_cd", _detect_ci_cd),
)


def detect_patterns(
    repo_path: str,
    ecosystems: Optional[dict] = None,
    env: Optional[dict] = None,
) -> list[ArchitecturePattern]:
    """Return the list of architecture patterns detected in the repo at
    `repo_path`. Detection is structural-only (paths) — no file content is
    ever read. `ecosystems` is the dict produced by the F6.2 extractor and is
    used by the event-driven heuristic; missing keys are treated as False."""
    eco = ecosystems or {}
    paths = list_tree(repo_path, env=env)
    if not paths:
        return []

    results: list[ArchitecturePattern] = []
    for name, fn in _DETECTORS:
        conf = fn(paths)
        if conf is not None:
            results.append(ArchitecturePattern(pattern=name, confidence=conf))

    # event_driven needs the ecosystems dict; handled separately for clarity.
    ev = _detect_event_driven(paths, eco)
    if ev is not None:
        results.append(ArchitecturePattern(pattern="event_driven", confidence=ev))

    return results

"""L1 git repository signal extractor.

Phase 6 / F6.2. Clones a repo with `--bare --filter=blob:none`, derives
signals from commit metadata + file paths only, then removes the clone.
Never persists file content, commit messages, branch names, or paths."""

from __future__ import annotations

import hashlib
import re
import shutil
import subprocess
import tempfile
from collections import Counter
from dataclasses import dataclass, field
from typing import Optional

from extractors.timing import analyze_timing
from l1 import architecture_detector
from l1.architecture_detector import ArchitecturePattern
from l1.language_map import get_language


class AuthorNotFoundError(Exception):
    """Repo cloned but the given email authored zero commits."""


class CloneError(Exception):
    """git clone failed (auth, network, invalid URL, timeout, etc.)."""


class ExtractionError(Exception):
    """Clone succeeded but extracting signals failed."""


@dataclass
class LanguageWeight:
    """F6.12a — per-language weight derived from the author's commits."""

    language: str
    commit_count: int
    file_count: int
    first_seen: str  # ISO date of the oldest commit touching this language
    last_seen: str   # ISO date of the newest commit touching this language


@dataclass
class L1ExtractedSignals:
    root_commit_hash: str
    commit_count: int
    author_email_hash: str
    file_extensions: dict
    ecosystems: dict
    platforms: dict
    test_ratio: float
    timing: dict
    first_commit_at: str
    last_commit_at: str
    # F6.12a — populated by extract_language_weights + architecture_detector.
    # Empty list on failure so the importer can still persist the rest.
    language_weights: list[LanguageWeight] = field(default_factory=list)
    architecture_patterns: list[ArchitecturePattern] = field(default_factory=list)


_ECOSYSTEM_MANIFESTS: dict[str, str] = {
    "Gemfile": "rails",
    "package.json": "node",
    "pyproject.toml": "python",
    "setup.py": "python",
    "pubspec.yaml": "flutter",
    "go.mod": "go",
    "pom.xml": "java",
    "build.gradle": "java",
}

_CLONE_TIMEOUT_SECONDS = 120
_GIT_CMD_TIMEOUT_SECONDS = 60


# ── helpers ──────────────────────────────────────────────────────────────────


def _hash_email(email: str) -> str:
    return hashlib.sha256(email.encode("utf-8")).hexdigest()[:16]


def _run_git(args: list[str], env: Optional[dict], timeout: int = _GIT_CMD_TIMEOUT_SECONDS) -> str:
    try:
        result = subprocess.run(
            args,
            check=True,
            capture_output=True,
            text=True,
            env=env,
            timeout=timeout,
        )
    except subprocess.CalledProcessError as exc:
        raise ExtractionError(
            f"git command failed (rc={exc.returncode}): {' '.join(args[:4])}"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise ExtractionError(f"git command timed out: {' '.join(args[:4])}") from exc
    return result.stdout


def _ext_of(filename: str) -> Optional[str]:
    """Return lowercase extension or None. Dotfiles like `.gitignore` have no ext."""
    base = filename.rsplit("/", 1)[-1]
    if not base or base.startswith("."):
        return None
    if "." not in base:
        return None
    return base.rsplit(".", 1)[-1].lower()


def _is_test_path(path: str) -> bool:
    p = path.lower()
    parts = p.split("/")
    if any(seg in {"test", "tests", "spec", "specs", "__tests__"} for seg in parts):
        return True
    base = parts[-1]
    if "_test." in base or "_spec." in base or ".test." in base or ".spec." in base:
        return True
    # Trailing suffix forms (e.g. `foo_test.go`)
    for suffix in ("_test.go", "_test.py", "_spec.rb"):
        if base.endswith(suffix):
            return True
    return False


def _detect_ecosystems(unique_paths: set[str]) -> dict:
    eco: dict[str, bool] = {}
    for path in unique_paths:
        base = path.rsplit("/", 1)[-1]
        if base in _ECOSYSTEM_MANIFESTS:
            eco[_ECOSYSTEM_MANIFESTS[base]] = True
    return eco


def extract_language_weights(
    repo_path: str,
    author_email: str,
    env: Optional[dict] = None,
) -> list[LanguageWeight]:
    """Compute per-language weights from the author's commit history.

    Uses a single `git log --name-only` pass with a sentinel format string so
    we can attribute each file path to its commit hash and author date. Per
    F6.2 invariant: file paths are walked for extension + counting only,
    never persisted.

    Returns [] on any git failure — caller treats absence of language data
    as a soft failure and continues the ingest.
    """
    sentinel = "__BEHELD_COMMIT__"
    author_filter = "--author=" + re.escape(author_email)
    try:
        raw = _run_git(
            [
                "git", "-C", repo_path, "log", author_filter,
                f"--format=format:{sentinel} %H %aI",
                "--name-only",
            ],
            env=env,
        )
    except ExtractionError:
        return []

    # Per-language aggregation buckets.
    commits_by_lang: dict[str, set[str]] = {}
    files_by_lang: dict[str, set[str]] = {}
    dates_by_lang: dict[str, list[str]] = {}

    current_hash: Optional[str] = None
    current_date: Optional[str] = None

    for line in raw.splitlines():
        if line.startswith(sentinel + " "):
            parts = line.split(" ", 2)
            if len(parts) >= 3:
                current_hash = parts[1]
                current_date = parts[2][:10]  # YYYY-MM-DD only
            continue
        path = line.strip()
        if not path or current_hash is None or current_date is None:
            continue
        ext = _ext_of(path)
        if not ext:
            continue
        # _ext_of returns the bare extension without a leading dot; the
        # language map normalizes input shape.
        language = get_language("." + ext)
        if language is None:
            continue
        commits_by_lang.setdefault(language, set()).add(current_hash)
        files_by_lang.setdefault(language, set()).add(path)
        dates_by_lang.setdefault(language, []).append(current_date)

    weights: list[LanguageWeight] = []
    for lang, hashes in commits_by_lang.items():
        if not hashes:
            continue
        dates = sorted(dates_by_lang[lang])
        weights.append(
            LanguageWeight(
                language=lang,
                commit_count=len(hashes),
                file_count=len(files_by_lang[lang]),
                first_seen=dates[0],
                last_seen=dates[-1],
            )
        )
    # Heaviest first — keeps writes deterministic and human-readable in tests.
    weights.sort(key=lambda w: (-w.commit_count, w.language))
    return weights


def _detect_platforms(unique_paths: set[str]) -> dict:
    plat: dict[str, bool] = {}
    for path in unique_paths:
        parts = path.split("/")
        base = parts[-1]
        if base == "Dockerfile":
            plat["docker"] = True
        if base == ".gitlab-ci.yml":
            plat["gitlab"] = True
        if base.endswith(".tf"):
            plat["cloud_infra"] = True
        if ".github" in parts and "workflows" in parts:
            plat["github"] = True
        if ".circleci" in parts:
            plat["ci_cd"] = True
        if "k8s" in parts or "kubernetes" in parts:
            plat["kubernetes"] = True
        if "terraform" in parts:
            plat["cloud_infra"] = True
    return plat


# ── main entry point ─────────────────────────────────────────────────────────


def extract(
    repo_url: str,
    author_email: str,
    git_env: Optional[dict] = None,
) -> L1ExtractedSignals:
    """Clone `repo_url` opaquely, derive L1 signals for `author_email`, then
    delete the clone before returning. The clone is always removed — even on
    error — via the finally block."""
    tmpdir = tempfile.mkdtemp(prefix="dp-l1-")
    author_filter = "--author=" + re.escape(author_email)
    try:
        # 1. Clone — no working tree, no blob content.
        try:
            subprocess.run(
                ["git", "clone", "--bare", "--filter=blob:none", repo_url, tmpdir],
                check=True,
                capture_output=True,
                text=True,
                env=git_env,
                timeout=_CLONE_TIMEOUT_SECONDS,
            )
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or "").strip()[:200]
            raise CloneError(f"git clone failed (rc={exc.returncode}): {stderr}") from exc
        except subprocess.TimeoutExpired as exc:
            raise CloneError("git clone timed out") from exc

        # 2. Author commits — bail early if dev has no authorship.
        commit_hashes_raw = _run_git(
            ["git", "-C", tmpdir, "log", author_filter, "--format=%H"],
            env=git_env,
        )
        commit_hashes = [h for h in commit_hashes_raw.splitlines() if h.strip()]
        if not commit_hashes:
            raise AuthorNotFoundError("no commits authored by the given email")
        commit_count = len(commit_hashes)

        # 3. Root commit hash — opaque, repo-stable identifier.
        root_raw = _run_git(
            ["git", "-C", tmpdir, "rev-list", "--max-parents=0", "HEAD"],
            env=git_env,
        )
        roots = [r.strip() for r in root_raw.splitlines() if r.strip()]
        if not roots:
            raise ExtractionError("could not resolve root commit")
        root_commit_hash = roots[0]

        # 4. Author timestamps (ISO-8601 with offset).
        timestamps_raw = _run_git(
            ["git", "-C", tmpdir, "log", author_filter, "--format=%aI"],
            env=git_env,
        )
        author_timestamps = [t.strip() for t in timestamps_raw.splitlines() if t.strip()]

        # 5. File names only (NO content). `--format=` prints empty lines
        #    between commits which we skip.
        name_only_raw = _run_git(
            ["git", "-C", tmpdir, "log", author_filter, "--name-only", "--format="],
            env=git_env,
        )
        file_occurrences = [line.strip() for line in name_only_raw.splitlines() if line.strip()]
        unique_files = set(file_occurrences)

        # 6. Extension counts — occurrence-weighted (signal of effort per language).
        ext_counter: Counter[str] = Counter()
        for path in file_occurrences:
            ext = _ext_of(path)
            if ext:
                ext_counter[ext] += 1
        file_extensions = dict(ext_counter)

        # 7. Ecosystems & platforms — presence-only, derived from unique paths.
        ecosystems = _detect_ecosystems(unique_files)
        platforms = _detect_platforms(unique_files)

        # 8. Test ratio — share of unique files that look like tests.
        if unique_files:
            test_file_count = sum(1 for f in unique_files if _is_test_path(f))
            test_ratio = test_file_count / len(unique_files)
        else:
            test_ratio = 0.0

        # 9. Timing — reuse the existing analyzer, expose only the L1 fields.
        timing_full = analyze_timing(author_timestamps)
        timing = {
            "peak_hours": timing_full.get("peak_hours", []),
            "avg_duration_min": timing_full.get("avg_duration_minutes", 0.0),
        }

        # %aI output is newest-first; oldest is at the tail.
        first_commit_at = author_timestamps[-1] if author_timestamps else ""
        last_commit_at = author_timestamps[0] if author_timestamps else ""

        # 10. F6.12a — language weights + architecture patterns.
        #     Both are fail-soft: returning [] on extractor exception keeps
        #     the rest of the ingest intact (existing F6.2 behavior).
        try:
            language_weights = extract_language_weights(tmpdir, author_email, git_env)
        except Exception:
            language_weights = []
        try:
            architecture_patterns = architecture_detector.detect_patterns(
                tmpdir, ecosystems=ecosystems, env=git_env
            )
        except Exception:
            architecture_patterns = []

        return L1ExtractedSignals(
            root_commit_hash=root_commit_hash,
            commit_count=commit_count,
            author_email_hash=_hash_email(author_email),
            file_extensions=file_extensions,
            ecosystems=ecosystems,
            platforms=platforms,
            test_ratio=test_ratio,
            timing=timing,
            first_commit_at=first_commit_at,
            last_commit_at=last_commit_at,
            language_weights=language_weights,
            architecture_patterns=architecture_patterns,
        )
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

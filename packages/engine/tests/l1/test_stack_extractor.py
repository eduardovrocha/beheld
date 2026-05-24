"""F6.12a — language weights, architecture detection, /l1/stack endpoint.

Test infra mirrors test_git_extractor.py (init_repo / commit / bare helpers
duplicated locally, intentionally — keeps each test file self-contained and
matches the project's existing style)."""

from __future__ import annotations

import builtins
import os
import subprocess
from pathlib import Path
from typing import Optional
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from api import app
from l1 import architecture_detector, git_extractor
from l1.architecture_detector import ArchitecturePattern, detect_patterns
from l1.git_extractor import (
    L1ExtractedSignals,
    LanguageWeight,
    extract,
    extract_language_weights,
)
from l1.importer import L1Importer
from storage.sqlite import BeheldDB


DEV_EMAIL = "dev@l1-test.local"
OTHER_EMAIL = "alice@other.local"


# ── helpers (mirror test_git_extractor.py) ───────────────────────────────────


def _git_env(name: str, email: str, when: Optional[str] = None) -> dict:
    env = os.environ.copy()
    env["GIT_AUTHOR_NAME"] = name
    env["GIT_AUTHOR_EMAIL"] = email
    env["GIT_COMMITTER_NAME"] = name
    env["GIT_COMMITTER_EMAIL"] = email
    if when:
        env["GIT_AUTHOR_DATE"] = when
        env["GIT_COMMITTER_DATE"] = when
    return env


def _run(args: list[str], env: dict | None = None) -> None:
    subprocess.run(args, check=True, capture_output=True, env=env or os.environ.copy())


def _init_repo(repo: Path) -> None:
    repo.mkdir(parents=True, exist_ok=True)
    _run(["git", "init", "-b", "main", str(repo)])
    _run(["git", "-C", str(repo), "config", "commit.gpgsign", "false"])


def _commit(
    repo: Path,
    files: dict[str, str],
    author_name: str = "Dev",
    author_email: str = DEV_EMAIL,
    msg: str = "change",
    when: Optional[str] = None,
) -> None:
    for rel, content in files.items():
        fp = repo / rel
        fp.parent.mkdir(parents=True, exist_ok=True)
        fp.write_text(content)
    env = _git_env(author_name, author_email, when=when)
    _run(["git", "-C", str(repo), "add", "-A"], env=env)
    _run(["git", "-C", str(repo), "commit", "-m", msg], env=env)


def _bare(source: Path, dest: Path) -> str:
    _run(["git", "clone", "--bare", str(source), str(dest)])
    _run(["git", "-C", str(dest), "config", "uploadpack.allowFilter", "true"])
    _run(["git", "-C", str(dest), "config", "uploadpack.allowAnySHA1InWant", "true"])
    return str(dest)


# ────────────────────────────────────────────────────────────────────────────
#  Language weights
# ────────────────────────────────────────────────────────────────────────────


def test_language_weights_counts_unique_commits_not_files(tmp_path: Path) -> None:
    """One commit touching 30 .rb files → commit_count=1, file_count=30."""
    source = tmp_path / "src"
    _init_repo(source)
    files = {f"app/file_{i:02d}.rb": f"# {i}\n" for i in range(30)}
    _commit(source, files, msg="seed ruby")
    bare = _bare(source, tmp_path / "bare.git")

    weights = extract_language_weights(bare, DEV_EMAIL)
    by_lang = {w.language: w for w in weights}

    assert "Ruby" in by_lang
    assert by_lang["Ruby"].commit_count == 1
    assert by_lang["Ruby"].file_count == 30


def test_language_weights_ignores_markdown_and_config_files(tmp_path: Path) -> None:
    source = tmp_path / "src"
    _init_repo(source)
    _commit(
        source,
        {
            "README.md": "# docs",
            "config.yml": "key: value",
            "package.json": '{"name":"x"}',
            ".gitignore": "node_modules",
            "logo.svg": "<svg/>",
        },
        msg="docs and config only",
    )
    bare = _bare(source, tmp_path / "bare.git")

    weights = extract_language_weights(bare, DEV_EMAIL)
    assert weights == []


def test_language_weights_distinguishes_ts_from_js(tmp_path: Path) -> None:
    source = tmp_path / "src"
    _init_repo(source)
    _commit(source, {"src/a.ts": "const a = 1"}, msg="ts")
    _commit(source, {"src/b.tsx": "const b = 2"}, msg="tsx")
    _commit(source, {"src/c.js": "var c = 3"}, msg="js")
    bare = _bare(source, tmp_path / "bare.git")

    weights = extract_language_weights(bare, DEV_EMAIL)
    by_lang = {w.language: w for w in weights}

    assert "TypeScript" in by_lang
    assert "JavaScript" in by_lang
    # .ts + .tsx both map to TypeScript → 2 commits
    assert by_lang["TypeScript"].commit_count == 2
    assert by_lang["JavaScript"].commit_count == 1


def test_language_weights_first_and_last_seen_correct(tmp_path: Path) -> None:
    source = tmp_path / "src"
    _init_repo(source)
    _commit(source, {"a.py": "x = 1"}, msg="oldest", when="2022-03-15T10:00:00 +0000")
    _commit(source, {"b.py": "y = 2"}, msg="middle", when="2024-08-20T10:00:00 +0000")
    _commit(source, {"c.py": "z = 3"}, msg="newest", when="2026-01-05T10:00:00 +0000")
    bare = _bare(source, tmp_path / "bare.git")

    weights = extract_language_weights(bare, DEV_EMAIL)
    py = next(w for w in weights if w.language == "Python")

    assert py.first_seen == "2022-03-15"
    assert py.last_seen == "2026-01-05"
    assert py.commit_count == 3


def test_language_weights_author_filter_correct(tmp_path: Path) -> None:
    """Two-author repo: only the requested author's commits count."""
    source = tmp_path / "src"
    _init_repo(source)
    _commit(source, {"dev_a.py": "1"}, msg="dev1")
    _commit(source, {"dev_b.py": "2"}, msg="dev2")
    _commit(
        source,
        {"alice_a.py": "1"},
        author_name="Alice",
        author_email=OTHER_EMAIL,
        msg="alice1",
    )
    _commit(
        source,
        {"alice_b.py": "2"},
        author_name="Alice",
        author_email=OTHER_EMAIL,
        msg="alice2",
    )
    bare = _bare(source, tmp_path / "bare.git")

    dev_weights = extract_language_weights(bare, DEV_EMAIL)
    alice_weights = extract_language_weights(bare, OTHER_EMAIL)

    assert next(w for w in dev_weights if w.language == "Python").commit_count == 2
    assert next(w for w in alice_weights if w.language == "Python").commit_count == 2


# ────────────────────────────────────────────────────────────────────────────
#  Architecture detection
# ────────────────────────────────────────────────────────────────────────────


def _seed_paths(tmp_path: Path, files: list[str]) -> str:
    """Build a bare repo whose HEAD tracks each path in `files`."""
    source = tmp_path / "src"
    _init_repo(source)
    _commit(source, {p: "x" for p in files}, msg="seed")
    return _bare(source, tmp_path / "bare.git")


def test_architecture_mvc_strong_detected(tmp_path: Path) -> None:
    bare = _seed_paths(
        tmp_path,
        [
            "app/models/user.rb",
            "app/controllers/users_controller.rb",
            "app/views/users/index.html.erb",
        ],
    )
    patterns = detect_patterns(bare)
    by_name = {p.pattern: p.confidence for p in patterns}
    assert by_name["mvc"] == "strong"


def test_architecture_mvc_weak_detected(tmp_path: Path) -> None:
    bare = _seed_paths(
        tmp_path,
        [
            "models/user.py",
            "controllers/users.py",
        ],
    )
    patterns = detect_patterns(bare)
    by_name = {p.pattern: p.confidence for p in patterns}
    assert by_name["mvc"] == "weak"


def test_architecture_monorepo_strong_requires_3_packages(tmp_path: Path) -> None:
    bare = _seed_paths(
        tmp_path,
        [
            "packages/api/package.json",
            "packages/web/package.json",
            "packages/cli/package.json",
        ],
    )
    by = {p.pattern: p.confidence for p in detect_patterns(bare)}
    assert by["monorepo"] == "strong"

    # With only 2 packages → weak.
    bare_weak = _seed_paths(
        tmp_path / "weak",
        [
            "packages/api/package.json",
            "packages/web/package.json",
        ],
    )
    by_weak = {p.pattern: p.confidence for p in detect_patterns(bare_weak)}
    assert by_weak["monorepo"] == "weak"


def test_architecture_microservices_counts_dockerfiles_in_subdirs(
    tmp_path: Path,
) -> None:
    bare = _seed_paths(
        tmp_path,
        [
            "services/api/Dockerfile",
            "services/web/Dockerfile",
            "services/worker/Dockerfile",
        ],
    )
    by = {p.pattern: p.confidence for p in detect_patterns(bare)}
    assert by["microservices"] == "strong"

    # Single Dockerfile at root → NOT microservices.
    bare_one = _seed_paths(tmp_path / "one", ["Dockerfile"])
    by_one = {p.pattern: p.confidence for p in detect_patterns(bare_one)}
    assert "microservices" not in by_one


def test_architecture_graphql_detected_by_schema_file(tmp_path: Path) -> None:
    bare = _seed_paths(
        tmp_path, ["schema.graphql", "src/server.ts"]
    )
    by = {p.pattern: p.confidence for p in detect_patterns(bare)}
    assert by["graphql"] == "strong"


def test_architecture_serverless_detected(tmp_path: Path) -> None:
    bare = _seed_paths(tmp_path, ["serverless.yml", "src/handler.ts"])
    by = {p.pattern: p.confidence for p in detect_patterns(bare)}
    assert by["serverless"] == "strong"

    bare_weak = _seed_paths(
        tmp_path / "weak",
        ["functions/sign-in/handler.js"],
    )
    by_weak = {p.pattern: p.confidence for p in detect_patterns(bare_weak)}
    assert by_weak["serverless"] == "weak"


def test_architecture_no_patterns_returns_empty_list(tmp_path: Path) -> None:
    """A repo with only loose source files matches no detector."""
    bare = _seed_paths(tmp_path, ["src/main.py", "src/helpers.py", "README.md"])
    patterns = detect_patterns(bare)
    assert patterns == []


def test_architecture_never_reads_file_content(tmp_path: Path) -> None:
    """detect_patterns must never call open() on any path inside the repo.

    We monkeypatch the builtin open to record every call and assert no path
    that resolves under the bare-repo tree is opened. This enforces the
    F6.2-inherited invariant: structure-only detection."""
    bare = _seed_paths(
        tmp_path,
        [
            "app/models/user.rb",
            "app/controllers/users_controller.rb",
            "app/views/users/index.html.erb",
            "Dockerfile",
            "serverless.yml",
        ],
    )
    opened: list[str] = []
    real_open = builtins.open

    def tracking_open(file, *args, **kwargs):
        opened.append(str(file))
        return real_open(file, *args, **kwargs)

    with patch("builtins.open", side_effect=tracking_open):
        detect_patterns(bare)

    repo_inside = [p for p in opened if str(bare) in p]
    assert repo_inside == [], (
        f"detect_patterns opened files inside the repo: {repo_inside[:5]}"
    )


# ────────────────────────────────────────────────────────────────────────────
#  Importer resilience
# ────────────────────────────────────────────────────────────────────────────


def test_importer_continues_if_language_extraction_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If extract_language_weights raises, the rest of the ingest must succeed."""
    source = tmp_path / "src"
    _init_repo(source)
    _commit(source, {"app.py": "x = 1", "pyproject.toml": "[project]\nname='x'"})
    bare = _bare(source, tmp_path / "bare.git")

    db = BeheldDB(":memory:")
    db.init_schema()
    importer = L1Importer(db)

    def boom(*_args, **_kw):
        raise RuntimeError("simulated extractor failure")

    monkeypatch.setattr(git_extractor, "extract_language_weights", boom)

    result = importer.import_repository(bare, DEV_EMAIL)

    # F6.2 signals saved despite the F6.12a extractor failing.
    assert result["status"] == "imported"
    assert result["commit_count"] >= 1

    # The architecture patterns either landed or were skipped — both acceptable
    # under fail-soft. What matters: ingest completed and L1 summary works.
    summary = db.get_l1_summary()
    assert summary["total_repos"] == 1


# ────────────────────────────────────────────────────────────────────────────
#  /l1/stack endpoint
# ────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def test_db(tmp_path: Path) -> BeheldDB:
    db = BeheldDB(tmp_path / "profile.db")
    db.init_schema()
    yield db
    db.close()


@pytest.fixture
def client(test_db: BeheldDB):
    importer = L1Importer(test_db)
    with patch("api.db", test_db), \
         patch("api.l1_importer", importer), \
         patch("api.insights_gen"), \
         patch("apscheduler.schedulers.asyncio.AsyncIOScheduler.start"), \
         patch("apscheduler.schedulers.asyncio.AsyncIOScheduler.shutdown"):
        with TestClient(app) as c:
            yield c


def test_stack_endpoint_empty_when_no_repos_imported(client: TestClient) -> None:
    resp = client.get("/l1/stack")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "language_distribution": [],
        "architecture_patterns": [],
        "total_commits_analyzed": 0,
        "repos_analyzed": 0,
    }


def test_stack_endpoint_returns_correct_weight_pct(
    client: TestClient, test_db: BeheldDB
) -> None:
    """Seed two repos with known language weights; assert weight_pct is the
    repo-summed commit share, rounded to 1 decimal."""
    test_db.save_l1_repository("hashA", "2026-01-01T00:00:00+00:00", 10, "eh")
    test_db.save_l1_repository("hashB", "2026-01-02T00:00:00+00:00", 5, "eh")
    test_db.save_l1_language_weights(
        "hashA",
        [
            LanguageWeight("Ruby", commit_count=7, file_count=50,
                           first_seen="2024-01-15", last_seen="2026-05-10"),
            LanguageWeight("Python", commit_count=3, file_count=12,
                           first_seen="2025-02-01", last_seen="2025-12-20"),
        ],
    )
    test_db.save_l1_language_weights(
        "hashB",
        [
            LanguageWeight("Python", commit_count=5, file_count=20,
                           first_seen="2026-01-01", last_seen="2026-01-30"),
        ],
    )

    resp = client.get("/l1/stack")
    assert resp.status_code == 200
    body = resp.json()

    assert body["repos_analyzed"] == 2
    assert body["total_commits_analyzed"] == 15

    by_lang = {entry["language"]: entry for entry in body["language_distribution"]}
    # Ruby: 7 / 15 = 46.7%
    assert by_lang["Ruby"]["weight_pct"] == pytest.approx(46.7, abs=0.05)
    # Python: 8 / 15 = 53.3%
    assert by_lang["Python"]["weight_pct"] == pytest.approx(53.3, abs=0.05)

    # Ordered by commit_count desc → Python first (8 > 7).
    assert body["language_distribution"][0]["language"] == "Python"
    assert body["language_distribution"][1]["language"] == "Ruby"

    # YYYY-MM truncation of first_seen/last_seen.
    assert by_lang["Ruby"]["first_seen"] == "2024-01"
    assert by_lang["Ruby"]["last_seen"] == "2026-05"


def test_stack_endpoint_architecture_aggregates_across_repos(
    client: TestClient, test_db: BeheldDB
) -> None:
    """Architecture patterns roll up by pattern, picking the strongest
    confidence seen across any repo."""
    test_db.save_l1_repository("hash1", "2026-01-01T00:00:00+00:00", 1, "eh")
    test_db.save_l1_repository("hash2", "2026-01-02T00:00:00+00:00", 1, "eh")
    test_db.save_l1_architecture_patterns(
        "hash1",
        [
            ArchitecturePattern("mvc", "weak"),
            ArchitecturePattern("ci_cd", "strong"),
        ],
    )
    test_db.save_l1_architecture_patterns(
        "hash2",
        [
            ArchitecturePattern("mvc", "strong"),  # promotes the prior weak.
            ArchitecturePattern("ci_cd", "strong"),
        ],
    )

    body = client.get("/l1/stack").json()
    by_pattern = {p["pattern"]: p for p in body["architecture_patterns"]}

    assert by_pattern["mvc"]["repo_count"] == 2
    assert by_pattern["mvc"]["confidence"] == "strong"
    assert by_pattern["ci_cd"]["repo_count"] == 2
    assert by_pattern["ci_cd"]["confidence"] == "strong"

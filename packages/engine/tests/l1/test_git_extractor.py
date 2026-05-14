from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from dataclasses import asdict
from pathlib import Path

import pytest

from l1 import git_extractor
from l1.git_extractor import (
    AuthorNotFoundError,
    CloneError,
    L1ExtractedSignals,
    extract,
)


# ── helpers ──────────────────────────────────────────────────────────────────


DEV_EMAIL = "dev@l1-test.local"
OTHER_EMAIL = "alice@other.local"


def _git_env(name: str, email: str) -> dict:
    env = os.environ.copy()
    env["GIT_AUTHOR_NAME"] = name
    env["GIT_AUTHOR_EMAIL"] = email
    env["GIT_COMMITTER_NAME"] = name
    env["GIT_COMMITTER_EMAIL"] = email
    # Make commit dates deterministic enough — git uses current time otherwise.
    return env


def _run(args: list[str], env: dict | None = None, cwd: Path | None = None) -> None:
    subprocess.run(
        args,
        check=True,
        capture_output=True,
        env=env or os.environ.copy(),
        cwd=str(cwd) if cwd else None,
    )


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
) -> None:
    for rel, content in files.items():
        fp = repo / rel
        fp.parent.mkdir(parents=True, exist_ok=True)
        fp.write_text(content)
    env = _git_env(author_name, author_email)
    _run(["git", "-C", str(repo), "add", "-A"], env=env)
    _run(["git", "-C", str(repo), "commit", "-m", msg], env=env)


def _bare(source: Path, dest: Path) -> str:
    _run(["git", "clone", "--bare", str(source), str(dest)])
    # Allow partial-clone fetch from this bare repo (needed for --filter=blob:none).
    _run(["git", "-C", str(dest), "config", "uploadpack.allowFilter", "true"])
    _run(["git", "-C", str(dest), "config", "uploadpack.allowAnySHA1InWant", "true"])
    return str(dest)


# ── fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture
def python_repo(tmp_path: Path) -> str:
    """Single-author Python repo with a manifest, source, tests, and a Dockerfile."""
    source = tmp_path / "source"
    _init_repo(source)
    _commit(source, {
        "README.md": "hello",
        "pyproject.toml": "[project]\nname = 'demo'\n",
    }, msg="initial")
    _commit(source, {"src/app.py": "print('a')"}, msg="add app")
    _commit(source, {"src/util.py": "x = 1"}, msg="add util")
    _commit(source, {"tests/test_app.py": "def test(): pass"}, msg="add test")
    _commit(source, {"tests/test_util.py": "def test(): pass"}, msg="more tests")
    _commit(source, {"Dockerfile": "FROM python:3.11\n"}, msg="dockerize")
    return _bare(source, tmp_path / "bare.git")


@pytest.fixture
def two_author_repo(tmp_path: Path) -> str:
    """Repo with commits from two different emails."""
    source = tmp_path / "source"
    _init_repo(source)
    _commit(source, {"a.py": "1"}, msg="dev1")
    _commit(source, {"b.py": "2"}, msg="dev2")
    _commit(source, {"c.py": "3"}, author_name="Alice", author_email=OTHER_EMAIL, msg="alice1")
    _commit(source, {"d.py": "4"}, author_name="Alice", author_email=OTHER_EMAIL, msg="alice2")
    return _bare(source, tmp_path / "bare.git")


@pytest.fixture
def mixed_test_repo(tmp_path: Path) -> str:
    """Repo with a known mix of production vs test files."""
    source = tmp_path / "source"
    _init_repo(source)
    _commit(source, {
        "src/app.py": "1",
        "src/util.py": "1",
        "src/db.py": "1",
        "tests/test_app.py": "t",
        "tests/test_util.py": "t",
    }, msg="seed")
    return _bare(source, tmp_path / "bare.git")


@pytest.fixture
def ext_counts_repo(tmp_path: Path) -> str:
    """Repo where the same .py file is modified twice — so occurrence counts > unique counts."""
    source = tmp_path / "source"
    _init_repo(source)
    _commit(source, {"a.py": "v1", "b.py": "v1", "c.rb": "v1"}, msg="first")
    _commit(source, {"a.py": "v2"}, msg="touch a")
    _commit(source, {"b.py": "v2"}, msg="touch b")
    return _bare(source, tmp_path / "bare.git")


# ── tests ────────────────────────────────────────────────────────────────────


def test_extract_returns_correct_root_hash(python_repo: str) -> None:
    expected_root = subprocess.check_output(
        ["git", "-C", python_repo, "rev-list", "--max-parents=0", "HEAD"],
        text=True,
    ).strip()

    result = extract(python_repo, DEV_EMAIL, os.environ.copy())
    assert isinstance(result, L1ExtractedSignals)
    assert result.root_commit_hash == expected_root
    assert len(result.root_commit_hash) == 40  # SHA-1


def test_extract_counts_author_commits_only(two_author_repo: str) -> None:
    result = extract(two_author_repo, DEV_EMAIL, os.environ.copy())
    assert result.commit_count == 2  # Dev made 2; Alice made 2 (excluded)


def test_extract_author_not_found_raises_error(python_repo: str) -> None:
    with pytest.raises(AuthorNotFoundError):
        extract(python_repo, "nobody@nowhere.example", os.environ.copy())


def test_extract_detects_python_ecosystem(python_repo: str) -> None:
    result = extract(python_repo, DEV_EMAIL, os.environ.copy())
    assert result.ecosystems.get("python") is True


def test_extract_detects_docker_platform(python_repo: str) -> None:
    result = extract(python_repo, DEV_EMAIL, os.environ.copy())
    assert result.platforms.get("docker") is True


def test_extract_calculates_test_ratio(mixed_test_repo: str) -> None:
    result = extract(mixed_test_repo, DEV_EMAIL, os.environ.copy())
    # 5 unique files, 2 are tests → 2/5 = 0.4
    assert result.test_ratio == pytest.approx(0.4)


def test_extract_tmpdir_always_removed_on_success(
    python_repo: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    created: list[str] = []
    real_mkdtemp = tempfile.mkdtemp

    def spy_mkdtemp(*args, **kwargs):
        d = real_mkdtemp(*args, **kwargs)
        created.append(d)
        return d

    monkeypatch.setattr(git_extractor.tempfile, "mkdtemp", spy_mkdtemp)

    extract(python_repo, DEV_EMAIL, os.environ.copy())
    assert created, "mkdtemp was never called — test setup wrong"
    for d in created:
        assert not os.path.exists(d), f"tmpdir leaked on success: {d}"


def test_extract_tmpdir_always_removed_on_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    created: list[str] = []
    real_mkdtemp = tempfile.mkdtemp

    def spy_mkdtemp(*args, **kwargs):
        d = real_mkdtemp(*args, **kwargs)
        created.append(d)
        return d

    monkeypatch.setattr(git_extractor.tempfile, "mkdtemp", spy_mkdtemp)

    # Bogus URL — clone will fail, but finally must still wipe the tmpdir.
    bogus = str(tmp_path / "does-not-exist.git")
    with pytest.raises(CloneError):
        extract(bogus, DEV_EMAIL, os.environ.copy())

    assert created, "mkdtemp was never called — test setup wrong"
    for d in created:
        assert not os.path.exists(d), f"tmpdir leaked on error: {d}"


def test_extract_never_stores_commit_messages(tmp_path: Path) -> None:
    """Commit messages are written with unique sentinel strings; assert that
    none of them appear in any field of the returned signals."""
    source = tmp_path / "source"
    _init_repo(source)
    sentinels = [
        "SENTINEL_MESSAGE_ALPHA_8472",
        "SENTINEL_MESSAGE_BRAVO_3319",
        "SENTINEL_MESSAGE_CHARLIE_5562",
    ]
    _commit(source, {"a.py": "1"}, msg=sentinels[0])
    _commit(source, {"b.py": "2"}, msg=sentinels[1])
    _commit(source, {"c.py": "3"}, msg=sentinels[2])

    bare = _bare(source, tmp_path / "bare.git")
    result = extract(bare, DEV_EMAIL, os.environ.copy())

    flat = str(asdict(result))
    for s in sentinels:
        assert s not in flat, f"commit message leaked into result: {s}"


def test_extract_file_extensions_counted_correctly(ext_counts_repo: str) -> None:
    result = extract(ext_counts_repo, DEV_EMAIL, os.environ.copy())
    # a.py modified in 2 commits, b.py in 2, c.rb in 1 → py:4, rb:1
    assert result.file_extensions.get("py") == 4
    assert result.file_extensions.get("rb") == 1


def test_extract_author_email_is_hashed(python_repo: str) -> None:
    """Defensive: the email must never appear verbatim in the result."""
    result = extract(python_repo, DEV_EMAIL, os.environ.copy())
    assert DEV_EMAIL not in result.author_email_hash
    assert len(result.author_email_hash) == 16  # SHA-256 truncated to 16 chars


def test_extract_timestamps_are_iso8601(python_repo: str) -> None:
    result = extract(python_repo, DEV_EMAIL, os.environ.copy())
    # %aI emits something like "2026-05-14T10:00:00-03:00"
    assert "T" in result.first_commit_at
    assert "T" in result.last_commit_at
    # First commit chronologically should be ≤ last commit.
    assert result.first_commit_at <= result.last_commit_at

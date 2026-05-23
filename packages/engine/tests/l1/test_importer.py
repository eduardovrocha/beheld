from __future__ import annotations

import os
import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from l1 import importer as importer_module
from l1.auth_resolver import AuthMethod
from l1.git_extractor import AuthorNotFoundError, CloneError, L1ExtractedSignals
from l1.importer import L1Importer
from storage.sqlite import BeheldDB


# ── fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture
def db() -> BeheldDB:
    instance = BeheldDB(":memory:")
    instance.init_schema()
    yield instance
    instance.close()


@pytest.fixture
def imp(db: BeheldDB) -> L1Importer:
    return L1Importer(db)


def _signals(
    root: str = "a" * 40,
    commit_count: int = 5,
    ecosystems: dict | None = None,
    platforms: dict | None = None,
) -> L1ExtractedSignals:
    return L1ExtractedSignals(
        root_commit_hash=root,
        commit_count=commit_count,
        author_email_hash="d4e5f6a1b2c3d4e5",
        file_extensions={"py": 12},
        ecosystems=ecosystems or {"python": True},
        platforms=platforms or {"docker": True},
        test_ratio=0.3,
        timing={"peak_hours": [10, 11], "avg_duration_min": 42.0},
        first_commit_at="2024-01-01T00:00:00+00:00",
        last_commit_at="2026-05-01T00:00:00+00:00",
    )


def _stub_auth(monkeypatch: pytest.MonkeyPatch, auth: AuthMethod) -> None:
    monkeypatch.setattr(importer_module.auth_resolver, "resolve", lambda url, pat=None: auth)


def _stub_extract(monkeypatch: pytest.MonkeyPatch, fn) -> MagicMock:
    spy = MagicMock(side_effect=fn) if callable(fn) else MagicMock(return_value=fn)
    monkeypatch.setattr(importer_module.git_extractor, "extract", spy)
    return spy


# ── pre-clone idempotency ────────────────────────────────────────────────────


def test_import_returns_already_imported_without_cloning(
    imp: L1Importer, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Pre-populate the URL → root-hash cache.
    imp._cache_store("https://example.com/foo/bar.git", "cached_root_hash")

    _stub_auth(monkeypatch, AuthMethod(method="ssh"))
    extract_spy = _stub_extract(monkeypatch, lambda *a, **kw: pytest.fail("must not clone"))

    result = imp.import_repository("https://example.com/foo/bar.git", "dev@example.com")

    assert result == {"status": "already_imported", "root_commit_hash": "cached_root_hash"}
    extract_spy.assert_not_called()


# ── auth cascade outcomes ────────────────────────────────────────────────────


def test_import_returns_needs_pat_when_no_auth(
    imp: L1Importer, monkeypatch: pytest.MonkeyPatch
) -> None:
    _stub_auth(monkeypatch, AuthMethod(method="pat", needs_pat=True))
    extract_spy = _stub_extract(monkeypatch, lambda *a, **kw: pytest.fail("must not clone"))

    result = imp.import_repository("https://example.com/foo/bar.git", "dev@example.com")

    assert result == {"status": "needs_pat"}
    extract_spy.assert_not_called()


def test_import_returns_author_not_found(
    imp: L1Importer, monkeypatch: pytest.MonkeyPatch
) -> None:
    _stub_auth(monkeypatch, AuthMethod(method="ssh"))

    def raise_anf(*_a, **_kw):
        raise AuthorNotFoundError("no commits")

    _stub_extract(monkeypatch, raise_anf)

    result = imp.import_repository("https://example.com/foo/bar.git", "ghost@nowhere.example")
    assert result == {"status": "author_not_found"}


def test_import_returns_clone_error(imp: L1Importer, monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_auth(monkeypatch, AuthMethod(method="ssh"))

    def raise_clone(*_a, **_kw):
        raise CloneError("auth failed")

    _stub_extract(monkeypatch, raise_clone)

    result = imp.import_repository("https://example.com/foo/bar.git", "dev@example.com")
    assert result["status"] == "clone_error"
    assert "auth failed" in result["detail"]


# ── happy path & persistence ─────────────────────────────────────────────────


def test_import_happy_path_saves_to_sqlite(
    imp: L1Importer, db: BeheldDB, monkeypatch: pytest.MonkeyPatch
) -> None:
    _stub_auth(monkeypatch, AuthMethod(method="ssh"))
    _stub_extract(monkeypatch, _signals(root="b" * 40, commit_count=42))

    result = imp.import_repository("https://example.com/foo/bar.git", "dev@example.com")

    assert result["status"] == "imported"
    assert result["root_commit_hash"] == "b" * 40
    assert result["commit_count"] == 42

    # Persisted in l1_repositories.
    repos = db.get_l1_repositories()
    assert len(repos) == 1
    assert repos[0]["root_commit_hash"] == "b" * 40
    assert repos[0]["commit_count"] == 42

    # Persisted in l1_signals (verify via aggregated view).
    summary = db.get_l1_summary()
    assert summary["total_repos"] == 1
    assert summary["total_commits"] == 42
    assert summary["ecosystems_merged"].get("python") is True
    assert summary["platforms_merged"].get("docker") is True


def test_import_idempotent_second_call(
    imp: L1Importer, db: BeheldDB, monkeypatch: pytest.MonkeyPatch
) -> None:
    _stub_auth(monkeypatch, AuthMethod(method="ssh"))
    spy = _stub_extract(monkeypatch, _signals(root="c" * 40))

    first = imp.import_repository("https://example.com/foo/bar.git", "dev@example.com")
    assert first["status"] == "imported"
    assert spy.call_count == 1

    # Second call hits the URL cache → no extract, no second row.
    second = imp.import_repository("https://example.com/foo/bar.git", "dev@example.com")
    assert second == {"status": "already_imported", "root_commit_hash": "c" * 40}
    assert spy.call_count == 1, "extract must not be called on the second import"
    assert db.get_l1_summary()["total_repos"] == 1


def test_import_same_repo_via_different_url_dedupes_on_real_hash(
    imp: L1Importer, db: BeheldDB, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two URLs (e.g. mirror + canonical) that map to the same root commit
    should only produce one row — and the new URL is then cached."""
    _stub_auth(monkeypatch, AuthMethod(method="ssh"))
    _stub_extract(monkeypatch, _signals(root="d" * 40))

    first = imp.import_repository("https://canonical/repo.git", "dev@example.com")
    assert first["status"] == "imported"

    second = imp.import_repository("https://mirror/repo.git", "dev@example.com")
    assert second == {"status": "already_imported", "root_commit_hash": "d" * 40}
    assert db.get_l1_summary()["total_repos"] == 1

    # The mirror URL is now cached too.
    third = imp.import_repository("https://mirror/repo.git", "dev@example.com")
    assert third == {"status": "already_imported", "root_commit_hash": "d" * 40}


# ── status reporting ─────────────────────────────────────────────────────────


def test_import_status_idle_initially(imp: L1Importer) -> None:
    status = imp.get_import_status()
    assert status["status"] == "idle"
    assert status["progress_pct"] == 0
    assert status["repo_url"] is None
    assert status["result"] is None


def test_import_status_transitions(
    imp: L1Importer, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Capture the status at each phase: idle → processing (mid-extract) → done."""
    seen: list[str] = []

    seen.append(imp.get_import_status()["status"])  # idle

    def fake_extract(*_a, **_kw):
        seen.append(imp.get_import_status()["status"])  # processing (mid-flight)
        return _signals(root="e" * 40)

    _stub_auth(monkeypatch, AuthMethod(method="ssh"))
    monkeypatch.setattr(importer_module.git_extractor, "extract", fake_extract)

    imp.import_repository("https://example.com/foo/bar.git", "dev@example.com")
    seen.append(imp.get_import_status()["status"])  # done

    assert seen == ["idle", "processing", "done"]

    final = imp.get_import_status()
    assert final["progress_pct"] == 100
    assert final["repo_url"] == "https://example.com/foo/bar.git"
    assert final["result"]["status"] == "imported"


def test_import_status_error_on_clone_failure(
    imp: L1Importer, monkeypatch: pytest.MonkeyPatch
) -> None:
    _stub_auth(monkeypatch, AuthMethod(method="ssh"))

    def raise_clone(*_a, **_kw):
        raise CloneError("repo not found")

    _stub_extract(monkeypatch, raise_clone)
    imp.import_repository("https://example.com/foo/bar.git", "dev@example.com")

    status = imp.get_import_status()
    assert status["status"] == "error"
    assert status["result"]["status"] == "clone_error"


# ── cache fingerprints don't leak URLs ───────────────────────────────────────


def test_cache_uses_url_fingerprint_not_plaintext(
    imp: L1Importer, db: BeheldDB, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The `profile` table must not contain the plaintext repo URL — only a
    SHA-256 fingerprint."""
    _stub_auth(monkeypatch, AuthMethod(method="ssh"))
    _stub_extract(monkeypatch, _signals(root="f" * 40))

    secret_url = "https://github.com/secret-org/secret-repo.git"
    imp.import_repository(secret_url, "dev@example.com")

    all_profile = db.get_all_profile()
    for key, value in all_profile.items():
        assert "secret-org" not in key
        assert "secret-org" not in value
        assert "secret-repo" not in key
        assert "secret-repo" not in value

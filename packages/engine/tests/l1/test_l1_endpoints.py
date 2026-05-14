from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from api import app
from l1.importer import L1Importer
from storage.sqlite import DevProfileDB


@pytest.fixture
def test_db(db_path: Path) -> DevProfileDB:
    instance = DevProfileDB(db_path)
    instance.init_schema()
    yield instance
    instance.close()


@pytest.fixture
def client(test_db: DevProfileDB):
    importer = L1Importer(test_db)
    with patch("api.db", test_db), \
         patch("api.l1_importer", importer), \
         patch("api.insights_gen"), \
         patch("apscheduler.schedulers.asyncio.AsyncIOScheduler.start"), \
         patch("apscheduler.schedulers.asyncio.AsyncIOScheduler.shutdown"):
        with TestClient(app) as c:
            yield c


# ── POST /l1/import ──────────────────────────────────────────────────────────


def test_post_l1_import_returns_202(client: TestClient) -> None:
    """The endpoint must accept immediately; the orchestration runs in the
    background. We make it short-circuit via the URL cache so the background
    task can't accidentally hit the network even if scheduled."""
    # Seed the cache so the background task short-circuits to already_imported.
    with patch("l1.importer.auth_resolver.resolve") as mock_resolve, \
         patch("l1.importer.git_extractor.extract") as mock_extract:
        from l1.auth_resolver import AuthMethod
        mock_resolve.return_value = AuthMethod(method="pat", needs_pat=True)
        mock_extract.side_effect = AssertionError("extract must not run when needs_pat")

        response = client.post("/l1/import", json={
            "repo_url": "https://example.com/foo/bar.git",
            "author_email": "dev@example.com",
        })

    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "processing"
    assert body["repo_url"] == "https://example.com/foo/bar.git"


def test_post_l1_import_rejects_missing_body(client: TestClient) -> None:
    response = client.post("/l1/import", json={})
    assert response.status_code == 422  # FastAPI/pydantic validation


def test_post_l1_import_accepts_optional_pat(client: TestClient) -> None:
    with patch("l1.importer.auth_resolver.resolve") as mock_resolve, \
         patch("l1.importer.git_extractor.extract") as mock_extract:
        from l1.auth_resolver import AuthMethod
        mock_resolve.return_value = AuthMethod(method="pat", pat="TOKEN")
        # Make extract raise quickly so we don't actually try to clone.
        from l1.git_extractor import CloneError
        mock_extract.side_effect = CloneError("stubbed")

        response = client.post("/l1/import", json={
            "repo_url": "https://example.com/foo/bar.git",
            "author_email": "dev@example.com",
            "pat": "ghp_TEST_TOKEN",
        })

    assert response.status_code == 202


# ── GET /l1/import/status ────────────────────────────────────────────────────


def test_get_l1_import_status_returns_valid_schema(client: TestClient) -> None:
    response = client.get("/l1/import/status")
    assert response.status_code == 200
    body = response.json()
    # Schema: always these fields, regardless of state.
    assert set(body.keys()) >= {"status", "repo_url", "progress_pct", "result"}
    assert body["status"] in {"idle", "processing", "done", "error"}
    assert isinstance(body["progress_pct"], int)
    assert 0 <= body["progress_pct"] <= 100


def test_get_l1_import_status_starts_idle(client: TestClient) -> None:
    body = client.get("/l1/import/status").json()
    assert body["status"] == "idle"
    assert body["repo_url"] is None
    assert body["progress_pct"] == 0
    assert body["result"] is None


def test_l1_import_status_reflects_completion(client: TestClient) -> None:
    """After a POST /l1/import, status eventually settles to 'done' or 'error'."""
    with patch("l1.importer.auth_resolver.resolve") as mock_resolve, \
         patch("l1.importer.git_extractor.extract") as mock_extract:
        from l1.auth_resolver import AuthMethod
        from l1.git_extractor import CloneError
        mock_resolve.return_value = AuthMethod(method="ssh", env={})
        mock_extract.side_effect = CloneError("stubbed")

        resp = client.post("/l1/import", json={
            "repo_url": "https://example.com/foo/bar.git",
            "author_email": "dev@example.com",
        })
        assert resp.status_code == 202

    status = client.get("/l1/import/status").json()
    # BackgroundTasks complete before TestClient returns the response.
    assert status["status"] == "error"
    assert status["result"]["status"] == "clone_error"


# ── GET /l1/repositories ─────────────────────────────────────────────────────


def test_get_l1_repositories_empty(client: TestClient) -> None:
    response = client.get("/l1/repositories")
    assert response.status_code == 200
    assert response.json() == []


# ── DELETE /l1/repositories/{root_hash} ──────────────────────────────────────


def test_delete_l1_repository_not_found_returns_404(client: TestClient) -> None:
    response = client.delete("/l1/repositories/does-not-exist")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_delete_l1_repository_success(client: TestClient, test_db: DevProfileDB) -> None:
    test_db.save_l1_repository("hash-x", "2026-05-14T10:00:00+00:00", 10, "e1")
    response = client.delete("/l1/repositories/hash-x")
    assert response.status_code == 200
    assert response.json()["ok"] is True
    # Subsequent delete is now a 404.
    assert client.delete("/l1/repositories/hash-x").status_code == 404


# ── GET /l1/summary remains zero-safe ────────────────────────────────────────


def test_get_l1_summary_zero_safe_on_empty_db(client: TestClient) -> None:
    response = client.get("/l1/summary")
    assert response.status_code == 200
    body = response.json()
    assert body["total_repos"] == 0
    assert body["total_commits"] == 0
    assert body["avg_test_ratio"] == 0.0

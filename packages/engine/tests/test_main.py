from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from api import VERSION, app
from storage.sqlite import DevProfileDB


@pytest.fixture(autouse=True)
def isolated_db(db_path: Path):
    tmp = DevProfileDB(db_path)
    tmp.init_schema()
    with patch("api.db", tmp), \
         patch("apscheduler.schedulers.asyncio.AsyncIOScheduler.start"), \
         patch("apscheduler.schedulers.asyncio.AsyncIOScheduler.shutdown"):
        yield
    tmp.close()


client = TestClient(app)


def test_health_returns_ok() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_returns_version() -> None:
    assert client.get("/health").json()["version"] == VERSION


def test_version_format() -> None:
    parts = VERSION.split(".")
    assert len(parts) == 3
    assert all(p.isdigit() for p in parts)


def test_scores_current_returns_four_dimensions() -> None:
    response = client.get("/scores/current")
    assert response.status_code == 200
    data = response.json()
    assert "prompt_quality" in data
    assert "test_maturity" in data
    assert "tech_breadth" in data
    assert "growth_rate" in data
    assert "overall" in data


def test_process_endpoint_no_events() -> None:
    from processor import ProcessResult
    with patch("api.processor") as mock_proc:
        mock_proc.process_new.return_value = ProcessResult(new_sessions=0)
        response = client.post("/process")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

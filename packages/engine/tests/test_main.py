import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch

from api import VERSION, app
from storage.sqlite import DevProfileDB


@pytest.fixture(autouse=True)
def isolated_db(db_path):
    tmp = DevProfileDB(db_path)
    tmp.init_schema()
    with patch("api.db", tmp):
        yield
    tmp.close()


client = TestClient(app)


def test_health_returns_ok():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"


def test_health_returns_version():
    response = client.get("/health")
    assert response.json()["version"] == VERSION


def test_version_format():
    parts = VERSION.split(".")
    assert len(parts) == 3
    assert all(p.isdigit() for p in parts)


def test_scores_current_returns_four_dimensions():
    response = client.get("/scores/current")
    assert response.status_code == 200
    data = response.json()
    assert "prompt_quality" in data
    assert "test_maturity" in data
    assert "tech_breadth" in data
    assert "growth_rate" in data
    assert "overall" in data


def test_process_endpoint():
    from unittest.mock import patch
    with patch("api.read_all_events", return_value=[]):
        response = client.post("/process")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

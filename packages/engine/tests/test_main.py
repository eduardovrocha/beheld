from fastapi.testclient import TestClient

from main import app, VERSION

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
    response = client.post("/process")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

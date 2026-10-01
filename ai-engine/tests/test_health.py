from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Environment, Settings
from app.main import create_app
from app.runtime import RuntimeState


class FakeClock:
    def __init__(self, current: float = 100.0) -> None:
        self.current = current

    def __call__(self) -> float:
        return self.current


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def application(clock: FakeClock) -> FastAPI:
    application = create_app(Settings(environment=Environment.TEST), clock=clock)
    return application


@pytest.fixture
def client(application: FastAPI) -> Iterator[TestClient]:
    with TestClient(application) as test_client:
        yield test_client


def test_reports_unready_until_a_model_is_loaded(client: TestClient, clock: FakeClock) -> None:
    clock.current = 112.3456

    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "status": "unhealthy",
        "model_loaded": False,
        "model_version": None,
        "uptime_seconds": 12.346,
        "total_predictions": 0,
        "avg_latency_ms": 0.0,
        "p99_latency_ms": 0.0,
        "errors_total": 0,
    }


def test_reports_loaded_model_and_inference_metrics(
    application: FastAPI, client: TestClient, clock: FakeClock
) -> None:
    runtime: RuntimeState = application.state.runtime
    runtime.mark_model_loaded("v20260920_120000")
    runtime.record_prediction(10.0)
    runtime.record_prediction(30.0, failed=True)
    clock.current = 105.0

    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "healthy",
        "model_loaded": True,
        "model_version": "v20260920_120000",
        "uptime_seconds": 5.0,
        "total_predictions": 2,
        "avg_latency_ms": 20.0,
        "p99_latency_ms": 30.0,
        "errors_total": 1,
    }


def test_production_disables_interactive_api_documentation() -> None:
    application = create_app(Settings(environment=Environment.PRODUCTION))

    with TestClient(application) as client:
        assert client.get("/docs").status_code == 404
        assert client.get("/openapi.json").status_code == 404

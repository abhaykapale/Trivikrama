from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
from fastapi.testclient import TestClient
from numpy.typing import ArrayLike, NDArray

from app.config import Environment, Settings
from app.core.explainer import ShapExplanation
from app.core.feature_contract import AI_FEATURE_NAMES, DEFAULT_FEATURE_VALUES
from app.core.model_loader import LoadedModelArtifacts
from app.main import create_app
from app.runtime import RuntimeState


class DummyModel:
    n_features_in_ = len(AI_FEATURE_NAMES)

    def decision_function(self, values: Any) -> Any:
        return values


class DummyScaler:
    n_features_in_ = len(AI_FEATURE_NAMES)

    def transform(self, values: NDArray[np.float64]) -> ArrayLike:
        return values


class ModelLoader:
    config_path = Path("required-model")

    def load(self, version: str | None = None) -> LoadedModelArtifacts:
        return LoadedModelArtifacts(
            version="v20260920_120000",
            model=DummyModel(),
            scaler=DummyScaler(),
            threshold=0.65,
            raw_score_min=-0.25,
            raw_score_max=0.35,
            feature_names=AI_FEATURE_NAMES,
            feature_defaults=dict(DEFAULT_FEATURE_VALUES),
            training_metadata={
                "trained_at": "2026-09-20T12:00:00Z",
                "training_samples": 800_000,
                "holdout_samples": 200_000,
                "n_estimators": 200,
                "anomaly_rate_at_threshold": 0.05,
                "artifact_path": "must-not-be-exposed/model.joblib",
            },
        )

    def list_versions(self) -> tuple[str, ...]:
        return ("v20260901_080000", "v20260920_120000")


class NoopExplanationProvider:
    def explain(
        self,
        scaled_values: NDArray[np.float64],
        display_values: NDArray[np.float64],
    ) -> ShapExplanation:
        raise AssertionError("operational endpoints must not execute SHAP")


def explanation_provider_factory(
    model: Any,
    feature_names: object,
) -> NoopExplanationProvider:
    return NoopExplanationProvider()


def test_metrics_reports_bounded_runtime_aggregates() -> None:
    loaded_at = datetime(2026, 9, 25, 12, 0, tzinfo=UTC)
    runtime = RuntimeState(wall_clock=lambda: loaded_at, latency_window_size=2)
    runtime.mark_model_loaded("v20260920_120000", threshold=0.65)
    runtime.record_prediction(10.0, events_processed=3, anomalies_detected=1)
    runtime.record_prediction(20.0, events_processed=6, anomalies_detected=2)
    runtime.record_prediction(30.0, failed=True, events_processed=0)
    runtime.record_explanation(4.0)
    runtime.record_explanation(8.0)

    application = create_app(Settings(environment=Environment.TEST))
    application.state.runtime = runtime
    with TestClient(application) as client:
        response = client.get("/api/v1/metrics")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "inference": {
            "total_requests": 3,
            "total_events_processed": 9,
            "total_anomalies_detected": 3,
            "avg_batch_size": 3.0,
            "avg_latency_ms": 20.0,
            "p50_latency_ms": 20.0,
            "p95_latency_ms": 30.0,
            "p99_latency_ms": 30.0,
            "error_rate": 0.333333,
        },
        "shap": {
            "total_explanations": 2,
            "avg_explanation_ms": 6.0,
        },
        "model": {
            "version": "v20260920_120000",
            "threshold": 0.65,
            "loaded_at": "2026-09-25T12:00:00Z",
        },
    }


def test_model_info_returns_only_validated_loaded_bundle_metadata() -> None:
    application = create_app(
        Settings(environment=Environment.TEST, require_model_on_startup=True),
        model_loader=ModelLoader(),
        explanation_provider_factory=explanation_provider_factory,
    )

    with TestClient(application) as client:
        response = client.get("/api/v1/model/info")

    body = response.json()
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert body["active_version"] == "v20260920_120000"
    assert body["threshold"] == 0.65
    assert body["feature_count"] == 20
    assert body["feature_names"] == list(AI_FEATURE_NAMES)
    assert body["training_metadata"]["training_samples"] == 800_000
    assert "artifact_path" not in body["training_metadata"]
    assert body["available_versions"] == [
        "v20260901_080000",
        "v20260920_120000",
    ]


def test_model_info_returns_503_without_a_loaded_bundle() -> None:
    application = create_app(Settings(environment=Environment.TEST))

    with TestClient(application) as client:
        response = client.get("/api/v1/model/info")

    assert response.status_code == 503
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "detail": "Model information is unavailable because no model is loaded."
    }

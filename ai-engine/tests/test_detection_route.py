from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from fastapi.testclient import TestClient
from numpy.typing import ArrayLike, NDArray

from app.config import Environment, Settings
from app.core.explainer import ShapExplanation, ShapFeatureContribution
from app.core.feature_contract import AI_FEATURE_NAMES, DEFAULT_FEATURE_VALUES
from app.core.model_loader import LoadedModelArtifacts
from app.main import create_app


class IdentityScaler:
    n_features_in_ = len(AI_FEATURE_NAMES)

    def transform(self, values: NDArray[np.float64]) -> ArrayLike:
        return values


class FixedScoreModel:
    n_features_in_ = len(AI_FEATURE_NAMES)

    def __init__(self, scores: ArrayLike) -> None:
        self._scores = scores

    def decision_function(self, values: Any) -> Any:
        return self._scores


class SuccessfulLoader:
    config_path = Path("unused-by-required-startup")

    def __init__(self, scores: ArrayLike) -> None:
        self._scores = scores

    def load(self, version: str | None = None) -> LoadedModelArtifacts:
        return LoadedModelArtifacts(
            version="v20260920_120000",
            model=FixedScoreModel(self._scores),
            scaler=IdentityScaler(),
            threshold=0.65,
            raw_score_min=-0.5,
            raw_score_max=0.5,
            feature_names=AI_FEATURE_NAMES,
            feature_defaults=dict(DEFAULT_FEATURE_VALUES),
            training_metadata={},
        )


class FakeExplanationProvider:
    def explain(
        self,
        scaled_values: NDArray[np.float64],
        display_values: NDArray[np.float64],
    ) -> ShapExplanation:
        return ShapExplanation(
            base_value=-4.0,
            features=(
                ShapFeatureContribution(
                    name="hour_of_day",
                    value=float(display_values[0, 0]),
                    shap_value=0.8,
                ),
            ),
        )


def fake_explanation_provider_factory(
    model: Any,
    feature_names: object,
) -> FakeExplanationProvider:
    return FakeExplanationProvider()


class StepClock:
    def __init__(self, *values: float) -> None:
        self._values = iter(values)
        self._last = 0.0

    def __call__(self) -> float:
        self._last = next(self._values, self._last)
        return self._last


def event(event_id: str) -> dict[str, object]:
    return {
        "event_id": event_id,
        "features": {
            "hour_of_day": 3,
            "day_of_week": 5,
            "is_business_hours": 0,
            "severity_id": 3,
        },
    }


def test_returns_503_and_records_an_error_before_a_model_is_ready(tmp_path: Path) -> None:
    application = create_app(
        Settings(environment=Environment.TEST, models_dir=tmp_path),
        clock=StepClock(100.0, 100.01, 100.02),
    )

    with TestClient(application) as client:
        response = client.post("/api/v1/detect/anomaly", json={"events": [event("one")]})
        health = client.get("/api/v1/health").json()

    assert response.status_code == 503
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {"detail": "Detection model is not ready."}
    assert health["total_predictions"] == 1
    assert health["errors_total"] == 1


def test_detects_a_batch_and_returns_the_public_contract() -> None:
    application = create_app(
        Settings(environment=Environment.TEST, require_model_on_startup=True),
        clock=StepClock(100.0, 100.01, 100.025),
        model_loader=SuccessfulLoader([-0.5, 0.5]),
        explanation_provider_factory=fake_explanation_provider_factory,
    )

    with TestClient(application) as client:
        response = client.post(
            "/api/v1/detect/anomaly",
            json={
                "events": [event("anomalous"), event("normal")],
                "threshold": 0.5,
                "include_shap": True,
            },
        )

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "predictions": [
            {
                "event_id": "anomalous",
                "anomaly_score": 1.0,
                "is_anomaly": True,
                "confidence": 0.9933,
                "shap_explanation": {
                    "base_value": -4.0,
                    "features": [
                        {
                            "name": "hour_of_day",
                            "value": 3.0,
                            "shap_value": 0.8,
                        }
                    ],
                },
            },
            {
                "event_id": "normal",
                "anomaly_score": 0.0,
                "is_anomaly": False,
                "confidence": 0.9933,
                "shap_explanation": None,
            },
        ],
        "model_version": "v20260920_120000",
        "processing_time_ms": 15.0,
        "events_processed": 2,
        "anomalies_detected": 1,
    }


def test_uses_the_versioned_threshold_when_the_request_omits_it() -> None:
    application = create_app(
        Settings(environment=Environment.TEST, require_model_on_startup=True),
        model_loader=SuccessfulLoader([-0.1]),
        explanation_provider_factory=fake_explanation_provider_factory,
    )

    with TestClient(application) as client:
        response = client.post("/api/v1/detect/anomaly", json={"events": [event("borderline")]})

    assert response.status_code == 200
    # raw -0.1 maps to 0.6, below the configured 0.65 threshold.
    assert response.json()["predictions"][0]["is_anomaly"] is False


def test_rejects_duplicate_event_ids_before_inference() -> None:
    application = create_app(
        Settings(environment=Environment.TEST, require_model_on_startup=True),
        model_loader=SuccessfulLoader([0.0, 0.0]),
        explanation_provider_factory=fake_explanation_provider_factory,
    )

    with TestClient(application) as client:
        response = client.post(
            "/api/v1/detect/anomaly",
            json={"events": [event("duplicate"), event("duplicate")]},
        )

    assert response.status_code == 422


def test_returns_a_generic_500_and_records_failed_inference() -> None:
    application = create_app(
        Settings(environment=Environment.TEST, require_model_on_startup=True),
        model_loader=SuccessfulLoader([[0.0]]),
        explanation_provider_factory=fake_explanation_provider_factory,
    )

    with TestClient(application) as client:
        response = client.post("/api/v1/detect/anomaly", json={"events": [event("one")]})
        health = client.get("/api/v1/health").json()

    assert response.status_code == 500
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {"detail": "Anomaly detection failed."}
    assert health["total_predictions"] == 1
    assert health["errors_total"] == 1

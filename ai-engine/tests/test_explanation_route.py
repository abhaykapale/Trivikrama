from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
from fastapi.testclient import TestClient
from numpy.typing import ArrayLike, NDArray

from app.config import Environment, Settings
from app.core.explainer import (
    ShapExplanation,
    ShapExplanationError,
    ShapFeatureContribution,
)
from app.core.feature_contract import AI_FEATURE_NAMES, DEFAULT_FEATURE_VALUES
from app.core.model_loader import LoadedModelArtifacts
from app.main import create_app


class IdentityScaler:
    n_features_in_ = len(AI_FEATURE_NAMES)

    def transform(self, values: NDArray[np.float64]) -> ArrayLike:
        return values


class FixedScoreModel:
    n_features_in_ = len(AI_FEATURE_NAMES)

    def __init__(self, score: float) -> None:
        self._score = score

    def decision_function(self, values: Any) -> Any:
        return [self._score]


class SuccessfulLoader:
    config_path = Path("unused-by-required-startup")

    def __init__(self, score: float = -0.25) -> None:
        self._score = score

    def load(self, version: str | None = None) -> LoadedModelArtifacts:
        return LoadedModelArtifacts(
            version="v20260922_120000",
            model=FixedScoreModel(self._score),
            scaler=IdentityScaler(),
            threshold=0.65,
            raw_score_min=-0.5,
            raw_score_max=0.5,
            feature_names=AI_FEATURE_NAMES,
            feature_defaults=dict(DEFAULT_FEATURE_VALUES),
            training_metadata={},
        )


class ExplanationProvider:
    def __init__(self, *, fail: bool = False) -> None:
        self._fail = fail

    def explain(
        self,
        scaled_values: NDArray[np.float64],
        display_values: NDArray[np.float64],
    ) -> ShapExplanation:
        if self._fail:
            raise ShapExplanationError("private SHAP failure")
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


def explanation_factory(model: object, feature_names: object) -> ExplanationProvider:
    return ExplanationProvider()


def failing_explanation_factory(
    model: object,
    feature_names: object,
) -> ExplanationProvider:
    return ExplanationProvider(fail=True)


class StepClock:
    def __init__(self, *values: float) -> None:
        self._values = iter(values)
        self._last = 0.0

    def __call__(self) -> float:
        self._last = next(self._values, self._last)
        return self._last


def request_body() -> dict[str, object]:
    return {
        "event_id": "evt-explain-1",
        "features": {
            "hour_of_day": 3,
            "day_of_week": 5,
            "is_business_hours": 0,
            "severity_id": 3,
        },
    }


def test_returns_the_standalone_explanation_contract() -> None:
    application = create_app(
        Settings(environment=Environment.TEST, require_model_on_startup=True),
        clock=StepClock(100.0, 100.01, 100.022),
        model_loader=SuccessfulLoader(),
        explanation_provider_factory=explanation_factory,
    )

    with TestClient(application) as client:
        response = client.post("/api/v1/explain", json=request_body())
        health = client.get("/api/v1/health").json()

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "event_id": "evt-explain-1",
        "anomaly_score": 0.75,
        "shap_explanation": {
            "base_value": -4.0,
            "features": [{"name": "hour_of_day", "value": 3.0, "shap_value": 0.8}],
        },
        "model_version": "v20260922_120000",
        "processing_time_ms": 12.0,
    }
    assert health["total_predictions"] == 1
    assert health["errors_total"] == 0


def test_explains_a_normal_event_because_the_request_is_explicit() -> None:
    application = create_app(
        Settings(environment=Environment.TEST, require_model_on_startup=True),
        model_loader=SuccessfulLoader(score=0.5),
        explanation_provider_factory=explanation_factory,
    )

    with TestClient(application) as client:
        response = client.post("/api/v1/explain", json=request_body())

    assert response.status_code == 200
    assert response.json()["anomaly_score"] == 0.0
    assert response.json()["shap_explanation"] is not None


def test_returns_503_before_a_model_is_ready(tmp_path: Path) -> None:
    application = create_app(Settings(environment=Environment.TEST, models_dir=tmp_path))

    with TestClient(application) as client:
        response = client.post("/api/v1/explain", json=request_body())

    assert response.status_code == 503
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {"detail": "Explanation model is not ready."}


def test_rejects_an_invalid_request_before_inference() -> None:
    application = create_app(
        Settings(environment=Environment.TEST, require_model_on_startup=True),
        model_loader=SuccessfulLoader(),
        explanation_provider_factory=explanation_factory,
    )
    body = request_body()
    body["event_id"] = "   "

    with TestClient(application) as client:
        response = client.post("/api/v1/explain", json=body)

    assert response.status_code == 422


def test_returns_a_generic_500_when_shap_fails() -> None:
    application = create_app(
        Settings(environment=Environment.TEST, require_model_on_startup=True),
        model_loader=SuccessfulLoader(),
        explanation_provider_factory=failing_explanation_factory,
    )

    with TestClient(application) as client:
        response = client.post("/api/v1/explain", json=request_body())
        health = client.get("/api/v1/health").json()

    assert response.status_code == 500
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {"detail": "Event explanation failed."}
    assert "private SHAP failure" not in response.text
    assert health["total_predictions"] == 1
    assert health["errors_total"] == 1

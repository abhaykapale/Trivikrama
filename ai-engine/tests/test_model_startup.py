from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from numpy.typing import ArrayLike, NDArray

from app.config import Environment, Settings
from app.core.explainer import ShapExplanation
from app.core.feature_contract import AI_FEATURE_NAMES, DEFAULT_FEATURE_VALUES
from app.core.model_loader import (
    LoadedModelArtifacts,
    ModelArtifactError,
)
from app.main import create_app


class DummyModel:
    n_features_in_ = 20

    def decision_function(self, values: Any) -> Any:
        return values


class DummyScaler:
    n_features_in_ = 20

    def transform(self, values: NDArray[np.float64]) -> ArrayLike:
        return values


class SuccessfulLoader:
    config_path = Path("not-used-by-required-startup")

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
            training_metadata={},
        )


class FailingLoader:
    config_path = Path("not-used-by-required-startup")

    def load(self, version: str | None = None) -> LoadedModelArtifacts:
        raise ModelArtifactError("test model failure")


class NullExplanationProvider:
    def explain(
        self,
        scaled_values: NDArray[np.float64],
        display_values: NDArray[np.float64],
    ) -> ShapExplanation:
        raise AssertionError("health checks must not generate explanations")


def null_explanation_provider_factory(
    model: Any,
    feature_names: object,
) -> NullExplanationProvider:
    return NullExplanationProvider()


def test_startup_publishes_only_a_complete_bundle() -> None:
    application = create_app(
        Settings(
            environment=Environment.TEST,
            require_model_on_startup=True,
        ),
        model_loader=SuccessfulLoader(),
        explanation_provider_factory=null_explanation_provider_factory,
    )

    with TestClient(application) as client:
        response = client.get("/api/v1/health")
        assert response.json()["status"] == "healthy"
        assert response.json()["model_version"] == "v20260920_120000"
        assert application.state.model_artifacts.version == "v20260920_120000"

    assert application.state.model_artifacts is None


def test_required_model_failure_aborts_startup() -> None:
    application = create_app(
        Settings(
            environment=Environment.PRODUCTION,
            require_model_on_startup=True,
        ),
        model_loader=FailingLoader(),
    )

    with pytest.raises(ModelArtifactError, match="test model failure"), TestClient(application):
        pass

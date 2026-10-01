"""SHAP adapter that produces validated, anomaly-directed explanations."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from math import isfinite
from threading import Lock
from typing import Any, Protocol, cast

import numpy as np
from numpy.typing import ArrayLike, NDArray

from app.core.model_loader import AnomalyModel


class ShapExplanationError(RuntimeError):
    """Raised when an explanation cannot be generated safely."""


@dataclass(frozen=True, slots=True)
class ShapFeatureContribution:
    name: str
    value: float
    shap_value: float


@dataclass(frozen=True, slots=True)
class ShapExplanation:
    base_value: float
    features: tuple[ShapFeatureContribution, ...]


class TreeShapBackend(Protocol):
    expected_value: object

    def shap_values(
        self,
        values: NDArray[np.float64],
        *,
        check_additivity: bool = True,
    ) -> ArrayLike: ...


class FeatureExplanationProvider(Protocol):
    def explain(
        self,
        scaled_values: NDArray[np.float64],
        display_values: NDArray[np.float64],
    ) -> ShapExplanation: ...


class ExplanationProviderFactory(Protocol):
    def __call__(
        self,
        model: AnomalyModel,
        feature_names: Sequence[str],
    ) -> FeatureExplanationProvider: ...


class TreeShapExplanationProvider:
    """Validate Tree SHAP output and align its direction with anomaly scores.

    SHAP explains Isolation Forest path length. A positive raw contribution
    increases path length and therefore points toward normality. Negating raw
    contributions makes positive API values consistently mean "more anomalous".
    """

    def __init__(
        self,
        backend: TreeShapBackend,
        feature_names: Sequence[str],
    ) -> None:
        names = tuple(feature_names)
        if not names or len(set(names)) != len(names):
            raise ShapExplanationError("feature names must be non-empty and unique")
        self._backend = backend
        self._feature_names = names
        self._lock = Lock()

    def explain(
        self,
        scaled_values: NDArray[np.float64],
        display_values: NDArray[np.float64],
    ) -> ShapExplanation:
        expected_shape = (1, len(self._feature_names))
        if scaled_values.shape != expected_shape or display_values.shape != expected_shape:
            raise ShapExplanationError(f"explanation inputs must both have shape {expected_shape}")
        if not np.isfinite(scaled_values).all() or not np.isfinite(display_values).all():
            raise ShapExplanationError("explanation inputs must be finite")

        try:
            with self._lock:
                raw_values = self._backend.shap_values(
                    scaled_values,
                    check_additivity=True,
                )
                expected_value = self._backend.expected_value
            shap_values = np.asarray(raw_values, dtype=np.float64)
            base_values = np.asarray(expected_value, dtype=np.float64).reshape(-1)
        except Exception as error:
            raise ShapExplanationError("Tree SHAP evaluation failed") from error

        if shap_values.shape != expected_shape:
            raise ShapExplanationError(
                f"SHAP returned shape {shap_values.shape}; expected {expected_shape}"
            )
        if base_values.shape != (1,):
            raise ShapExplanationError("SHAP expected value must be scalar")
        if not np.isfinite(shap_values).all() or not np.isfinite(base_values).all():
            raise ShapExplanationError("SHAP returned NaN or infinite values")

        # Reverse path-length direction: positive now means toward anomaly.
        anomaly_contributions = -shap_values[0]
        ordered_indices = sorted(
            range(len(self._feature_names)),
            key=lambda index: (-abs(float(anomaly_contributions[index])), index),
        )
        features = tuple(
            ShapFeatureContribution(
                name=self._feature_names[index],
                value=round(float(display_values[0, index]), 6),
                shap_value=round(float(anomaly_contributions[index]), 6),
            )
            for index in ordered_indices
        )
        base_value = -float(base_values[0])
        if not isfinite(base_value):
            raise ShapExplanationError("SHAP base value must be finite")
        return ShapExplanation(base_value=round(base_value, 6), features=features)


def build_tree_shap_explanation_provider(
    model: AnomalyModel,
    feature_names: Sequence[str],
) -> FeatureExplanationProvider:
    """Build the concrete SHAP dependency at the application composition edge."""

    try:
        import shap

        backend = shap.TreeExplainer(
            cast(Any, model),
            feature_perturbation="tree_path_dependent",
            model_output="raw",
        )
    except Exception as error:
        raise ShapExplanationError("Tree SHAP could not initialize") from error
    return TreeShapExplanationProvider(cast(TreeShapBackend, backend), feature_names)

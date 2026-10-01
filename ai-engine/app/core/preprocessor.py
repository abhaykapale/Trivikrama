"""Convert backend feature dictionaries into model-ready numeric matrices."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from math import isfinite
from typing import Protocol

import numpy as np
from numpy.typing import ArrayLike, NDArray

from app.core.feature_contract import (
    AI_FEATURE_NAMES,
    DEFAULT_FEATURE_VALUES,
    FEATURE_BOUNDS,
)


class FeaturePreprocessingError(ValueError):
    """Raised when a feature contract or scaler produces unsafe data."""


class FeatureScaler(Protocol):
    """The small part of sklearn's StandardScaler used by this service."""

    def transform(self, values: NDArray[np.float64]) -> ArrayLike: ...


@dataclass(frozen=True, slots=True)
class PreprocessedBatch:
    """Human-readable cleaned values and their model-scaled representation."""

    unscaled: NDArray[np.float64]
    scaled: NDArray[np.float64]


class FeaturePreprocessor:
    """Select, clean, order, and scale the v1 model features."""

    def __init__(
        self,
        scaler: FeatureScaler,
        *,
        feature_names: Sequence[str] = AI_FEATURE_NAMES,
        feature_defaults: Mapping[str, float] = DEFAULT_FEATURE_VALUES,
    ) -> None:
        names = tuple(feature_names)
        if names != AI_FEATURE_NAMES:
            raise FeaturePreprocessingError(
                "feature_names must exactly match the ordered v1 feature contract"
            )

        missing_defaults = set(names).difference(feature_defaults)
        if missing_defaults:
            missing = ", ".join(sorted(missing_defaults))
            raise FeaturePreprocessingError(f"missing defaults for: {missing}")

        defaults: dict[str, float] = {}
        for name in names:
            value = _numeric_value(feature_defaults[name], name)
            if not isfinite(value):
                raise FeaturePreprocessingError(f"default for {name} must be finite")
            defaults[name] = _apply_bounds(name, value)

        self._scaler = scaler
        self._feature_names = names
        self._feature_defaults = defaults

    @property
    def feature_names(self) -> tuple[str, ...]:
        return self._feature_names

    def preprocess(
        self,
        raw_features: Sequence[Mapping[str, object]],
    ) -> NDArray[np.float64]:
        return self.prepare(raw_features).scaled

    def prepare(
        self,
        raw_features: Sequence[Mapping[str, object]],
    ) -> PreprocessedBatch:
        if not raw_features:
            raise FeaturePreprocessingError("at least one feature object is required")

        unscaled = np.asarray(
            [self._clean_one(features) for features in raw_features],
            dtype=np.float64,
        )
        expected_shape = (len(raw_features), len(self._feature_names))
        if unscaled.shape != expected_shape:
            raise FeaturePreprocessingError("preprocessing produced an invalid matrix shape")

        scaled = np.asarray(self._scaler.transform(unscaled), dtype=np.float64)
        if scaled.shape != expected_shape:
            raise FeaturePreprocessingError(
                f"scaler returned shape {scaled.shape}; expected {expected_shape}"
            )
        if not np.isfinite(scaled).all():
            raise FeaturePreprocessingError("scaler returned NaN or infinite values")
        return PreprocessedBatch(
            unscaled=unscaled,
            scaled=scaled,
        )

    def preprocess_single(
        self,
        raw_features: Mapping[str, object],
    ) -> NDArray[np.float64]:
        return self.preprocess([raw_features])

    def _clean_one(self, raw_features: Mapping[str, object]) -> list[float]:
        cleaned: list[float] = []
        for name in self._feature_names:
            raw_value = raw_features.get(name)
            if raw_value is None:
                value = self._feature_defaults[name]
            else:
                value = _numeric_value(raw_value, name)
                if not isfinite(value):
                    value = self._feature_defaults[name]
            cleaned.append(_apply_bounds(name, value))
        return cleaned


def _numeric_value(value: object, feature_name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise FeaturePreprocessingError(f"{feature_name} must be numeric or null")
    return float(value)


def _apply_bounds(feature_name: str, value: float) -> float:
    lower, upper = FEATURE_BOUNDS[feature_name]
    if lower is not None:
        value = max(lower, value)
    if upper is not None:
        value = min(upper, value)
    return value

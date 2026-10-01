"""Observability decorator for feature explanation providers."""

from __future__ import annotations

from collections.abc import Callable
from time import monotonic

import numpy as np
from numpy.typing import NDArray

from app.core.explainer import FeatureExplanationProvider, ShapExplanation
from app.runtime import RuntimeState


class MeasuredExplanationProvider:
    """Record successful SHAP execution without changing explanation behavior."""

    def __init__(
        self,
        provider: FeatureExplanationProvider,
        runtime: RuntimeState,
        *,
        clock: Callable[[], float] = monotonic,
    ) -> None:
        self._provider = provider
        self._runtime = runtime
        self._clock = clock

    def explain(
        self,
        scaled_values: NDArray[np.float64],
        display_values: NDArray[np.float64],
    ) -> ShapExplanation:
        started_at = self._clock()
        explanation = self._provider.explain(scaled_values, display_values)
        latency_ms = max(0.0, (self._clock() - started_at) * 1_000.0)
        self._runtime.record_explanation(latency_ms)
        return explanation

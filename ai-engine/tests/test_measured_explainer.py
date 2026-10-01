from __future__ import annotations

import numpy as np
import pytest
from numpy.typing import NDArray

from app.core.explainer import ShapExplanation
from app.core.measured_explainer import MeasuredExplanationProvider
from app.runtime import RuntimeState


class StepClock:
    def __init__(self, values: list[float]) -> None:
        self._values = iter(values)

    def __call__(self) -> float:
        return next(self._values)


class SuccessfulProvider:
    def explain(
        self,
        scaled_values: NDArray[np.float64],
        display_values: NDArray[np.float64],
    ) -> ShapExplanation:
        return ShapExplanation(base_value=0.0, features=())


def test_records_successful_explanation_latency() -> None:
    runtime = RuntimeState()
    provider = MeasuredExplanationProvider(
        SuccessfulProvider(), runtime, clock=StepClock([1.0, 1.008])
    )
    values = np.zeros((1, 20), dtype=np.float64)

    provider.explain(values, values)

    snapshot = runtime.snapshot()
    assert snapshot.total_explanations == 1
    assert snapshot.avg_explanation_ms == pytest.approx(8.0, abs=1e-9)

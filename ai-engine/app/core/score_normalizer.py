"""Convert Isolation Forest raw scores into stable anomaly scores."""

from __future__ import annotations

from math import exp, isfinite

import numpy as np
from numpy.typing import ArrayLike, NDArray


class ScoreNormalizationError(ValueError):
    """Raised when score normalization inputs are invalid."""


class ScoreNormalizer:
    """Map a training-observed raw-score range onto anomaly scores in [0, 1].

    Isolation Forest returns larger values for normal observations. This
    normalizer clips to the training range, performs min-max normalization,
    and inverts the result so larger output values mean more anomalous.
    """

    def __init__(self, *, raw_score_min: float, raw_score_max: float) -> None:
        if not isfinite(raw_score_min) or not isfinite(raw_score_max):
            raise ScoreNormalizationError("raw score bounds must be finite")
        if raw_score_max <= raw_score_min:
            raise ScoreNormalizationError("raw_score_max must be greater than raw_score_min")
        self._raw_score_min = float(raw_score_min)
        self._raw_score_max = float(raw_score_max)

    def normalize(self, raw_scores: ArrayLike) -> NDArray[np.float64]:
        try:
            scores = np.asarray(raw_scores, dtype=np.float64)
        except (TypeError, ValueError) as error:
            raise ScoreNormalizationError("raw scores must be numeric") from error
        if scores.ndim != 1:
            raise ScoreNormalizationError("raw scores must be a one-dimensional array")
        if scores.size == 0:
            raise ScoreNormalizationError("at least one raw score is required")
        if not np.isfinite(scores).all():
            raise ScoreNormalizationError("raw scores must be finite")

        clipped = np.clip(scores, self._raw_score_min, self._raw_score_max)
        scaled = (clipped - self._raw_score_min) / (self._raw_score_max - self._raw_score_min)
        anomaly_scores = np.clip(1.0 - scaled, 0.0, 1.0)
        return anomaly_scores


def anomaly_confidence(
    anomaly_score: float,
    threshold: float,
    *,
    steepness: float = 10.0,
) -> float:
    """Return confidence based on distance from the classification boundary."""

    for name, value in (("anomaly_score", anomaly_score), ("threshold", threshold)):
        if not isfinite(value) or not 0.0 <= value <= 1.0:
            raise ScoreNormalizationError(f"{name} must be finite and between 0 and 1")
    if not isfinite(steepness) or steepness <= 0.0:
        raise ScoreNormalizationError("steepness must be finite and positive")

    distance = abs(anomaly_score - threshold)
    return round(1.0 / (1.0 + exp(-steepness * distance)), 4)

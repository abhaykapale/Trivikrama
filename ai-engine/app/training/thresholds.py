"""Threshold selection for unlabeled anomaly-score holdout data."""

from __future__ import annotations

from math import isfinite

import numpy as np
from numpy.typing import ArrayLike


class ThresholdSelectionError(ValueError):
    """Raised when a threshold cannot be selected safely."""


def select_percentile_threshold(
    anomaly_scores: ArrayLike,
    *,
    percentile: float = 95.0,
) -> float:
    """Return a reproducible percentile threshold rounded to four decimals."""

    if not isfinite(percentile) or not 0.0 < percentile < 100.0:
        raise ThresholdSelectionError("percentile must be finite and between 0 and 100")
    try:
        scores = np.asarray(anomaly_scores, dtype=np.float64)
    except (TypeError, ValueError) as error:
        raise ThresholdSelectionError("anomaly scores must be numeric") from error
    if scores.ndim != 1 or scores.size == 0:
        raise ThresholdSelectionError("anomaly scores must be a non-empty one-dimensional array")
    if not np.isfinite(scores).all():
        raise ThresholdSelectionError("anomaly scores must be finite")
    if np.any((scores < 0.0) | (scores > 1.0)):
        raise ThresholdSelectionError("anomaly scores must be between 0 and 1")
    return float(round(float(np.percentile(scores, percentile)), 4))

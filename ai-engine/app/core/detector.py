"""Isolation Forest inference orchestration independent of HTTP transport."""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from math import isfinite

import numpy as np
from numpy.typing import NDArray

from app.core.explainer import (
    FeatureExplanationProvider,
    ShapExplanation,
    ShapExplanationError,
)
from app.core.model_loader import LoadedModelArtifacts
from app.core.preprocessor import FeaturePreprocessor, PreprocessedBatch
from app.core.score_normalizer import ScoreNormalizer, anomaly_confidence

logger = logging.getLogger(__name__)


class DetectionError(ValueError):
    """Raised when a detection batch or model result is invalid."""


@dataclass(frozen=True, slots=True)
class DetectionEvent:
    event_id: str
    features: Mapping[str, object]


@dataclass(frozen=True, slots=True)
class DetectionPrediction:
    event_id: str
    anomaly_score: float
    is_anomaly: bool
    confidence: float
    shap_explanation: ShapExplanation | None = None


@dataclass(frozen=True, slots=True)
class DetectionBatchResult:
    model_version: str
    predictions: tuple[DetectionPrediction, ...]
    events_processed: int
    anomalies_detected: int


@dataclass(frozen=True, slots=True)
class EventExplanationResult:
    event_id: str
    anomaly_score: float
    model_version: str
    shap_explanation: ShapExplanation


class IsolationForestDetector:
    """Preprocess, score, normalize, and classify a bounded event batch."""

    def __init__(
        self,
        artifacts: LoadedModelArtifacts,
        *,
        max_batch_size: int = 100,
        explanation_provider: FeatureExplanationProvider | None = None,
    ) -> None:
        if max_batch_size < 1:
            raise ValueError("max_batch_size must be positive")
        self._model = artifacts.model
        self._model_version = artifacts.version
        self._default_threshold = artifacts.threshold
        self._max_batch_size = max_batch_size
        self._explanation_provider = explanation_provider
        self._preprocessor = FeaturePreprocessor(
            artifacts.scaler,
            feature_names=artifacts.feature_names,
            feature_defaults=artifacts.feature_defaults,
        )
        self._normalizer = ScoreNormalizer(
            raw_score_min=artifacts.raw_score_min,
            raw_score_max=artifacts.raw_score_max,
        )

    def detect(
        self,
        events: Sequence[DetectionEvent],
        *,
        threshold: float | None = None,
        include_shap: bool = False,
    ) -> DetectionBatchResult:
        self._validate_events(events)
        selected_threshold = self._validate_threshold(
            self._default_threshold if threshold is None else threshold
        )

        prepared, anomaly_scores = self._prepare_and_score(events)
        predictions: list[DetectionPrediction] = []
        for index, (event, score) in enumerate(zip(events, anomaly_scores, strict=True)):
            numeric_score = float(score)
            is_anomaly = numeric_score >= selected_threshold
            explanation: ShapExplanation | None = None
            if is_anomaly and include_shap and self._explanation_provider is not None:
                try:
                    explanation = self._explanation_provider.explain(
                        prepared.scaled[index : index + 1],
                        prepared.unscaled[index : index + 1],
                    )
                except ShapExplanationError:
                    logger.exception(
                        "SHAP explanation failed for event %s",
                        event.event_id,
                    )
            predictions.append(
                DetectionPrediction(
                    event_id=event.event_id,
                    anomaly_score=round(numeric_score, 6),
                    is_anomaly=is_anomaly,
                    confidence=anomaly_confidence(numeric_score, selected_threshold),
                    shap_explanation=explanation,
                )
            )
        prediction_tuple = tuple(predictions)
        return DetectionBatchResult(
            model_version=self._model_version,
            predictions=prediction_tuple,
            events_processed=len(prediction_tuple),
            anomalies_detected=sum(prediction.is_anomaly for prediction in prediction_tuple),
        )

    def explain(self, event: DetectionEvent) -> EventExplanationResult:
        """Score and explain one event, regardless of its anomaly threshold.

        The standalone explanation endpoint is an explicit analyst request, so
        it explains normal and anomalous events alike. Unlike optional inline
        explanations, failure is surfaced to the caller instead of being
        converted into a missing explanation.
        """

        self._validate_events([event])
        if self._explanation_provider is None:
            raise DetectionError("explanation provider is not available")

        prepared, anomaly_scores = self._prepare_and_score([event])
        explanation = self._explanation_provider.explain(
            prepared.scaled,
            prepared.unscaled,
        )
        return EventExplanationResult(
            event_id=event.event_id,
            anomaly_score=round(float(anomaly_scores[0]), 6),
            model_version=self._model_version,
            shap_explanation=explanation,
        )

    def _prepare_and_score(
        self,
        events: Sequence[DetectionEvent],
    ) -> tuple[PreprocessedBatch, NDArray[np.float64]]:
        prepared = self._preprocessor.prepare([event.features for event in events])
        try:
            raw_scores = np.asarray(
                self._model.decision_function(prepared.scaled), dtype=np.float64
            )
        except (TypeError, ValueError) as error:
            raise DetectionError("model returned non-numeric scores") from error
        expected_shape = (len(events),)
        if raw_scores.shape != expected_shape:
            raise DetectionError(
                f"model returned score shape {raw_scores.shape}; expected {expected_shape}"
            )
        if not np.isfinite(raw_scores).all():
            raise DetectionError("model returned NaN or infinite scores")
        return prepared, self._normalizer.normalize(raw_scores)

    def _validate_events(self, events: Sequence[DetectionEvent]) -> None:
        if not events:
            raise DetectionError("at least one event is required")
        if len(events) > self._max_batch_size:
            raise DetectionError(f"batch exceeds the maximum of {self._max_batch_size} events")
        event_ids = [event.event_id for event in events]
        if any(not event_id.strip() for event_id in event_ids):
            raise DetectionError("event_id must not be blank")
        if len(set(event_ids)) != len(event_ids):
            raise DetectionError("event_id values must be unique within a batch")

    @staticmethod
    def _validate_threshold(threshold: float) -> float:
        if isinstance(threshold, bool) or not isinstance(threshold, (int, float)):
            raise DetectionError("threshold must be numeric")
        value = float(threshold)
        if not isfinite(value) or not 0.0 <= value <= 1.0:
            raise DetectionError("threshold must be finite and between 0 and 1")
        return value

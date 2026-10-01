from __future__ import annotations

import unittest
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

from app.core.detector import DetectionError, DetectionEvent, IsolationForestDetector
from app.core.explainer import (
    ShapExplanation,
    ShapExplanationError,
    ShapFeatureContribution,
)
from app.core.feature_contract import AI_FEATURE_NAMES, DEFAULT_FEATURE_VALUES
from app.core.model_loader import LoadedModelArtifacts


class IdentityScaler:
    n_features_in_ = len(AI_FEATURE_NAMES)

    def transform(self, values: NDArray[np.float64]) -> ArrayLike:
        return values


class FixedScoreModel:
    n_features_in_ = len(AI_FEATURE_NAMES)

    def __init__(self, scores: ArrayLike) -> None:
        self.scores = scores

    def decision_function(self, values: Any) -> Any:
        return self.scores


class RecordingExplanationProvider:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.calls = 0

    def explain(
        self,
        scaled_values: NDArray[np.float64],
        display_values: NDArray[np.float64],
    ) -> ShapExplanation:
        self.calls += 1
        if self.fail:
            raise ShapExplanationError("test failure")
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


def artifacts(scores: ArrayLike) -> LoadedModelArtifacts:
    return LoadedModelArtifacts(
        version="v20260920_120000",
        model=FixedScoreModel(scores),
        scaler=IdentityScaler(),
        threshold=0.65,
        raw_score_min=-0.5,
        raw_score_max=0.5,
        feature_names=AI_FEATURE_NAMES,
        feature_defaults=dict(DEFAULT_FEATURE_VALUES),
        training_metadata={},
    )


class IsolationForestDetectorTests(unittest.TestCase):
    def test_scores_classifies_and_preserves_event_order(self) -> None:
        detector = IsolationForestDetector(artifacts([-0.5, 0.0, 0.5]))
        events = [
            DetectionEvent(event_id=event_id, features={"failed_login_count": index})
            for index, event_id in enumerate(("event-c", "event-a", "event-b"))
        ]

        result = detector.detect(events)

        self.assertEqual(result.model_version, "v20260920_120000")
        self.assertEqual(result.events_processed, 3)
        self.assertEqual(result.anomalies_detected, 1)
        self.assertEqual(
            [prediction.event_id for prediction in result.predictions],
            ["event-c", "event-a", "event-b"],
        )
        self.assertEqual(
            [prediction.anomaly_score for prediction in result.predictions],
            [1.0, 0.5, 0.0],
        )
        self.assertEqual(
            [prediction.is_anomaly for prediction in result.predictions],
            [True, False, False],
        )

    def test_allows_a_valid_threshold_override(self) -> None:
        detector = IsolationForestDetector(artifacts([0.0]))

        result = detector.detect([DetectionEvent(event_id="event-1", features={})], threshold=0.5)

        self.assertTrue(result.predictions[0].is_anomaly)
        self.assertEqual(result.predictions[0].confidence, 0.5)

    def test_explains_only_anomalies_when_requested(self) -> None:
        provider = RecordingExplanationProvider()
        detector = IsolationForestDetector(
            artifacts([-0.5, 0.5]),
            explanation_provider=provider,
        )
        events = [
            DetectionEvent(event_id="anomaly", features={"hour_of_day": 3}),
            DetectionEvent(event_id="normal", features={"hour_of_day": 12}),
        ]

        detector.detect(events, threshold=0.5, include_shap=False)

        self.assertEqual(provider.calls, 0)

        result = detector.detect(
            events,
            threshold=0.5,
            include_shap=True,
        )

        self.assertEqual(provider.calls, 1)
        self.assertIsNotNone(result.predictions[0].shap_explanation)
        self.assertIsNone(result.predictions[1].shap_explanation)

    def test_shap_failure_does_not_discard_a_valid_prediction(self) -> None:
        provider = RecordingExplanationProvider(fail=True)
        detector = IsolationForestDetector(
            artifacts([-0.5]),
            explanation_provider=provider,
        )

        result = detector.detect(
            [DetectionEvent(event_id="anomaly", features={})],
            include_shap=True,
        )

        self.assertTrue(result.predictions[0].is_anomaly)
        self.assertIsNone(result.predictions[0].shap_explanation)

    def test_explains_one_event_even_when_its_score_is_normal(self) -> None:
        provider = RecordingExplanationProvider()
        detector = IsolationForestDetector(
            artifacts([0.5]),
            explanation_provider=provider,
        )

        result = detector.explain(
            DetectionEvent(event_id="normal-event", features={"hour_of_day": 12})
        )

        self.assertEqual(result.event_id, "normal-event")
        self.assertEqual(result.anomaly_score, 0.0)
        self.assertEqual(result.model_version, "v20260920_120000")
        self.assertEqual(result.shap_explanation.base_value, -4.0)
        self.assertEqual(provider.calls, 1)

    def test_standalone_explanation_requires_an_explanation_provider(self) -> None:
        detector = IsolationForestDetector(artifacts([0.0]))

        with self.assertRaisesRegex(DetectionError, "provider"):
            detector.explain(DetectionEvent(event_id="event-1", features={}))

    def test_rejects_ambiguous_or_oversized_batches(self) -> None:
        detector = IsolationForestDetector(artifacts([0.0]), max_batch_size=1)
        with self.assertRaisesRegex(DetectionError, "unique"):
            IsolationForestDetector(artifacts([0.0, 0.0])).detect(
                [
                    DetectionEvent(event_id="same", features={}),
                    DetectionEvent(event_id="same", features={}),
                ]
            )
        with self.assertRaisesRegex(DetectionError, "maximum"):
            detector.detect(
                [
                    DetectionEvent(event_id="one", features={}),
                    DetectionEvent(event_id="two", features={}),
                ]
            )

    def test_rejects_invalid_model_outputs_and_thresholds(self) -> None:
        event = DetectionEvent(event_id="event-1", features={})
        with self.assertRaisesRegex(DetectionError, "shape"):
            IsolationForestDetector(artifacts([[0.0]])).detect([event])
        with self.assertRaisesRegex(DetectionError, "infinite"):
            IsolationForestDetector(artifacts([float("nan")])).detect([event])
        with self.assertRaisesRegex(DetectionError, "between 0 and 1"):
            IsolationForestDetector(artifacts([0.0])).detect([event], threshold=1.1)

    def test_runs_a_real_scaled_isolation_forest_pipeline(self) -> None:
        random = np.random.default_rng(42)
        training = random.normal(size=(128, len(AI_FEATURE_NAMES)))
        scaler = StandardScaler().fit(training)
        model = IsolationForest(n_estimators=20, random_state=42).fit(scaler.transform(training))
        training_scores = model.decision_function(scaler.transform(training))
        real_artifacts = LoadedModelArtifacts(
            version="v20260920_120001",
            model=model,
            scaler=scaler,
            threshold=0.65,
            raw_score_min=float(training_scores.min()),
            raw_score_max=float(training_scores.max()),
            feature_names=AI_FEATURE_NAMES,
            feature_defaults=dict(DEFAULT_FEATURE_VALUES),
            training_metadata={},
        )

        result = IsolationForestDetector(real_artifacts).detect(
            [
                DetectionEvent(
                    event_id="real-event",
                    features={
                        "failed_login_count": 2,
                        "bytes_transferred": 4096,
                    },
                )
            ]
        )

        self.assertEqual(result.events_processed, 1)
        self.assertGreaterEqual(result.predictions[0].anomaly_score, 0.0)
        self.assertLessEqual(result.predictions[0].anomaly_score, 1.0)


if __name__ == "__main__":
    unittest.main()

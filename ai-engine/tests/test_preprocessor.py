from __future__ import annotations

import unittest
from collections.abc import Mapping

import numpy as np
from numpy.typing import NDArray

from app.core.feature_contract import AI_FEATURE_NAMES, DEFAULT_FEATURE_VALUES
from app.core.preprocessor import FeaturePreprocessingError, FeaturePreprocessor


class RecordingScaler:
    def __init__(self) -> None:
        self.received: NDArray[np.float64] | None = None

    def transform(self, values: NDArray[np.float64]) -> NDArray[np.float64]:
        self.received = values.copy()
        return values * 2.0


class WrongShapeScaler:
    def transform(self, values: NDArray[np.float64]) -> NDArray[np.float64]:
        return values[:, :-1]


class NonFiniteScaler:
    def transform(self, values: NDArray[np.float64]) -> NDArray[np.float64]:
        result = values.copy()
        result[0, 0] = np.nan
        return result


def minimum_features(**overrides: object) -> Mapping[str, object]:
    values: dict[str, object] = {
        "hour_of_day": 3,
        "day_of_week": 5,
        "is_business_hours": 0,
        "severity_id": 4,
    }
    values.update(overrides)
    return values


class FeaturePreprocessorTests(unittest.TestCase):
    def test_prepare_keeps_clean_values_beside_scaled_values(self) -> None:
        scaler = RecordingScaler()
        preprocessor = FeaturePreprocessor(scaler)

        prepared = preprocessor.prepare([minimum_features(bytes_sent=100)])

        self.assertEqual(prepared.unscaled.shape, (1, 20))
        self.assertEqual(prepared.scaled.shape, (1, 20))
        self.assertEqual(
            prepared.unscaled[0, AI_FEATURE_NAMES.index("bytes_sent")],
            100.0,
        )
        np.testing.assert_allclose(prepared.scaled, prepared.unscaled * 2.0)

    def test_selects_defaults_orders_and_scales_features(self) -> None:
        scaler = RecordingScaler()
        defaults = dict(DEFAULT_FEATURE_VALUES)
        defaults["time_since_last_event"] = 45.0
        preprocessor = FeaturePreprocessor(scaler, feature_defaults=defaults)

        result = preprocessor.preprocess_single(
            minimum_features(
                bytes_sent=100,
                process_rarity_score=0.99,
                network_context=999,
            )
        )

        self.assertEqual(result.shape, (1, 20))
        self.assertIsNotNone(scaler.received)
        assert scaler.received is not None
        row = scaler.received[0]
        self.assertEqual(row[AI_FEATURE_NAMES.index("hour_of_day")], 3.0)
        self.assertEqual(row[AI_FEATURE_NAMES.index("time_since_last_event")], 45.0)
        self.assertEqual(row[AI_FEATURE_NAMES.index("bytes_sent")], 100.0)
        np.testing.assert_allclose(result, scaler.received * 2.0)

    def test_replaces_nonfinite_values_and_clips_contract_ranges(self) -> None:
        scaler = RecordingScaler()
        preprocessor = FeaturePreprocessor(scaler)

        preprocessor.preprocess_single(
            minimum_features(
                hour_of_day=99,
                day_of_week=-2,
                severity_id=50,
                src_ip_entropy=12,
                failed_to_success_ratio=-1,
                bytes_sent=-100,
                bytes_received=float("inf"),
                frequency_deviation=float("nan"),
            )
        )

        assert scaler.received is not None
        row = scaler.received[0]
        self.assertEqual(row[AI_FEATURE_NAMES.index("hour_of_day")], 23.0)
        self.assertEqual(row[AI_FEATURE_NAMES.index("day_of_week")], 0.0)
        self.assertEqual(row[AI_FEATURE_NAMES.index("severity_id")], 6.0)
        self.assertEqual(row[AI_FEATURE_NAMES.index("src_ip_entropy")], 8.0)
        self.assertEqual(row[AI_FEATURE_NAMES.index("failed_to_success_ratio")], 0.0)
        self.assertEqual(row[AI_FEATURE_NAMES.index("bytes_sent")], 0.0)
        self.assertEqual(row[AI_FEATURE_NAMES.index("bytes_received")], 0.0)
        self.assertEqual(row[AI_FEATURE_NAMES.index("frequency_deviation")], 0.0)

    def test_rejects_invalid_values_contracts_and_scaler_output(self) -> None:
        preprocessor = FeaturePreprocessor(RecordingScaler())
        with self.assertRaisesRegex(FeaturePreprocessingError, "numeric"):
            preprocessor.preprocess_single(minimum_features(bytes_sent="100"))
        with self.assertRaisesRegex(FeaturePreprocessingError, "at least one"):
            preprocessor.preprocess([])
        with self.assertRaisesRegex(FeaturePreprocessingError, "ordered v1"):
            FeaturePreprocessor(RecordingScaler(), feature_names=AI_FEATURE_NAMES[:-1])
        with self.assertRaisesRegex(FeaturePreprocessingError, "missing defaults"):
            FeaturePreprocessor(
                RecordingScaler(),
                feature_defaults={"hour_of_day": 1.0},
            )
        with self.assertRaisesRegex(FeaturePreprocessingError, "shape"):
            FeaturePreprocessor(WrongShapeScaler()).preprocess_single(minimum_features())
        with self.assertRaisesRegex(FeaturePreprocessingError, "NaN"):
            FeaturePreprocessor(NonFiniteScaler()).preprocess_single(minimum_features())


if __name__ == "__main__":
    unittest.main()

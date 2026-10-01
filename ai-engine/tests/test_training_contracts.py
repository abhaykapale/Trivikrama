from __future__ import annotations

import unittest
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError

from app.core.feature_contract import AI_FEATURE_NAMES, DEFAULT_FEATURE_VALUES
from app.training.contracts import TrainingDatasetManifest, TrainingEventRecord


def valid_features(**overrides: object) -> dict[str, Any]:
    """Build valid or deliberately malformed inputs for boundary validation."""
    values: dict[str, Any] = dict(DEFAULT_FEATURE_VALUES)
    values.update(overrides)
    return values


class TrainingDatasetContractTests(unittest.TestCase):
    def test_accepts_and_orders_the_exact_v1_feature_vector(self) -> None:
        record = TrainingEventRecord(
            event_id="evt-1",
            org_id="org-1",
            time=datetime(2026, 9, 1, tzinfo=UTC),
            class_uid=3002,
            features=valid_features(bytes_sent=125),
        )

        self.assertEqual(tuple(record.features), AI_FEATURE_NAMES)
        self.assertEqual(record.features["bytes_sent"], 125.0)

    def test_rejects_missing_unknown_non_numeric_and_out_of_range_features(self) -> None:
        cases = {
            "missing": {
                key: value for key, value in valid_features().items() if key != "bytes_sent"
            },
            "unknown": valid_features(extra_feature=1),
            "string": valid_features(bytes_sent="100"),
            "boolean": valid_features(bytes_sent=True),
            "nonfinite": valid_features(bytes_sent=float("inf")),
            "range": valid_features(hour_of_day=24),
        }
        for name, features in cases.items():
            with self.subTest(name=name), self.assertRaises(ValidationError):
                TrainingEventRecord(
                    event_id="evt-1",
                    org_id="org-1",
                    time=datetime(2026, 9, 1, tzinfo=UTC),
                    class_uid=3002,
                    features=features,
                )

    def test_rejects_naive_timestamps_and_manifest_contract_drift(self) -> None:
        with self.assertRaises(ValidationError):
            TrainingEventRecord(
                event_id="evt-1",
                org_id="org-1",
                time=datetime(2026, 9, 1),
                class_uid=3002,
                features=valid_features(),
            )

        with self.assertRaises(ValidationError):
            TrainingDatasetManifest(
                dataset_file="events.jsonl",
                org_id="org-1",
                from_time=datetime(2026, 9, 1, tzinfo=UTC),
                to_time=datetime(2026, 9, 2, tzinfo=UTC),
                exported_at=datetime(2026, 9, 2, tzinfo=UTC),
                row_count=1,
                feature_count=20,
                feature_names=list(reversed(AI_FEATURE_NAMES)),
                sha256="a" * 64,
            )


if __name__ == "__main__":
    unittest.main()

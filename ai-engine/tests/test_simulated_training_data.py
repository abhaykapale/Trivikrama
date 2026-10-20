from __future__ import annotations

import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

from app.training.loader import TrainingDatasetLoader
from app.training.synthetic import (
    SimulatedDatasetError,
    SimulatedDatasetRequest,
    generate_simulated_dataset,
    representative_anomalous_features,
    representative_normal_features,
)


class SimulatedTrainingDataTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary_directory.name)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_generates_reproducible_checksums_and_valid_contract_data(self) -> None:
        results = []
        for name in ("first", "second"):
            result = generate_simulated_dataset(
                SimulatedDatasetRequest(
                    output_path=self.directory / name / "events.jsonl",
                    row_count=100,
                    span_days=8.0,
                    anomaly_fraction=0.02,
                    random_seed=7,
                ),
                clock=lambda: datetime(2026, 10, 10, tzinfo=UTC),
            )
            results.append(result)

        self.assertEqual(results[0].manifest.sha256, results[1].manifest.sha256)
        self.assertEqual(results[0].manifest.dataset_origin, "simulated")
        self.assertEqual(results[0].simulated_anomaly_rows, 2)
        loaded = TrainingDatasetLoader().load(results[0].dataset_path)
        self.assertEqual(loaded.values.shape, (100, 20))
        self.assertEqual(loaded.quality_report.time_span_days, 8.0)

    def test_refuses_overwrite(self) -> None:
        request = SimulatedDatasetRequest(
            output_path=self.directory / "events.jsonl",
            row_count=10,
        )
        generate_simulated_dataset(request)

        with self.assertRaisesRegex(SimulatedDatasetError, "overwrite"):
            generate_simulated_dataset(request)

    def test_proof_feature_examples_are_distinct_complete_contracts(self) -> None:
        normal = representative_normal_features()
        anomalous = representative_anomalous_features()

        self.assertEqual(tuple(normal), tuple(anomalous))
        self.assertEqual(len(normal), 20)
        self.assertGreater(
            anomalous["events_per_minute_src_ip"],
            normal["events_per_minute_src_ip"],
        )
        self.assertEqual(anomalous["new_source_ip"], 1.0)


if __name__ == "__main__":
    unittest.main()

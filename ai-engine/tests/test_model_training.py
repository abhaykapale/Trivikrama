from __future__ import annotations

import json
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import numpy as np

from app.core.feature_contract import AI_FEATURE_NAMES
from app.core.model_loader import VersionedModelLoader
from app.training.contracts import (
    FeatureQualityStatistics,
    TrainingDatasetManifest,
    TrainingDatasetQualityReport,
)
from app.training.loader import LoadedTrainingDataset
from app.training.trainer import (
    ModelTrainingError,
    ModelTrainingRequest,
    train_and_publish_model,
)

VERSION = "v20261009_120000"


class StubLoader:
    def __init__(self, dataset: LoadedTrainingDataset) -> None:
        self.dataset = dataset

    def load(
        self,
        dataset_path: Path,
        manifest_path: Path | None = None,
    ) -> LoadedTrainingDataset:
        del dataset_path, manifest_path
        return self.dataset


class StubExplainer:
    def explain(self, scaled_values: object, display_values: object) -> object:
        del scaled_values, display_values
        return object()


def loaded_dataset(*, rows: int = 100, eligible: bool = False) -> LoadedTrainingDataset:
    random = np.random.default_rng(7)
    values = np.column_stack(
        [
            random.integers(0, 24, rows),
            random.integers(0, 7, rows),
            random.integers(0, 2, rows),
            random.exponential(30, rows),
            random.normal(0, 1, rows),
            random.poisson(3, rows),
            random.poisson(12, rows),
            random.integers(1, 8, rows),
            random.integers(1, 5, rows),
            random.normal(0, 1, rows),
            random.uniform(0, 8, rows),
            random.uniform(0, 8, rows),
            random.uniform(0, 8, rows),
            random.lognormal(5, 1, rows),
            random.lognormal(6, 1, rows),
            random.lognormal(0, 0.5, rows),
            random.integers(0, 7, rows),
            random.poisson(1, rows),
            random.uniform(0, 1, rows),
            random.integers(0, 2, rows),
        ]
    ).astype(np.float64)
    values.setflags(write=False)
    start = datetime(2026, 9, 1, tzinfo=UTC)
    span = timedelta(days=8 if eligible else 1)
    manifest = TrainingDatasetManifest(
        dataset_file="events.jsonl",
        org_id="org-1",
        from_time=start,
        to_time=start + span + timedelta(seconds=1),
        exported_at=start + timedelta(days=9),
        row_count=rows,
        feature_count=len(AI_FEATURE_NAMES),
        feature_names=list(AI_FEATURE_NAMES),
        sha256="a" * 64,
    )
    feature_statistics = {
        name: FeatureQualityStatistics(
            minimum=float(np.min(values[:, index])),
            maximum=float(np.max(values[:, index])),
            mean=float(np.mean(values[:, index])),
            standard_deviation=float(np.std(values[:, index])),
            p01=float(np.percentile(values[:, index], 1)),
            p50=float(np.percentile(values[:, index], 50)),
            p95=float(np.percentile(values[:, index], 95)),
            p99=float(np.percentile(values[:, index], 99)),
            default_rate=0.0,
        )
        for index, name in enumerate(AI_FEATURE_NAMES)
    }
    quality = TrainingDatasetQualityReport(
        dataset_sha256=manifest.sha256,
        org_id=manifest.org_id,
        row_count=rows,
        first_event_time=start,
        last_event_time=start + span,
        time_span_days=span.total_seconds() / 86_400,
        minimum_sample_requirement_met=eligible,
        minimum_time_span_requirement_met=eligible,
        warnings=[] if eligible else ["development fixture"],
        class_distribution={"3002": rows},
        feature_statistics=feature_statistics,
    )
    return LoadedTrainingDataset(values=values, manifest=manifest, quality_report=quality)


class ModelTrainingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary_directory.name)
        self.models_dir = self.directory / "models"

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    @patch(
        "app.training.trainer.build_tree_shap_explanation_provider",
        return_value=StubExplainer(),
    )
    def test_trains_reports_registers_and_runtime_loads_bundle(self, _: object) -> None:
        result = train_and_publish_model(
            ModelTrainingRequest(
                dataset_path=self.directory / "events.jsonl",
                models_dir=self.models_dir,
                version=VERSION,
                allow_insufficient_data=True,
            ),
            loader=StubLoader(loaded_dataset()),
            clock=lambda: datetime(2026, 10, 9, 12, tzinfo=UTC),
        )

        self.assertEqual(result.report.training_samples, 80)
        self.assertEqual(result.report.holdout_samples, 20)
        self.assertFalse(result.report.production_eligible)
        self.assertTrue(result.report.shap_validation_passed)
        self.assertEqual(result.report.hyperparameters["n_estimators"], 200)
        self.assertGreaterEqual(result.report.threshold, 0.0)
        self.assertLessEqual(result.report.threshold, 1.0)
        self.assertTrue((result.version_directory / "model.joblib").is_file())
        self.assertTrue((result.version_directory / "scaler.joblib").is_file())
        report_json = json.loads(
            (result.version_directory / "training_report.json").read_text(encoding="utf-8")
        )
        self.assertEqual(report_json["dataset_sha256"], "a" * 64)
        artifacts = VersionedModelLoader(self.models_dir).load()
        self.assertEqual(artifacts.version, VERSION)
        self.assertEqual(artifacts.training_metadata["n_estimators"], 200)

    def test_rejects_insufficient_dataset_without_explicit_override(self) -> None:
        with self.assertRaisesRegex(ModelTrainingError, "10000 rows"):
            train_and_publish_model(
                ModelTrainingRequest(
                    dataset_path=self.directory / "events.jsonl",
                    models_dir=self.models_dir,
                    version=VERSION,
                ),
                loader=StubLoader(loaded_dataset()),
            )

        self.assertFalse(self.models_dir.exists())

    @patch(
        "app.training.trainer.build_tree_shap_explanation_provider",
        return_value=StubExplainer(),
    )
    def test_preserves_prior_version_and_refuses_overwrite(self, _: object) -> None:
        first = "v20261009_110000"
        for version in (first, VERSION):
            train_and_publish_model(
                ModelTrainingRequest(
                    dataset_path=self.directory / "events.jsonl",
                    models_dir=self.models_dir,
                    version=version,
                    allow_insufficient_data=True,
                ),
                loader=StubLoader(loaded_dataset()),
            )

        loader = VersionedModelLoader(self.models_dir)
        self.assertEqual(loader.get_active_version(), VERSION)
        self.assertEqual(loader.list_versions(), (first, VERSION))
        with self.assertRaisesRegex(ModelTrainingError, "already exists"):
            train_and_publish_model(
                ModelTrainingRequest(
                    dataset_path=self.directory / "events.jsonl",
                    models_dir=self.models_dir,
                    version=VERSION,
                    allow_insufficient_data=True,
                ),
                loader=StubLoader(loaded_dataset()),
            )


if __name__ == "__main__":
    unittest.main()

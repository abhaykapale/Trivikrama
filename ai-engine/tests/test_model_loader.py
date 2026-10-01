from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

from app.core.feature_contract import AI_FEATURE_NAMES
from app.core.model_loader import ModelArtifactError, VersionedModelLoader

VERSION = "v20260920_120000"


def registry(
    *,
    model_path: str = f"{VERSION}/model.joblib",
    scaler_path: str = f"{VERSION}/scaler.joblib",
    feature_names: list[str] | None = None,
) -> dict[str, object]:
    return {
        "active_version": VERSION,
        "versions": {
            VERSION: {
                "model_path": model_path,
                "scaler_path": scaler_path,
                "threshold": 0.65,
                "feature_names": feature_names or list(AI_FEATURE_NAMES),
                "feature_defaults": {"time_since_last_event": 45.0},
                "training_metadata": {
                    "trained_at": "2026-09-20T12:00:00Z",
                    "training_samples": 800,
                    "holdout_samples": 200,
                    "n_estimators": 10,
                    "contamination": "auto",
                    "score_mean": 0.32,
                    "score_std": 0.18,
                    "raw_score_min": -0.25,
                    "raw_score_max": 0.35,
                    "anomaly_count_at_threshold": 10,
                    "anomaly_rate_at_threshold": 0.05,
                },
            }
        },
    }


class VersionedModelLoaderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.models_dir = Path(self.temporary_directory.name)
        version_dir = self.models_dir / VERSION
        version_dir.mkdir()

        random = np.random.default_rng(42)
        training = random.normal(size=(64, len(AI_FEATURE_NAMES)))
        scaler = StandardScaler().fit(training)
        model = IsolationForest(n_estimators=10, random_state=42).fit(scaler.transform(training))
        joblib.dump(model, version_dir / "model.joblib")
        joblib.dump(scaler, version_dir / "scaler.joblib")
        self.write_registry(registry())

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def write_registry(self, value: dict[str, object]) -> None:
        (self.models_dir / "config.json").write_text(json.dumps(value), encoding="utf-8")

    def test_loads_the_active_version_as_one_validated_bundle(self) -> None:
        loader = VersionedModelLoader(self.models_dir)

        artifacts = loader.load()

        self.assertEqual(artifacts.version, VERSION)
        self.assertEqual(artifacts.threshold, 0.65)
        self.assertEqual(artifacts.raw_score_min, -0.25)
        self.assertEqual(artifacts.raw_score_max, 0.35)
        self.assertEqual(artifacts.feature_names, AI_FEATURE_NAMES)
        self.assertEqual(artifacts.feature_defaults["time_since_last_event"], 45.0)
        self.assertEqual(loader.get_active_version(), VERSION)
        self.assertEqual(loader.list_versions(), (VERSION,))

    def test_rejects_feature_contract_drift(self) -> None:
        changed_names = list(AI_FEATURE_NAMES)
        changed_names[0], changed_names[1] = changed_names[1], changed_names[0]
        self.write_registry(registry(feature_names=changed_names))

        with self.assertRaisesRegex(ModelArtifactError, "registry is invalid"):
            VersionedModelLoader(self.models_dir).load()

    def test_rejects_an_invalid_training_score_range(self) -> None:
        invalid_registry = registry()
        version = invalid_registry["versions"]
        assert isinstance(version, dict)
        version_config = version[VERSION]
        assert isinstance(version_config, dict)
        metadata = version_config["training_metadata"]
        assert isinstance(metadata, dict)
        metadata["raw_score_min"] = 0.5
        metadata["raw_score_max"] = 0.5
        self.write_registry(invalid_registry)

        with self.assertRaisesRegex(ModelArtifactError, "registry is invalid"):
            VersionedModelLoader(self.models_dir).load()

    def test_rejects_path_traversal_before_loading_an_artifact(self) -> None:
        self.write_registry(registry(model_path="../outside.joblib"))

        with self.assertRaisesRegex(ModelArtifactError, "inside the models"):
            VersionedModelLoader(self.models_dir).load()

    def test_rejects_corrupt_and_wrong_feature_count_artifacts(self) -> None:
        model_path = self.models_dir / VERSION / "model.joblib"
        model_path.write_bytes(b"not a joblib artifact")
        with self.assertRaisesRegex(ModelArtifactError, "could not be loaded"):
            VersionedModelLoader(self.models_dir).load()

        wrong_training = np.ones((32, len(AI_FEATURE_NAMES) - 1))
        wrong_model = IsolationForest(n_estimators=5, random_state=42).fit(wrong_training)
        joblib.dump(wrong_model, model_path)
        with self.assertRaisesRegex(ModelArtifactError, "expected 20"):
            VersionedModelLoader(self.models_dir).load()

    def test_rejects_missing_registry_and_unknown_version(self) -> None:
        loader = VersionedModelLoader(self.models_dir)
        with self.assertRaisesRegex(ModelArtifactError, "not registered"):
            loader.load("v20260919_010101")

        (self.models_dir / "config.json").unlink()
        with self.assertRaisesRegex(ModelArtifactError, "unavailable"):
            loader.load()


if __name__ == "__main__":
    unittest.main()

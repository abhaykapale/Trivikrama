"""Deterministic offline Isolation Forest training and artifact publication."""

from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from math import isfinite
from pathlib import Path
from typing import Literal, Protocol

import joblib
import numpy as np
from numpy.typing import NDArray
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sklearn.ensemble import IsolationForest
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

from app.core.explainer import build_tree_shap_explanation_provider
from app.core.feature_contract import AI_FEATURE_NAMES
from app.core.model_config import (
    MODEL_VERSION_PATTERN,
    ModelRegistryConfig,
    ModelVersionConfig,
    TrainingMetadata,
)
from app.core.model_loader import VersionedModelLoader
from app.core.score_normalizer import ScoreNormalizer
from app.training.contracts import TrainingDatasetQualityReport
from app.training.loader import LoadedTrainingDataset, TrainingDatasetLoader
from app.training.thresholds import select_percentile_threshold

ISOLATION_FOREST_ESTIMATORS = 200


class ModelTrainingError(RuntimeError):
    """Raised when training or safe artifact publication cannot complete."""


class DatasetLoader(Protocol):
    def load(
        self,
        dataset_path: Path,
        manifest_path: Path | None = None,
    ) -> LoadedTrainingDataset: ...


class HoldoutScoreStatistics(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    raw_minimum: float
    raw_maximum: float
    anomaly_mean: float = Field(ge=0.0, le=1.0)
    anomaly_standard_deviation: float = Field(ge=0.0)
    anomaly_p50: float = Field(ge=0.0, le=1.0)
    anomaly_p95: float = Field(ge=0.0, le=1.0)
    anomaly_p99: float = Field(ge=0.0, le=1.0)

    @model_validator(mode="after")
    def validate_raw_range(self) -> HoldoutScoreStatistics:
        if self.raw_maximum <= self.raw_minimum:
            raise ValueError("raw score maximum must exceed minimum")
        return self


class ArtifactDigest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    size_bytes: int = Field(ge=1)


class ModelTrainingReport(BaseModel):
    """Auditable evidence for one immutable trained model version."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    schema_version: Literal["ai-model-training-report-v1"] = "ai-model-training-report-v1"
    version: str
    trained_at: datetime
    dataset_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    dataset_file: str
    dataset_origin: Literal["mongodb_export", "simulated"]
    org_id: str
    feature_names: list[str]
    total_samples: int = Field(ge=2)
    training_samples: int = Field(ge=1)
    holdout_samples: int = Field(ge=1)
    train_fraction: float = Field(gt=0.0, lt=1.0)
    random_state: int
    hyperparameters: dict[str, str | int | float | bool]
    threshold_method: Literal["holdout_percentile"] = "holdout_percentile"
    threshold_percentile: float = Field(gt=0.0, lt=100.0)
    threshold: float = Field(ge=0.0, le=1.0)
    anomaly_count_at_threshold: int = Field(ge=0)
    anomaly_rate_at_threshold: float = Field(ge=0.0, le=1.0)
    holdout_scores: HoldoutScoreStatistics
    shap_validation_passed: bool
    production_eligible: bool
    quality_report: TrainingDatasetQualityReport
    artifacts: dict[str, ArtifactDigest]

    @model_validator(mode="after")
    def validate_contract(self) -> ModelTrainingReport:
        if MODEL_VERSION_PATTERN.fullmatch(self.version) is None:
            raise ValueError("version must use vYYYYMMDD_HHMMSS")
        if tuple(self.feature_names) != AI_FEATURE_NAMES:
            raise ValueError("feature_names must exactly match the ordered v1 contract")
        if self.training_samples + self.holdout_samples != self.total_samples:
            raise ValueError("training and holdout samples must sum to total samples")
        return self


@dataclass(frozen=True, slots=True)
class ModelTrainingRequest:
    dataset_path: Path
    models_dir: Path
    manifest_path: Path | None = None
    version: str | None = None
    holdout_fraction: float = 0.2
    threshold_percentile: float = 95.0
    random_state: int = 42
    allow_insufficient_data: bool = False

    def __post_init__(self) -> None:
        if self.version is not None and MODEL_VERSION_PATTERN.fullmatch(self.version) is None:
            raise ValueError("version must use vYYYYMMDD_HHMMSS")
        if not isfinite(self.holdout_fraction) or not 0.0 < self.holdout_fraction < 1.0:
            raise ValueError("holdout_fraction must be finite and between 0 and 1")
        if not isfinite(self.threshold_percentile) or not 0.0 < self.threshold_percentile < 100.0:
            raise ValueError("threshold_percentile must be finite and between 0 and 100")


@dataclass(frozen=True, slots=True)
class ModelTrainingResult:
    version: str
    version_directory: Path
    registry_path: Path
    report: ModelTrainingReport


def train_and_publish_model(
    request: ModelTrainingRequest,
    *,
    loader: DatasetLoader | None = None,
    clock: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> ModelTrainingResult:
    """Train, validate, and atomically register one immutable model bundle."""

    loaded = (loader or TrainingDatasetLoader()).load(
        request.dataset_path,
        request.manifest_path,
    )
    _validate_dataset_for_training(loaded, request.allow_insufficient_data)
    trained_at = clock()
    if trained_at.tzinfo is None or trained_at.utcoffset() is None:
        raise ModelTrainingError("training clock must return a timezone-aware datetime")
    version = request.version or trained_at.astimezone(UTC).strftime("v%Y%m%d_%H%M%S")
    if MODEL_VERSION_PATTERN.fullmatch(version) is None:
        raise ModelTrainingError("generated model version is invalid")

    values = np.asarray(loaded.values, dtype=np.float64)
    if values.shape[0] < 10:
        raise ModelTrainingError("at least 10 rows are required to create a train/holdout split")
    train_values, holdout_values = train_test_split(
        values,
        test_size=request.holdout_fraction,
        random_state=request.random_state,
        shuffle=True,
    )
    scaler = StandardScaler()
    train_scaled = np.asarray(scaler.fit_transform(train_values), dtype=np.float64)
    holdout_scaled = np.asarray(scaler.transform(holdout_values), dtype=np.float64)
    model = IsolationForest(
        n_estimators=ISOLATION_FOREST_ESTIMATORS,
        max_samples="auto",
        contamination="auto",
        max_features=1.0,
        n_jobs=-1,
        random_state=request.random_state,
        bootstrap=False,
    )
    model.fit(train_scaled)
    raw_scores = np.asarray(model.decision_function(holdout_scaled), dtype=np.float64)
    if raw_scores.ndim != 1 or raw_scores.size != holdout_values.shape[0]:
        raise ModelTrainingError("model returned an invalid holdout score vector")
    if not np.isfinite(raw_scores).all():
        raise ModelTrainingError("model returned non-finite holdout scores")
    raw_minimum = float(np.min(raw_scores))
    raw_maximum = float(np.max(raw_scores))
    if raw_maximum <= raw_minimum:
        raise ModelTrainingError("holdout scores do not provide a usable calibration range")
    anomaly_scores = ScoreNormalizer(
        raw_score_min=raw_minimum,
        raw_score_max=raw_maximum,
    ).normalize(raw_scores)
    threshold = select_percentile_threshold(
        anomaly_scores,
        percentile=request.threshold_percentile,
    )
    anomaly_count = int(np.count_nonzero(anomaly_scores >= threshold))

    # The inference service constructs this same explainer during startup. One
    # real explanation here prevents publishing a model SHAP cannot consume.
    try:
        explainer = build_tree_shap_explanation_provider(model, AI_FEATURE_NAMES)
        explainer.explain(holdout_scaled[:1], holdout_values[:1])
    except Exception as error:
        raise ModelTrainingError("SHAP compatibility validation failed") from error

    feature_defaults = {
        "time_since_last_event": float(
            np.median(train_values[:, AI_FEATURE_NAMES.index("time_since_last_event")])
        )
    }
    training_metadata = TrainingMetadata.model_validate(
        {
            "trained_at": trained_at,
            "training_samples": int(train_values.shape[0]),
            "holdout_samples": int(holdout_values.shape[0]),
            "n_estimators": ISOLATION_FOREST_ESTIMATORS,
            "contamination": "auto",
            "score_mean": float(np.mean(anomaly_scores)),
            "score_std": float(np.std(anomaly_scores)),
            "raw_score_min": raw_minimum,
            "raw_score_max": raw_maximum,
            "anomaly_count_at_threshold": anomaly_count,
            "anomaly_rate_at_threshold": float(anomaly_count / anomaly_scores.size),
            "dataset_sha256": loaded.manifest.sha256,
            "dataset_origin": loaded.manifest.dataset_origin,
            "threshold_method": "holdout_percentile",
            "threshold_percentile": request.threshold_percentile,
            "production_eligible": _is_production_eligible(loaded),
        }
    )
    version_config = ModelVersionConfig(
        model_path=f"{version}/model.joblib",
        scaler_path=f"{version}/scaler.joblib",
        threshold=threshold,
        feature_names=list(AI_FEATURE_NAMES),
        feature_defaults=feature_defaults,
        training_metadata=training_metadata,
    )
    return _publish_bundle(
        request=request,
        loaded=loaded,
        trained_at=trained_at,
        version=version,
        model=model,
        scaler=scaler,
        version_config=version_config,
        train_count=int(train_values.shape[0]),
        holdout_count=int(holdout_values.shape[0]),
        anomaly_scores=anomaly_scores,
        raw_minimum=raw_minimum,
        raw_maximum=raw_maximum,
        threshold=threshold,
        anomaly_count=anomaly_count,
    )


def _validate_dataset_for_training(
    loaded: LoadedTrainingDataset,
    allow_insufficient_data: bool,
) -> None:
    quality = loaded.quality_report
    deficiencies: list[str] = []
    if not quality.minimum_sample_requirement_met:
        deficiencies.append("minimum 10000 rows")
    if not quality.minimum_time_span_requirement_met:
        deficiencies.append("minimum 7-day event span")
    if deficiencies and not allow_insufficient_data:
        raise ModelTrainingError("dataset is not production eligible: " + ", ".join(deficiencies))


def _is_production_eligible(loaded: LoadedTrainingDataset) -> bool:
    quality = loaded.quality_report
    return (
        loaded.manifest.dataset_origin == "mongodb_export"
        and quality.minimum_sample_requirement_met
        and quality.minimum_time_span_requirement_met
    )


def _publish_bundle(
    *,
    request: ModelTrainingRequest,
    loaded: LoadedTrainingDataset,
    trained_at: datetime,
    version: str,
    model: IsolationForest,
    scaler: StandardScaler,
    version_config: ModelVersionConfig,
    train_count: int,
    holdout_count: int,
    anomaly_scores: NDArray[np.float64],
    raw_minimum: float,
    raw_maximum: float,
    threshold: float,
    anomaly_count: int,
) -> ModelTrainingResult:
    models_dir = request.models_dir.absolute()
    models_dir.mkdir(parents=True, exist_ok=True)
    if models_dir.is_symlink():
        raise ModelTrainingError("models directory must not be a symbolic link")
    version_directory = models_dir / version
    if version_directory.exists() or version_directory.is_symlink():
        raise ModelTrainingError(f"model version already exists: {version}")

    temporary_directory = Path(tempfile.mkdtemp(prefix=f".{version}.", dir=models_dir))
    published = False
    registry_path = models_dir / "config.json"
    if registry_path.is_symlink():
        raise ModelTrainingError("model registry must not be a symbolic link")
    previous_registry = registry_path.read_bytes() if registry_path.is_file() else None
    try:
        model_path = temporary_directory / "model.joblib"
        scaler_path = temporary_directory / "scaler.joblib"
        joblib.dump(model, model_path)
        joblib.dump(scaler, scaler_path)
        artifacts = {
            "model": _artifact_digest(model_path, f"{version}/model.joblib"),
            "scaler": _artifact_digest(scaler_path, f"{version}/scaler.joblib"),
        }
        percentiles = np.percentile(anomaly_scores, [50, 95, 99])
        report = ModelTrainingReport(
            version=version,
            trained_at=trained_at,
            dataset_sha256=loaded.manifest.sha256,
            dataset_file=loaded.manifest.dataset_file,
            dataset_origin=loaded.manifest.dataset_origin,
            org_id=loaded.manifest.org_id,
            feature_names=list(AI_FEATURE_NAMES),
            total_samples=loaded.manifest.row_count,
            training_samples=train_count,
            holdout_samples=holdout_count,
            train_fraction=float(train_count / loaded.manifest.row_count),
            random_state=request.random_state,
            hyperparameters={
                "n_estimators": ISOLATION_FOREST_ESTIMATORS,
                "max_samples": "auto",
                "contamination": "auto",
                "max_features": 1.0,
                "n_jobs": -1,
                "random_state": request.random_state,
                "bootstrap": False,
            },
            threshold_percentile=request.threshold_percentile,
            threshold=threshold,
            anomaly_count_at_threshold=anomaly_count,
            anomaly_rate_at_threshold=float(anomaly_count / anomaly_scores.size),
            holdout_scores=HoldoutScoreStatistics(
                raw_minimum=raw_minimum,
                raw_maximum=raw_maximum,
                anomaly_mean=float(np.mean(anomaly_scores)),
                anomaly_standard_deviation=float(np.std(anomaly_scores)),
                anomaly_p50=float(percentiles[0]),
                anomaly_p95=float(percentiles[1]),
                anomaly_p99=float(percentiles[2]),
            ),
            shap_validation_passed=True,
            production_eligible=_is_production_eligible(loaded),
            quality_report=loaded.quality_report,
            artifacts=artifacts,
        )
        _write_and_sync(
            temporary_directory / "training_report.json",
            (report.model_dump_json(indent=2) + "\n").encode("utf-8"),
        )
        os.replace(temporary_directory, version_directory)
        published = True
        registry = _updated_registry(models_dir, version, version_config)
        _replace_registry(registry_path, registry)
        # Prove the exact on-disk bundle satisfies the runtime contract.
        VersionedModelLoader(models_dir).load(version)
        return ModelTrainingResult(
            version=version,
            version_directory=version_directory,
            registry_path=models_dir / "config.json",
            report=report,
        )
    except ModelTrainingError:
        raise
    except Exception as error:
        if published:
            _restore_registry(registry_path, previous_registry)
        raise ModelTrainingError("model artifact publication failed") from error
    finally:
        if temporary_directory.exists():
            shutil.rmtree(temporary_directory)
        # A registry failure must not leave an apparently deployable orphan.
        if published and not _registry_contains(models_dir / "config.json", version):
            shutil.rmtree(version_directory, ignore_errors=True)


def _updated_registry(
    models_dir: Path,
    version: str,
    version_config: ModelVersionConfig,
) -> ModelRegistryConfig:
    registry_path = models_dir / "config.json"
    if registry_path.exists():
        try:
            existing = ModelRegistryConfig.model_validate_json(
                registry_path.read_text(encoding="utf-8")
            )
        except Exception as error:
            raise ModelTrainingError("existing model registry is invalid") from error
        if version in existing.versions:
            raise ModelTrainingError(f"model version is already registered: {version}")
        versions = dict(existing.versions)
    else:
        versions = {}
    versions[version] = version_config
    return ModelRegistryConfig(active_version=version, versions=versions)


def _replace_registry(path: Path, registry: ModelRegistryConfig) -> None:
    _replace_bytes(path, (registry.model_dump_json(indent=2) + "\n").encode("utf-8"))


def _replace_bytes(path: Path, content: bytes) -> None:
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=path.parent,
            prefix=".config.",
            suffix=".tmp",
            delete=False,
        ) as output:
            temporary = Path(output.name)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _restore_registry(path: Path, previous_content: bytes | None) -> None:
    try:
        if previous_content is None:
            path.unlink(missing_ok=True)
        else:
            _replace_bytes(path, previous_content)
    except OSError:
        # Preserve the original publication error. An invalid registry is still
        # detected at application startup and the model directory is removed.
        pass


def _registry_contains(path: Path, version: str) -> bool:
    try:
        registry = ModelRegistryConfig.model_validate_json(path.read_text(encoding="utf-8"))
    except Exception:
        return False
    return version in registry.versions


def _artifact_digest(path: Path, relative_path: str) -> ArtifactDigest:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return ArtifactDigest(
        path=relative_path,
        sha256=digest.hexdigest(),
        size_bytes=path.stat().st_size,
    )


def _write_and_sync(path: Path, content: bytes) -> None:
    with path.open("xb") as output:
        output.write(content)
        output.flush()
        os.fsync(output.fileno())

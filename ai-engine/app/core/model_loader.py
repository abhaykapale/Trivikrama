"""Load a complete, validated model bundle from the trusted models directory."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, cast

import joblib
from pydantic import JsonValue

from app.core.feature_contract import AI_FEATURE_NAMES
from app.core.model_config import ModelRegistryConfig
from app.core.preprocessor import FeatureScaler


class ModelArtifactError(RuntimeError):
    """Raised when the configured model bundle cannot be safely loaded."""


class AnomalyModel(Protocol):
    n_features_in_: int

    def decision_function(self, values: Any) -> Any: ...


@dataclass(frozen=True, slots=True)
class LoadedModelArtifacts:
    version: str
    model: AnomalyModel
    scaler: FeatureScaler
    threshold: float
    raw_score_min: float
    raw_score_max: float
    feature_names: tuple[str, ...]
    feature_defaults: dict[str, float]
    training_metadata: dict[str, JsonValue]


class ModelBundleLoader(Protocol):
    @property
    def config_path(self) -> Path: ...

    def load(self, version: str | None = None) -> LoadedModelArtifacts: ...


class VersionedModelLoader:
    """Loads Joblib artifacts referenced by a validated local registry.

    Joblib uses pickle internally. Only deployment-controlled artifacts may be
    placed in this directory; the API never accepts artifact paths.
    """

    def __init__(
        self,
        models_dir: Path,
        *,
        max_artifact_bytes: int = 512 * 1024 * 1024,
    ) -> None:
        if max_artifact_bytes < 1:
            raise ValueError("max_artifact_bytes must be positive")
        self._models_dir = models_dir.resolve()
        self._config_path = self._models_dir / "config.json"
        self._max_artifact_bytes = max_artifact_bytes

    @property
    def config_path(self) -> Path:
        return self._config_path

    def read_registry(self) -> ModelRegistryConfig:
        config_path = self._trusted_regular_file(self._config_path, expected_suffix=".json")
        try:
            content = config_path.read_text(encoding="utf-8")
            return ModelRegistryConfig.model_validate_json(content)
        except ModelArtifactError:
            raise
        except Exception as error:
            raise ModelArtifactError("model registry is invalid") from error

    def get_active_version(self) -> str:
        return self.read_registry().active_version

    def list_versions(self) -> tuple[str, ...]:
        return tuple(sorted(self.read_registry().versions))

    def load(self, version: str | None = None) -> LoadedModelArtifacts:
        registry = self.read_registry()
        selected_version = registry.active_version if version is None else version
        version_config = registry.versions.get(selected_version)
        if version_config is None:
            raise ModelArtifactError("requested model version is not registered")

        model_path = self._resolve_artifact(version_config.model_path)
        scaler_path = self._resolve_artifact(version_config.scaler_path)

        # State is not published until both artifacts and their interfaces pass.
        model = self._load_joblib(model_path, "model")
        scaler = self._load_joblib(scaler_path, "scaler")
        self._validate_interfaces(model, scaler)

        return LoadedModelArtifacts(
            version=selected_version,
            model=cast(AnomalyModel, model),
            scaler=cast(FeatureScaler, scaler),
            threshold=version_config.threshold,
            raw_score_min=version_config.training_metadata.raw_score_min,
            raw_score_max=version_config.training_metadata.raw_score_max,
            feature_names=tuple(version_config.feature_names),
            feature_defaults=version_config.merged_feature_defaults(),
            training_metadata=version_config.training_metadata.model_dump(mode="json"),
        )

    def _resolve_artifact(self, configured_path: str) -> Path:
        relative = Path(configured_path)
        if relative.is_absolute() or ".." in relative.parts:
            raise ModelArtifactError("artifact path must stay inside the models directory")
        candidate = self._models_dir / relative
        if candidate.is_symlink():
            raise ModelArtifactError("symbolic-link model files are not allowed")
        resolved = candidate.resolve()
        if not resolved.is_relative_to(self._models_dir):
            raise ModelArtifactError("artifact path escapes the models directory")
        return self._trusted_regular_file(resolved, expected_suffix=".joblib")

    def _trusted_regular_file(self, path: Path, *, expected_suffix: str) -> Path:
        if path.suffix.lower() != expected_suffix:
            raise ModelArtifactError(f"expected a {expected_suffix} file")
        if path.is_symlink():
            raise ModelArtifactError("symbolic-link model files are not allowed")
        if not path.is_file():
            raise ModelArtifactError("required model file is unavailable")
        if path.stat().st_size > self._max_artifact_bytes:
            raise ModelArtifactError("model file exceeds the configured size limit")
        return path

    @staticmethod
    def _load_joblib(path: Path, artifact_name: str) -> object:
        try:
            return joblib.load(path)
        except Exception as error:
            raise ModelArtifactError(f"{artifact_name} artifact could not be loaded") from error

    @staticmethod
    def _validate_interfaces(model: object, scaler: object) -> None:
        if not callable(getattr(model, "decision_function", None)):
            raise ModelArtifactError("model does not provide decision_function")
        if not callable(getattr(scaler, "transform", None)):
            raise ModelArtifactError("scaler does not provide transform")

        expected_count = len(AI_FEATURE_NAMES)
        for name, artifact in (("model", model), ("scaler", scaler)):
            feature_count = getattr(artifact, "n_features_in_", None)
            if feature_count != expected_count:
                raise ModelArtifactError(
                    f"{name} expects {feature_count!r} features; expected {expected_count}"
                )

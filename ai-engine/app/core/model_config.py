"""Validated schema for the versioned model artifact registry."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.feature_contract import AI_FEATURE_NAMES, DEFAULT_FEATURE_VALUES

MODEL_VERSION_PATTERN = re.compile(r"^v[0-9]{8}_[0-9]{6}$")


class TrainingMetadata(BaseModel):
    model_config = ConfigDict(extra="allow", strict=True, allow_inf_nan=False)

    trained_at: datetime
    training_samples: int = Field(ge=1)
    holdout_samples: int = Field(ge=1)
    n_estimators: int = Field(ge=1)
    contamination: str | float
    score_mean: float
    score_std: float = Field(ge=0.0)
    raw_score_min: float
    raw_score_max: float
    anomaly_count_at_threshold: int = Field(ge=0)
    anomaly_rate_at_threshold: float = Field(ge=0.0, le=1.0)

    @model_validator(mode="after")
    def validate_contamination(self) -> Self:
        if self.trained_at.tzinfo is None:
            raise ValueError("trained_at must include a timezone")
        if self.contamination != "auto":
            if isinstance(self.contamination, bool) or not isinstance(
                self.contamination, (int, float)
            ):
                raise ValueError("contamination must be 'auto' or a number")
            if not 0.0 < float(self.contamination) <= 0.5:
                raise ValueError("numeric contamination must be greater than 0 and at most 0.5")
        if self.raw_score_max <= self.raw_score_min:
            raise ValueError("raw_score_max must be greater than raw_score_min")
        return self


class ModelVersionConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

    model_path: str = Field(min_length=1)
    scaler_path: str = Field(min_length=1)
    threshold: float = Field(ge=0.0, le=1.0)
    feature_names: list[str]
    feature_defaults: dict[str, float] = Field(default_factory=dict)
    training_metadata: TrainingMetadata

    @model_validator(mode="after")
    def validate_feature_contract(self) -> Self:
        if tuple(self.feature_names) != AI_FEATURE_NAMES:
            raise ValueError("feature_names must exactly match the ordered v1 feature contract")
        unknown_defaults = set(self.feature_defaults).difference(DEFAULT_FEATURE_VALUES)
        if unknown_defaults:
            names = ", ".join(sorted(unknown_defaults))
            raise ValueError(f"feature_defaults contains unknown features: {names}")
        return self

    def merged_feature_defaults(self) -> dict[str, float]:
        return {**DEFAULT_FEATURE_VALUES, **self.feature_defaults}


class ModelRegistryConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

    active_version: str = Field(min_length=1)
    versions: dict[str, ModelVersionConfig] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_registry(self) -> Self:
        invalid_versions = [
            version for version in self.versions if not MODEL_VERSION_PATTERN.fullmatch(version)
        ]
        if invalid_versions:
            raise ValueError("invalid model version names: " + ", ".join(sorted(invalid_versions)))
        if self.active_version not in self.versions:
            raise ValueError("active_version must identify an entry in versions")
        return self

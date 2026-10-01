"""Versioned contracts for offline AI training datasets."""

from __future__ import annotations

import re
from datetime import datetime
from math import isfinite
from pathlib import Path
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.feature_contract import (
    AI_FEATURE_NAMES,
    FEATURE_BOUNDS,
)

DATASET_SCHEMA_VERSION: Literal["ai-training-dataset-v1"] = "ai-training-dataset-v1"
FEATURE_CONTRACT_VERSION: Literal["v1"] = "v1"
MINIMUM_TRAINING_ROWS = 10_000
MINIMUM_TIME_SPAN_DAYS = 7.0
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class TrainingEventRecord(BaseModel):
    """One privacy-minimized, feature-enriched event in the JSONL dataset."""

    model_config = ConfigDict(extra="forbid", strict=True)

    event_id: str = Field(min_length=1, max_length=255)
    org_id: str = Field(min_length=1, max_length=255)
    time: datetime
    class_uid: int = Field(ge=0)
    features: dict[str, float]

    @field_validator("event_id", "org_id")
    @classmethod
    def reject_surrounding_whitespace(cls, value: str) -> str:
        if value != value.strip():
            raise ValueError("must not contain surrounding whitespace")
        return value

    @field_validator("features", mode="before")
    @classmethod
    def validate_feature_vector(cls, value: Any) -> dict[str, float]:
        if not isinstance(value, dict):
            raise ValueError("features must be an object")
        if any(not isinstance(name, str) for name in value):
            raise ValueError("feature names must be strings")
        expected = set(AI_FEATURE_NAMES)
        actual = set(value)
        missing = expected.difference(actual)
        unknown = actual.difference(expected)
        if missing or unknown:
            details: list[str] = []
            if missing:
                details.append("missing: " + ", ".join(sorted(missing)))
            if unknown:
                details.append("unknown: " + ", ".join(sorted(unknown)))
            raise ValueError("features must exactly match v1 (" + "; ".join(details) + ")")

        cleaned: dict[str, float] = {}
        for name in AI_FEATURE_NAMES:
            raw = value[name]
            if isinstance(raw, bool) or not isinstance(raw, (int, float)):
                raise ValueError(f"feature {name} must be numeric")
            numeric = float(raw)
            if not isfinite(numeric):
                raise ValueError(f"feature {name} must be finite")
            lower, upper = FEATURE_BOUNDS[name]
            if lower is not None and numeric < lower:
                raise ValueError(f"feature {name} is below its minimum")
            if upper is not None and numeric > upper:
                raise ValueError(f"feature {name} exceeds its maximum")
            cleaned[name] = numeric
        return cleaned

    @model_validator(mode="after")
    def timestamp_must_be_timezone_aware(self) -> Self:
        if self.time.tzinfo is None or self.time.utcoffset() is None:
            raise ValueError("time must include a timezone")
        return self


class TrainingDatasetManifest(BaseModel):
    """Integrity and provenance metadata stored beside one JSONL export."""

    model_config = ConfigDict(extra="forbid", strict=True)

    schema_version: Literal["ai-training-dataset-v1"] = DATASET_SCHEMA_VERSION
    feature_contract_version: Literal["v1"] = FEATURE_CONTRACT_VERSION
    dataset_file: str = Field(min_length=1, max_length=255)
    org_id: str = Field(min_length=1, max_length=255)
    from_time: datetime
    to_time: datetime
    exported_at: datetime
    row_count: int = Field(ge=1)
    feature_count: int = Field(ge=1)
    feature_names: list[str] = Field(min_length=1)
    sha256: str = Field(min_length=64, max_length=64)

    @field_validator("dataset_file")
    @classmethod
    def dataset_file_must_be_a_basename(cls, value: str) -> str:
        if value != Path(value).name or not value.endswith(".jsonl"):
            raise ValueError("dataset_file must be a .jsonl basename")
        return value

    @field_validator("org_id")
    @classmethod
    def org_id_must_be_trimmed(cls, value: str) -> str:
        if value != value.strip():
            raise ValueError("org_id must not contain surrounding whitespace")
        return value

    @field_validator("sha256")
    @classmethod
    def checksum_must_be_lowercase_sha256(cls, value: str) -> str:
        if SHA256_PATTERN.fullmatch(value) is None:
            raise ValueError("sha256 must contain 64 lowercase hexadecimal characters")
        return value

    @model_validator(mode="after")
    def validate_contract_and_time_window(self) -> Self:
        for name, value in (
            ("from_time", self.from_time),
            ("to_time", self.to_time),
            ("exported_at", self.exported_at),
        ):
            if value.tzinfo is None or value.utcoffset() is None:
                raise ValueError(f"{name} must include a timezone")
        if self.from_time >= self.to_time:
            raise ValueError("from_time must be earlier than to_time")
        if self.feature_count != len(AI_FEATURE_NAMES):
            raise ValueError("feature_count must match the v1 feature contract")
        if tuple(self.feature_names) != AI_FEATURE_NAMES:
            raise ValueError("feature_names must exactly match the ordered v1 contract")
        return self


class FeatureQualityStatistics(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    minimum: float
    maximum: float
    mean: float
    standard_deviation: float = Field(ge=0.0)
    p01: float
    p50: float
    p95: float
    p99: float
    default_rate: float = Field(ge=0.0, le=1.0)


class TrainingDatasetQualityReport(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    schema_version: Literal["ai-training-quality-v1"] = "ai-training-quality-v1"
    dataset_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    org_id: str
    row_count: int = Field(ge=1)
    first_event_time: datetime
    last_event_time: datetime
    time_span_days: float = Field(ge=0.0)
    minimum_sample_requirement_met: bool
    minimum_time_span_requirement_met: bool
    warnings: list[str]
    class_distribution: dict[str, int]
    feature_statistics: dict[str, FeatureQualityStatistics]

    @model_validator(mode="after")
    def validate_report_consistency(self) -> Self:
        if self.first_event_time > self.last_event_time:
            raise ValueError("first_event_time must not follow last_event_time")
        if sum(self.class_distribution.values()) != self.row_count:
            raise ValueError("class_distribution must sum to row_count")
        if tuple(self.feature_statistics) != AI_FEATURE_NAMES:
            raise ValueError("feature_statistics must follow the ordered v1 contract")
        return self

"""Validated HTTP contracts for anomaly-detection requests."""

from __future__ import annotations

from typing import Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

NumericFeature = int | float | None


class FeatureValues(BaseModel):
    """Backend feature payload.

    Fundamental event features are required. Contextual model-external fields
    are accepted so the preprocessor can deliberately discard them.
    """

    model_config = ConfigDict(extra="allow", strict=True)

    hour_of_day: NumericFeature
    day_of_week: NumericFeature
    is_business_hours: NumericFeature
    time_since_last_event: NumericFeature = None
    time_deviation_score: NumericFeature = None
    events_per_minute_src_ip: NumericFeature = None
    events_per_hour_user: NumericFeature = None
    unique_dst_ips_per_src: NumericFeature = None
    unique_users_per_src_ip: NumericFeature = None
    frequency_deviation: NumericFeature = None
    src_ip_entropy: NumericFeature = None
    username_entropy: NumericFeature = None
    process_name_entropy: NumericFeature = None
    bytes_sent: NumericFeature = None
    bytes_received: NumericFeature = None
    bytes_ratio: NumericFeature = None
    severity_id: NumericFeature
    failed_login_count_10min: NumericFeature = None
    failed_to_success_ratio: NumericFeature = None
    new_source_ip: NumericFeature = None

    def as_preprocessing_input(self) -> dict[str, object]:
        return self.model_dump()


class DetectionEventInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    event_id: str = Field(min_length=1, max_length=200)
    features: FeatureValues

    @field_validator("event_id")
    @classmethod
    def reject_blank_event_id(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("event_id must not be blank")
        return value


class DetectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    events: list[DetectionEventInput] = Field(min_length=1, max_length=100)
    threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    include_shap: bool = True

    @model_validator(mode="after")
    def reject_duplicate_event_ids(self) -> Self:
        event_ids = [event.event_id for event in self.events]
        if len(set(event_ids)) != len(event_ids):
            raise ValueError("event_id values must be unique within a batch")
        return self


class ShapFeatureContributionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

    name: str
    value: float
    shap_value: float


class ShapExplanationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

    base_value: float
    features: list[ShapFeatureContributionResponse]


class DetectionPredictionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    event_id: str
    anomaly_score: float = Field(ge=0.0, le=1.0)
    is_anomaly: bool
    confidence: float = Field(ge=0.0, le=1.0)
    shap_explanation: ShapExplanationResponse | None = None


class DetectionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    predictions: list[DetectionPredictionResponse]
    model_version: str
    processing_time_ms: float = Field(ge=0.0)
    events_processed: int = Field(ge=0)
    anomalies_detected: int = Field(ge=0)

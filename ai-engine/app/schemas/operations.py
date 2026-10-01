"""Response contracts for AI Engine operational APIs."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class InferenceMetricsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total_requests: int = Field(ge=0)
    total_events_processed: int = Field(ge=0)
    total_anomalies_detected: int = Field(ge=0)
    avg_batch_size: float = Field(ge=0.0)
    avg_latency_ms: float = Field(ge=0.0)
    p50_latency_ms: float = Field(ge=0.0)
    p95_latency_ms: float = Field(ge=0.0)
    p99_latency_ms: float = Field(ge=0.0)
    error_rate: float = Field(ge=0.0, le=1.0)


class ShapMetricsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total_explanations: int = Field(ge=0)
    avg_explanation_ms: float = Field(ge=0.0)


class ModelMetricsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str | None
    threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    loaded_at: datetime | None


class MetricsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inference: InferenceMetricsResponse
    shap: ShapMetricsResponse
    model: ModelMetricsResponse


class ModelTrainingMetadataResponse(BaseModel):
    """Allowlisted public projection of the internal training metadata."""

    model_config = ConfigDict(extra="ignore")

    trained_at: datetime
    training_samples: int = Field(ge=1)
    holdout_samples: int = Field(ge=1)
    n_estimators: int = Field(ge=1)
    anomaly_rate_at_threshold: float = Field(ge=0.0, le=1.0)


class ModelInfoResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active_version: str
    threshold: float = Field(ge=0.0, le=1.0)
    feature_count: int = Field(ge=1)
    feature_names: list[str] = Field(min_length=1)
    training_metadata: ModelTrainingMetadataResponse
    available_versions: list[str] = Field(min_length=1)

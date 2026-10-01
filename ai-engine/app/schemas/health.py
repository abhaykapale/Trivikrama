"""Health API request and response models."""

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["healthy", "unhealthy"]
    model_loaded: bool
    model_version: str | None
    uptime_seconds: float = Field(ge=0)
    total_predictions: int = Field(ge=0)
    avg_latency_ms: float = Field(ge=0)
    p99_latency_ms: float = Field(ge=0)
    errors_total: int = Field(ge=0)

    @model_validator(mode="after")
    def model_state_is_consistent(self) -> Self:
        expected_status = "healthy" if self.model_loaded else "unhealthy"
        if self.status != expected_status:
            raise ValueError("status must match model_loaded")
        if self.model_loaded and not self.model_version:
            raise ValueError("a loaded model must have a version")
        if not self.model_loaded and self.model_version is not None:
            raise ValueError("an unloaded model must not have a version")
        return self

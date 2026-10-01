"""Validated HTTP contracts for standalone event explanations."""

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.detection import FeatureValues, ShapExplanationResponse


class ExplanationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    event_id: str = Field(min_length=1, max_length=200)
    features: FeatureValues

    @field_validator("event_id")
    @classmethod
    def reject_blank_event_id(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("event_id must not be blank")
        return value


class ExplanationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    event_id: str
    anomaly_score: float = Field(ge=0.0, le=1.0)
    shap_explanation: ShapExplanationResponse
    model_version: str
    processing_time_ms: float = Field(ge=0.0)

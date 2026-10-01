"""Internal metrics and active-model information endpoints."""

from __future__ import annotations

from typing import Annotated, cast

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.core.model_loader import LoadedModelArtifacts
from app.routes.health import get_runtime
from app.runtime import RuntimeState
from app.schemas.operations import (
    InferenceMetricsResponse,
    MetricsResponse,
    ModelInfoResponse,
    ModelMetricsResponse,
    ModelTrainingMetadataResponse,
    ShapMetricsResponse,
)

router = APIRouter(prefix="/api/v1", tags=["operations"])


def get_model_artifacts(request: Request) -> LoadedModelArtifacts | None:
    return cast(LoadedModelArtifacts | None, request.app.state.model_artifacts)


def get_available_model_versions(request: Request) -> tuple[str, ...]:
    return cast(tuple[str, ...], request.app.state.available_model_versions)


@router.get(
    "/metrics",
    response_model=MetricsResponse,
    summary="Report inference, SHAP, and active-model metrics",
)
def get_metrics(
    response: Response,
    runtime: Annotated[RuntimeState, Depends(get_runtime)],
) -> MetricsResponse:
    response.headers["Cache-Control"] = "no-store"
    snapshot = runtime.snapshot()
    return MetricsResponse(
        inference=InferenceMetricsResponse(
            total_requests=snapshot.total_requests,
            total_events_processed=snapshot.total_events_processed,
            total_anomalies_detected=snapshot.total_anomalies_detected,
            avg_batch_size=round(snapshot.avg_batch_size, 3),
            avg_latency_ms=round(snapshot.avg_latency_ms, 3),
            p50_latency_ms=round(snapshot.p50_latency_ms, 3),
            p95_latency_ms=round(snapshot.p95_latency_ms, 3),
            p99_latency_ms=round(snapshot.p99_latency_ms, 3),
            error_rate=round(snapshot.error_rate, 6),
        ),
        shap=ShapMetricsResponse(
            total_explanations=snapshot.total_explanations,
            avg_explanation_ms=round(snapshot.avg_explanation_ms, 3),
        ),
        model=ModelMetricsResponse(
            version=snapshot.model_version,
            threshold=snapshot.model_threshold,
            loaded_at=snapshot.model_loaded_at,
        ),
    )


@router.get(
    "/model/info",
    response_model=ModelInfoResponse,
    summary="Report the active model contract and training metadata",
)
def get_model_info(
    response: Response,
    artifacts: Annotated[LoadedModelArtifacts | None, Depends(get_model_artifacts)],
    available_versions: Annotated[tuple[str, ...], Depends(get_available_model_versions)],
) -> ModelInfoResponse:
    response.headers["Cache-Control"] = "no-store"
    if artifacts is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model information is unavailable because no model is loaded.",
            headers={"Cache-Control": "no-store"},
        )
    return ModelInfoResponse(
        active_version=artifacts.version,
        threshold=artifacts.threshold,
        feature_count=len(artifacts.feature_names),
        feature_names=list(artifacts.feature_names),
        training_metadata=ModelTrainingMetadataResponse.model_validate(artifacts.training_metadata),
        available_versions=list(available_versions),
    )

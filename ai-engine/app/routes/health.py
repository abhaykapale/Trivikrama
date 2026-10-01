"""Operational health route."""

from typing import Annotated, cast

from fastapi import APIRouter, Depends, Request, Response

from app.runtime import RuntimeState
from app.schemas.health import HealthResponse

router = APIRouter(prefix="/api/v1", tags=["operations"])


def get_runtime(request: Request) -> RuntimeState:
    return cast(RuntimeState, request.app.state.runtime)


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Report process metrics and model readiness",
)
def get_health(
    response: Response,
    runtime: Annotated[RuntimeState, Depends(get_runtime)],
) -> HealthResponse:
    response.headers["Cache-Control"] = "no-store"
    snapshot = runtime.snapshot()
    return HealthResponse(
        status="healthy" if snapshot.model_loaded else "unhealthy",
        model_loaded=snapshot.model_loaded,
        model_version=snapshot.model_version,
        uptime_seconds=round(snapshot.uptime_seconds, 3),
        total_predictions=snapshot.total_predictions,
        avg_latency_ms=round(snapshot.avg_latency_ms, 3),
        p99_latency_ms=round(snapshot.p99_latency_ms, 3),
        errors_total=snapshot.errors_total,
    )

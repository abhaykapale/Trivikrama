"""Internal HTTP endpoint for a standalone single-event explanation."""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.core.detector import DetectionEvent, IsolationForestDetector
from app.routes.detection import get_detector, get_inference_clock, get_runtime
from app.runtime import RuntimeState
from app.schemas.detection import (
    ShapExplanationResponse,
    ShapFeatureContributionResponse,
)
from app.schemas.explanation import ExplanationRequest, ExplanationResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["explanation"])


@router.post(
    "/explain",
    response_model=ExplanationResponse,
    summary="Score and explain one enriched security event",
)
def explain_event(
    payload: ExplanationRequest,
    response: Response,
    runtime: Annotated[RuntimeState, Depends(get_runtime)],
    clock: Annotated[Callable[[], float], Depends(get_inference_clock)],
    detector: Annotated[IsolationForestDetector | None, Depends(get_detector)],
) -> ExplanationResponse:
    response.headers["Cache-Control"] = "no-store"
    started_at = clock()

    if detector is None:
        latency_ms = max(0.0, (clock() - started_at) * 1_000.0)
        runtime.record_prediction(latency_ms, failed=True, events_processed=0)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Explanation model is not ready.",
            headers={"Cache-Control": "no-store"},
        )

    try:
        result = detector.explain(
            DetectionEvent(
                event_id=payload.event_id,
                features=payload.features.as_preprocessing_input(),
            )
        )
    except Exception:
        latency_ms = max(0.0, (clock() - started_at) * 1_000.0)
        runtime.record_prediction(latency_ms, failed=True, events_processed=0)
        logger.exception("Standalone event explanation failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Event explanation failed.",
            headers={"Cache-Control": "no-store"},
        ) from None

    latency_ms = max(0.0, (clock() - started_at) * 1_000.0)
    runtime.record_prediction(latency_ms)
    return ExplanationResponse(
        event_id=result.event_id,
        anomaly_score=result.anomaly_score,
        shap_explanation=ShapExplanationResponse(
            base_value=result.shap_explanation.base_value,
            features=[
                ShapFeatureContributionResponse(
                    name=feature.name,
                    value=feature.value,
                    shap_value=feature.shap_value,
                )
                for feature in result.shap_explanation.features
            ],
        ),
        model_version=result.model_version,
        processing_time_ms=round(latency_ms, 3),
    )

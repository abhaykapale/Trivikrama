"""Internal HTTP endpoint for batched anomaly detection."""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Annotated, cast

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.core.detector import DetectionEvent, IsolationForestDetector
from app.runtime import RuntimeState
from app.schemas.detection import (
    DetectionPredictionResponse,
    DetectionRequest,
    DetectionResponse,
    ShapExplanationResponse,
    ShapFeatureContributionResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/detect", tags=["detection"])


def get_runtime(request: Request) -> RuntimeState:
    return cast(RuntimeState, request.app.state.runtime)


def get_inference_clock(request: Request) -> Callable[[], float]:
    return cast(Callable[[], float], request.app.state.inference_clock)


def get_detector(request: Request) -> IsolationForestDetector | None:
    return cast(IsolationForestDetector | None, request.app.state.detector)


@router.post(
    "/anomaly",
    response_model=DetectionResponse,
    summary="Score a batch of enriched security events",
)
def detect_anomalies(
    payload: DetectionRequest,
    response: Response,
    runtime: Annotated[RuntimeState, Depends(get_runtime)],
    clock: Annotated[Callable[[], float], Depends(get_inference_clock)],
    detector: Annotated[IsolationForestDetector | None, Depends(get_detector)],
) -> DetectionResponse:
    response.headers["Cache-Control"] = "no-store"
    started_at = clock()

    if detector is None:
        latency_ms = max(0.0, (clock() - started_at) * 1_000.0)
        runtime.record_prediction(latency_ms, failed=True, events_processed=0)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Detection model is not ready.",
            headers={"Cache-Control": "no-store"},
        )

    try:
        result = detector.detect(
            [
                DetectionEvent(
                    event_id=event.event_id,
                    features=event.features.as_preprocessing_input(),
                )
                for event in payload.events
            ],
            threshold=payload.threshold,
            include_shap=payload.include_shap,
        )
    except Exception:
        latency_ms = max(0.0, (clock() - started_at) * 1_000.0)
        runtime.record_prediction(latency_ms, failed=True, events_processed=0)
        logger.exception("Anomaly detection failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Anomaly detection failed.",
            headers={"Cache-Control": "no-store"},
        ) from None

    latency_ms = max(0.0, (clock() - started_at) * 1_000.0)
    runtime.record_prediction(
        latency_ms,
        events_processed=result.events_processed,
        anomalies_detected=result.anomalies_detected,
    )
    return DetectionResponse(
        predictions=[
            DetectionPredictionResponse(
                event_id=prediction.event_id,
                anomaly_score=prediction.anomaly_score,
                is_anomaly=prediction.is_anomaly,
                confidence=prediction.confidence,
                shap_explanation=(
                    None
                    if prediction.shap_explanation is None
                    else ShapExplanationResponse(
                        base_value=prediction.shap_explanation.base_value,
                        features=[
                            ShapFeatureContributionResponse(
                                name=feature.name,
                                value=feature.value,
                                shap_value=feature.shap_value,
                            )
                            for feature in prediction.shap_explanation.features
                        ],
                    )
                ),
            )
            for prediction in result.predictions
        ],
        model_version=result.model_version,
        processing_time_ms=round(latency_ms, 3),
        events_processed=result.events_processed,
        anomalies_detected=result.anomalies_detected,
    )

"""FastAPI composition root for the Trivikrama AI Engine."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from time import monotonic

from fastapi import FastAPI

from app.config import Settings, load_settings
from app.core.detector import IsolationForestDetector
from app.core.explainer import (
    ExplanationProviderFactory,
    ShapExplanationError,
    build_tree_shap_explanation_provider,
)
from app.core.measured_explainer import MeasuredExplanationProvider
from app.core.model_loader import (
    ModelArtifactError,
    ModelBundleLoader,
    VersionedModelLoader,
)
from app.routes.detection import router as detection_router
from app.routes.explanation import router as explanation_router
from app.routes.health import router as health_router
from app.routes.operations import router as operations_router
from app.runtime import RuntimeState

logger = logging.getLogger(__name__)


def create_app(
    settings: Settings | None = None,
    *,
    clock: Callable[[], float] = monotonic,
    model_loader: ModelBundleLoader | None = None,
    explanation_provider_factory: ExplanationProviderFactory | None = None,
) -> FastAPI:
    resolved_settings = settings or load_settings()
    runtime = RuntimeState(clock=clock)
    resolved_loader = model_loader or VersionedModelLoader(resolved_settings.models_dir)
    resolved_explanation_factory = (
        explanation_provider_factory or build_tree_shap_explanation_provider
    )

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        should_load = (
            resolved_loader.config_path.exists() or resolved_settings.require_model_on_startup
        )
        if should_load:
            try:
                artifacts = resolved_loader.load()
                explanation_provider = resolved_explanation_factory(
                    artifacts.model,
                    artifacts.feature_names,
                )
                measured_explanation_provider = MeasuredExplanationProvider(
                    explanation_provider,
                    runtime,
                    clock=clock,
                )
                detector = IsolationForestDetector(
                    artifacts,
                    explanation_provider=measured_explanation_provider,
                )
                list_versions = getattr(resolved_loader, "list_versions", None)
                available_model_versions = (
                    tuple(list_versions()) if callable(list_versions) else (artifacts.version,)
                )
            except (ModelArtifactError, ShapExplanationError):
                runtime.mark_model_unloaded()
                application.state.model_artifacts = None
                if resolved_settings.require_model_on_startup:
                    raise
                logger.exception("Configured model bundle could not be loaded")
            else:
                application.state.model_artifacts = artifacts
                application.state.available_model_versions = available_model_versions
                application.state.detector = detector
                runtime.mark_model_loaded(
                    artifacts.version,
                    threshold=artifacts.threshold,
                )
        try:
            yield
        finally:
            application.state.model_artifacts = None
            application.state.available_model_versions = ()
            application.state.detector = None
            runtime.mark_model_unloaded()

    docs_url = "/docs" if resolved_settings.expose_api_docs else None
    openapi_url = "/openapi.json" if resolved_settings.expose_api_docs else None
    application = FastAPI(
        title=resolved_settings.app_name,
        version="0.1.0",
        docs_url=docs_url,
        redoc_url=None,
        openapi_url=openapi_url,
        lifespan=lifespan,
    )
    application.state.settings = resolved_settings
    application.state.runtime = runtime
    application.state.model_loader = resolved_loader
    application.state.model_artifacts = None
    application.state.available_model_versions = ()
    application.state.detector = None
    application.state.inference_clock = clock
    application.include_router(health_router)
    application.include_router(detection_router)
    application.include_router(explanation_router)
    application.include_router(operations_router)
    return application


app = create_app()

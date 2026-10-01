"""Environment-backed application configuration."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path


class Environment(StrEnum):
    DEVELOPMENT = "development"
    TEST = "test"
    PRODUCTION = "production"


class ConfigurationError(ValueError):
    """Raised when an environment setting cannot be safely interpreted."""


@dataclass(frozen=True, slots=True)
class Settings:
    app_name: str = "Trivikrama AI Engine"
    environment: Environment = Environment.DEVELOPMENT
    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "INFO"
    models_dir: Path = Path("models")
    require_model_on_startup: bool = False

    @property
    def expose_api_docs(self) -> bool:
        return self.environment is not Environment.PRODUCTION


def load_settings(environ: Mapping[str, str] | None = None) -> Settings:
    source = os.environ if environ is None else environ
    app_name = source.get("AI_APP_NAME", "Trivikrama AI Engine").strip()
    host = source.get("AI_HOST", "0.0.0.0").strip()
    environment_raw = source.get("AI_ENVIRONMENT", "development").strip().lower()
    log_level = source.get("AI_LOG_LEVEL", "INFO").strip().upper()
    models_dir_raw = source.get("AI_MODELS_DIR", "models").strip()

    if not app_name:
        raise ConfigurationError("AI_APP_NAME must not be blank")
    if not host:
        raise ConfigurationError("AI_HOST must not be blank")
    if not models_dir_raw:
        raise ConfigurationError("AI_MODELS_DIR must not be blank")

    try:
        environment = Environment(environment_raw)
    except ValueError as error:
        allowed = ", ".join(member.value for member in Environment)
        raise ConfigurationError(f"AI_ENVIRONMENT must be one of: {allowed}") from error

    try:
        port = int(source.get("AI_PORT", "8000"))
    except ValueError as error:
        raise ConfigurationError("AI_PORT must be an integer") from error
    if not 1 <= port <= 65_535:
        raise ConfigurationError("AI_PORT must be between 1 and 65535")

    allowed_log_levels = {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"}
    if log_level not in allowed_log_levels:
        raise ConfigurationError(
            "AI_LOG_LEVEL must be one of: CRITICAL, ERROR, WARNING, INFO, DEBUG"
        )

    require_model_default = environment is Environment.PRODUCTION
    require_model_on_startup = _parse_boolean(
        source.get("AI_REQUIRE_MODEL_ON_STARTUP"),
        default=require_model_default,
        name="AI_REQUIRE_MODEL_ON_STARTUP",
    )

    return Settings(
        app_name=app_name,
        environment=environment,
        host=host,
        port=port,
        log_level=log_level,
        models_dir=Path(models_dir_raw),
        require_model_on_startup=require_model_on_startup,
    )


def _parse_boolean(value: str | None, *, default: bool, name: str) -> bool:
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ConfigurationError(f"{name} must be a boolean")

"""Environment configuration for the offline MongoDB export command."""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field

DATABASE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class TrainingSourceConfigurationError(ValueError):
    """Raised when offline exporter configuration is missing or unsafe."""


@dataclass(frozen=True, slots=True)
class MongoTrainingSourceSettings:
    mongodb_uri: str = field(repr=False)
    org_id: str
    database_name: str | None = None
    server_selection_timeout_ms: int = 5_000


def load_training_source_settings(
    environ: Mapping[str, str],
) -> MongoTrainingSourceSettings:
    uri = environ.get("TRAINING_MONGODB_URI", "").strip()
    org_id = environ.get("TRAINING_ORG_ID", "").strip()
    database_name_raw = environ.get("TRAINING_MONGODB_DATABASE", "").strip()
    if not uri:
        raise TrainingSourceConfigurationError("TRAINING_MONGODB_URI is required")
    if not uri.startswith(("mongodb://", "mongodb+srv://")):
        raise TrainingSourceConfigurationError(
            "TRAINING_MONGODB_URI must use mongodb:// or mongodb+srv://"
        )
    if not org_id:
        raise TrainingSourceConfigurationError("TRAINING_ORG_ID is required")
    if len(org_id) > 255:
        raise TrainingSourceConfigurationError("TRAINING_ORG_ID is too long")
    database_name = database_name_raw or None
    if database_name is not None and DATABASE_NAME_PATTERN.fullmatch(database_name) is None:
        raise TrainingSourceConfigurationError("TRAINING_MONGODB_DATABASE is invalid")
    timeout_raw = environ.get("TRAINING_MONGODB_TIMEOUT_MS", "5000").strip()
    try:
        timeout = int(timeout_raw)
    except ValueError as error:
        raise TrainingSourceConfigurationError(
            "TRAINING_MONGODB_TIMEOUT_MS must be an integer"
        ) from error
    if not 100 <= timeout <= 60_000:
        raise TrainingSourceConfigurationError(
            "TRAINING_MONGODB_TIMEOUT_MS must be between 100 and 60000"
        )
    return MongoTrainingSourceSettings(
        mongodb_uri=uri,
        org_id=org_id,
        database_name=database_name,
        server_selection_timeout_ms=timeout,
    )

"""Export one tenant's feature-enriched MongoDB events to canonical JSONL."""

from __future__ import annotations

import argparse
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from app.training.exporter import (
    TrainingDatasetExportRequest,
    export_training_dataset,
)
from app.training.source_config import load_training_source_settings


def main() -> int:
    arguments = _parse_arguments()
    settings = load_training_source_settings(os.environ)
    try:
        from pymongo import MongoClient
        from pymongo.errors import ConfigurationError
    except ImportError as error:
        raise SystemExit("PyMongo is required; install requirements-training.txt") from error
    request = TrainingDatasetExportRequest(
        org_id=settings.org_id,
        from_time=_parse_timestamp(arguments.from_time, "--from-time"),
        to_time=_parse_timestamp(arguments.to_time, "--to-time"),
        output_path=arguments.output,
        batch_size=arguments.batch_size,
    )
    mongo_client: MongoClient[dict[str, Any]] = MongoClient(
        settings.mongodb_uri,
        tz_aware=True,
        serverSelectionTimeoutMS=settings.server_selection_timeout_ms,
        appname="trivikrama-offline-training-export",
    )
    with mongo_client as client:
        if settings.database_name is not None:
            database = client[settings.database_name]
        else:
            try:
                database = client.get_default_database()
            except ConfigurationError as error:
                raise SystemExit(
                    "TRAINING_MONGODB_DATABASE is required when the URI has no database"
                ) from error
        result = export_training_dataset(database["normalized_events"], request)

    print(f"dataset={result.dataset_path}")
    print(f"manifest={result.manifest_path}")
    print(f"rows={result.manifest.row_count}")
    print(f"sha256={result.manifest.sha256}")
    return 0


def _parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export a tenant-isolated Trivikrama AI training dataset.",
    )
    parser.add_argument("--from-time", required=True, help="Inclusive ISO-8601 timestamp")
    parser.add_argument("--to-time", required=True, help="Exclusive ISO-8601 timestamp")
    parser.add_argument("--output", required=True, type=Path, help="New .jsonl output path")
    parser.add_argument("--batch-size", type=int, default=5_000)
    return parser.parse_args()


def _parse_timestamp(value: str, argument: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise SystemExit(f"{argument} must be a valid ISO-8601 timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise SystemExit(f"{argument} must include a timezone")
    return parsed


if __name__ == "__main__":
    raise SystemExit(main())

"""Stream feature-enriched MongoDB events into an atomic JSONL export."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from pydantic import ValidationError

from app.core.feature_contract import AI_FEATURE_NAMES
from app.training.contracts import TrainingDatasetManifest, TrainingEventRecord


class DatasetExportError(RuntimeError):
    """Raised when a safe and complete training-data export cannot be produced."""


class MongoCursor(Protocol):
    def sort(self, keys: list[tuple[str, int]]) -> MongoCursor: ...

    def batch_size(self, size: int) -> MongoCursor: ...

    def __iter__(self) -> Iterator[Mapping[str, Any]]: ...


class MongoCollection(Protocol):
    def find(
        self,
        query: Mapping[str, Any],
        projection: Mapping[str, int],
    ) -> MongoCursor: ...


@dataclass(frozen=True, slots=True)
class TrainingDatasetExportRequest:
    org_id: str
    from_time: datetime
    to_time: datetime
    output_path: Path
    batch_size: int = 5_000

    def __post_init__(self) -> None:
        if not self.org_id or self.org_id != self.org_id.strip():
            raise ValueError("org_id must be non-blank and trimmed")
        for name, value in (("from_time", self.from_time), ("to_time", self.to_time)):
            if value.tzinfo is None or value.utcoffset() is None:
                raise ValueError(f"{name} must include a timezone")
        if self.from_time >= self.to_time:
            raise ValueError("from_time must be earlier than to_time")
        if self.output_path.suffix.lower() != ".jsonl":
            raise ValueError("output_path must use the .jsonl extension")
        if self.batch_size < 1 or self.batch_size > 100_000:
            raise ValueError("batch_size must be between 1 and 100000")


@dataclass(frozen=True, slots=True)
class TrainingDatasetExportResult:
    dataset_path: Path
    manifest_path: Path
    manifest: TrainingDatasetManifest


def manifest_path_for(dataset_path: Path) -> Path:
    return dataset_path.with_suffix(".manifest.json")


def export_training_dataset(
    collection: MongoCollection,
    request: TrainingDatasetExportRequest,
    *,
    clock: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> TrainingDatasetExportResult:
    """Create a new dataset and manifest without exposing a partial final file."""

    dataset_path = request.output_path.absolute()
    manifest_path = manifest_path_for(dataset_path)
    dataset_path.parent.mkdir(parents=True, exist_ok=True)
    _require_new_regular_target(dataset_path)
    _require_new_regular_target(manifest_path)

    temporary_dataset: Path | None = None
    temporary_manifest: Path | None = None
    dataset_published = False
    manifest_published = False
    digest = hashlib.sha256()
    row_count = 0
    try:
        cursor = (
            collection.find(
                {
                    "org_id": request.org_id,
                    "time": {"$gte": request.from_time, "$lt": request.to_time},
                    "schema_valid": True,
                    "features": {"$exists": True},
                },
                {
                    "_id": 0,
                    "event_id": 1,
                    "org_id": 1,
                    "time": 1,
                    "class_uid": 1,
                    "features": 1,
                },
            )
            .sort([("time", 1), ("event_id", 1)])
            .batch_size(request.batch_size)
        )

        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=dataset_path.parent,
            prefix=f".{dataset_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as output:
            temporary_dataset = Path(output.name)
            for document in cursor:
                try:
                    record = TrainingEventRecord.model_validate(_select_training_fields(document))
                except ValidationError as error:
                    raise DatasetExportError(
                        f"MongoDB event at export row {row_count + 1} is invalid"
                    ) from error
                if record.org_id != request.org_id:
                    raise DatasetExportError("MongoDB returned an event from another organization")
                if not request.from_time <= record.time < request.to_time:
                    raise DatasetExportError("MongoDB returned an event outside the export window")
                encoded = (
                    json.dumps(
                        record.model_dump(mode="json"),
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ).encode("utf-8")
                    + b"\n"
                )
                output.write(encoded)
                digest.update(encoded)
                row_count += 1
            output.flush()
            os.fsync(output.fileno())

        if row_count == 0:
            raise DatasetExportError("the selected organization and time window contain no events")

        exported_at = clock()
        if exported_at.tzinfo is None or exported_at.utcoffset() is None:
            raise DatasetExportError("export clock must return a timezone-aware datetime")
        manifest = TrainingDatasetManifest(
            dataset_file=dataset_path.name,
            org_id=request.org_id,
            from_time=request.from_time,
            to_time=request.to_time,
            exported_at=exported_at,
            row_count=row_count,
            feature_count=len(AI_FEATURE_NAMES),
            feature_names=list(AI_FEATURE_NAMES),
            sha256=digest.hexdigest(),
        )
        manifest_bytes = (manifest.model_dump_json(indent=2) + "\n").encode("utf-8")
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=manifest_path.parent,
            prefix=f".{manifest_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as output:
            temporary_manifest = Path(output.name)
            output.write(manifest_bytes)
            output.flush()
            os.fsync(output.fileno())

        assert temporary_dataset is not None
        assert temporary_manifest is not None
        _publish_without_overwrite(temporary_dataset, dataset_path)
        temporary_dataset = None
        dataset_published = True
        _publish_without_overwrite(temporary_manifest, manifest_path)
        temporary_manifest = None
        manifest_published = True
        return TrainingDatasetExportResult(dataset_path, manifest_path, manifest)
    except DatasetExportError:
        raise
    except Exception as error:
        raise DatasetExportError("training dataset export failed") from error
    finally:
        for temporary in (temporary_dataset, temporary_manifest):
            if temporary is not None:
                temporary.unlink(missing_ok=True)
        if dataset_published and not manifest_published:
            dataset_path.unlink(missing_ok=True)


def _require_new_regular_target(path: Path) -> None:
    if path.exists() or path.is_symlink():
        raise DatasetExportError(f"refusing to overwrite existing output: {path.name}")


def _publish_without_overwrite(temporary: Path, target: Path) -> None:
    try:
        os.link(temporary, target)
    except FileExistsError as error:
        raise DatasetExportError(f"refusing to overwrite existing output: {target.name}") from error
    temporary.unlink()


def _select_training_fields(document: Mapping[str, Any]) -> dict[str, Any]:
    """Project MongoDB context down to the versioned v1 training contract."""

    raw_features = document.get("features")
    selected_features = (
        {name: raw_features[name] for name in AI_FEATURE_NAMES if name in raw_features}
        if isinstance(raw_features, Mapping)
        else raw_features
    )
    return {
        "event_id": document.get("event_id"),
        "org_id": document.get("org_id"),
        "time": document.get("time"),
        "class_uid": document.get("class_uid"),
        "features": selected_features,
    }

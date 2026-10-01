"""Integrity-check and load a canonical JSONL dataset into a NumPy matrix."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import numpy as np
from numpy.typing import NDArray
from pydantic import ValidationError

from app.core.feature_contract import AI_FEATURE_NAMES, DEFAULT_FEATURE_VALUES
from app.training.contracts import (
    MINIMUM_TIME_SPAN_DAYS,
    MINIMUM_TRAINING_ROWS,
    FeatureQualityStatistics,
    TrainingDatasetManifest,
    TrainingDatasetQualityReport,
    TrainingEventRecord,
)
from app.training.exporter import manifest_path_for


class DatasetLoadError(RuntimeError):
    """Raised when a training dataset is corrupt, incompatible, or unsafe."""


@dataclass(frozen=True, slots=True)
class LoadedTrainingDataset:
    values: NDArray[np.float64]
    manifest: TrainingDatasetManifest
    quality_report: TrainingDatasetQualityReport


class TrainingDatasetLoader:
    """Load one bounded, checksummed v1 dataset in deterministic feature order."""

    def __init__(
        self,
        *,
        max_dataset_bytes: int = 2 * 1024 * 1024 * 1024,
        max_rows: int = 2_000_000,
        max_line_bytes: int = 64 * 1024,
    ) -> None:
        if max_dataset_bytes < 1 or max_rows < 1 or max_line_bytes < 1:
            raise ValueError("dataset loader limits must be positive")
        self._max_dataset_bytes = max_dataset_bytes
        self._max_rows = max_rows
        self._max_line_bytes = max_line_bytes

    def load(
        self,
        dataset_path: Path,
        manifest_path: Path | None = None,
    ) -> LoadedTrainingDataset:
        dataset = dataset_path.absolute()
        manifest_file = (
            manifest_path.absolute() if manifest_path is not None else manifest_path_for(dataset)
        )
        self._require_regular_file(dataset, expected_suffix=".jsonl")
        self._require_regular_file(manifest_file, expected_suffix=".json")
        if dataset.parent != manifest_file.parent:
            raise DatasetLoadError("dataset and manifest must be stored in the same directory")
        if dataset.stat().st_size > self._max_dataset_bytes:
            raise DatasetLoadError("dataset exceeds the configured size limit")
        if manifest_file.stat().st_size > 1024 * 1024:
            raise DatasetLoadError("manifest exceeds the size limit")

        try:
            manifest = TrainingDatasetManifest.model_validate_json(
                manifest_file.read_text(encoding="utf-8")
            )
        except (OSError, UnicodeError, ValidationError) as error:
            raise DatasetLoadError("dataset manifest is invalid") from error
        if manifest.dataset_file != dataset.name:
            raise DatasetLoadError("manifest dataset_file does not match the selected dataset")
        if manifest.row_count > self._max_rows:
            raise DatasetLoadError("dataset row count exceeds the configured limit")

        matrix = np.empty((manifest.row_count, len(AI_FEATURE_NAMES)), dtype=np.float64)
        digest = hashlib.sha256()
        event_ids: set[str] = set()
        class_distribution: Counter[int] = Counter()
        previous_order: tuple[datetime, str] | None = None
        first_event_time: datetime | None = None
        last_event_time: datetime | None = None
        row_index = 0

        try:
            with dataset.open("rb") as source:
                while True:
                    line = source.readline(self._max_line_bytes + 1)
                    if not line:
                        break
                    if len(line) > self._max_line_bytes:
                        raise DatasetLoadError(
                            f"dataset line {row_index + 1} exceeds the size limit"
                        )
                    if not line.endswith(b"\n"):
                        raise DatasetLoadError(
                            f"dataset line {row_index + 1} is not newline terminated"
                        )
                    if row_index >= manifest.row_count:
                        raise DatasetLoadError("dataset contains more rows than its manifest")
                    digest.update(line)
                    try:
                        record = TrainingEventRecord.model_validate_json(line)
                    except ValidationError as error:
                        raise DatasetLoadError(
                            f"dataset line {row_index + 1} violates the v1 contract"
                        ) from error
                    if record.org_id != manifest.org_id:
                        raise DatasetLoadError(
                            f"dataset line {row_index + 1} belongs to another organization"
                        )
                    if not manifest.from_time <= record.time < manifest.to_time:
                        raise DatasetLoadError(
                            f"dataset line {row_index + 1} is outside the manifest window"
                        )
                    if record.event_id in event_ids:
                        raise DatasetLoadError(f"duplicate event_id: {record.event_id}")
                    event_ids.add(record.event_id)
                    order = (record.time, record.event_id)
                    if previous_order is not None and order < previous_order:
                        raise DatasetLoadError("dataset is not ordered by time and event_id")
                    previous_order = order
                    first_event_time = first_event_time or record.time
                    last_event_time = record.time
                    class_distribution[record.class_uid] += 1
                    matrix[row_index] = [record.features[name] for name in AI_FEATURE_NAMES]
                    row_index += 1
        except DatasetLoadError:
            raise
        except (OSError, UnicodeError, json.JSONDecodeError) as error:
            raise DatasetLoadError("dataset could not be read") from error

        if row_index != manifest.row_count:
            raise DatasetLoadError(
                f"manifest declares {manifest.row_count} rows but dataset contains {row_index}"
            )
        if digest.hexdigest() != manifest.sha256:
            raise DatasetLoadError("dataset checksum does not match the manifest")
        if first_event_time is None or last_event_time is None:
            raise DatasetLoadError("dataset is empty")
        if not np.isfinite(matrix).all():
            raise DatasetLoadError("dataset matrix contains NaN or infinite values")

        matrix.setflags(write=False)
        quality_report = _build_quality_report(
            matrix,
            manifest,
            first_event_time,
            last_event_time,
            class_distribution,
        )
        return LoadedTrainingDataset(matrix, manifest, quality_report)

    @staticmethod
    def _require_regular_file(path: Path, *, expected_suffix: str) -> None:
        if path.suffix.lower() != expected_suffix:
            raise DatasetLoadError(f"expected a {expected_suffix} file")
        if path.is_symlink():
            raise DatasetLoadError("symbolic-link dataset files are not allowed")
        if not path.is_file():
            raise DatasetLoadError("required dataset file is unavailable")


def write_quality_report(
    report: TrainingDatasetQualityReport,
    output_path: Path,
) -> Path:
    """Atomically create a quality report without overwriting prior evidence."""

    target = output_path.absolute()
    if target.suffix.lower() != ".json":
        raise DatasetLoadError("quality report output must use the .json extension")
    if target.exists() or target.is_symlink():
        raise DatasetLoadError("refusing to overwrite an existing quality report")
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=target.parent,
            prefix=f".{target.name}.",
            suffix=".tmp",
            delete=False,
        ) as output:
            temporary = Path(output.name)
            output.write((report.model_dump_json(indent=2) + "\n").encode("utf-8"))
            output.flush()
            os.fsync(output.fileno())
        os.link(temporary, target)
        temporary.unlink()
        temporary = None
        return target
    except FileExistsError as error:
        raise DatasetLoadError("refusing to overwrite an existing quality report") from error
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _build_quality_report(
    matrix: NDArray[np.float64],
    manifest: TrainingDatasetManifest,
    first_event_time: datetime,
    last_event_time: datetime,
    class_distribution: Counter[int],
) -> TrainingDatasetQualityReport:
    feature_statistics: dict[str, FeatureQualityStatistics] = {}
    warnings: list[str] = []
    for index, name in enumerate(AI_FEATURE_NAMES):
        values = matrix[:, index]
        percentiles = np.percentile(values, [1, 50, 95, 99])
        feature_statistics[name] = FeatureQualityStatistics(
            minimum=float(np.min(values)),
            maximum=float(np.max(values)),
            mean=float(np.mean(values)),
            standard_deviation=float(np.std(values)),
            p01=float(percentiles[0]),
            p50=float(percentiles[1]),
            p95=float(percentiles[2]),
            p99=float(percentiles[3]),
            default_rate=float(np.mean(np.isclose(values, DEFAULT_FEATURE_VALUES[name]))),
        )
        if feature_statistics[name].default_rate >= 0.95:
            warnings.append(f"{name} equals its neutral default in at least 95% of rows")
    time_span_days = max(
        0.0,
        (last_event_time - first_event_time).total_seconds() / 86_400.0,
    )
    if manifest.row_count < MINIMUM_TRAINING_ROWS:
        warnings.append(f"dataset has fewer than the recommended {MINIMUM_TRAINING_ROWS} rows")
    if time_span_days < MINIMUM_TIME_SPAN_DAYS:
        warnings.append(
            f"dataset covers fewer than the recommended {MINIMUM_TIME_SPAN_DAYS:g} days"
        )
    return TrainingDatasetQualityReport(
        dataset_sha256=manifest.sha256,
        org_id=manifest.org_id,
        row_count=manifest.row_count,
        first_event_time=first_event_time,
        last_event_time=last_event_time,
        time_span_days=time_span_days,
        minimum_sample_requirement_met=manifest.row_count >= MINIMUM_TRAINING_ROWS,
        minimum_time_span_requirement_met=time_span_days >= MINIMUM_TIME_SPAN_DAYS,
        warnings=warnings,
        class_distribution={
            str(class_uid): count for class_uid, count in sorted(class_distribution.items())
        },
        feature_statistics=feature_statistics,
    )

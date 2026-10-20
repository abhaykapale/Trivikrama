"""Deterministic, clearly labelled simulated data for end-to-end demonstrations."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np

from app.core.feature_contract import AI_FEATURE_NAMES
from app.training.contracts import TrainingDatasetManifest, TrainingEventRecord
from app.training.exporter import manifest_path_for

SIMULATED_DATA_GENERATOR_VERSION = "trivikrama-simulated-v1"


class SimulatedDatasetError(RuntimeError):
    """Raised when a simulated dataset cannot be published safely."""


@dataclass(frozen=True, slots=True)
class SimulatedDatasetRequest:
    output_path: Path
    org_id: str = "trivikrama-simulated-demo"
    row_count: int = 10_000
    span_days: float = 8.0
    anomaly_fraction: float = 0.02
    random_seed: int = 42
    start_time: datetime = datetime(2026, 8, 1, tzinfo=UTC)

    def __post_init__(self) -> None:
        if self.output_path.suffix.lower() != ".jsonl":
            raise ValueError("output_path must use the .jsonl extension")
        if not self.org_id or self.org_id != self.org_id.strip():
            raise ValueError("org_id must be non-blank and trimmed")
        if self.row_count < 10:
            raise ValueError("row_count must be at least 10")
        if self.span_days <= 0.0:
            raise ValueError("span_days must be positive")
        if not 0.0 <= self.anomaly_fraction <= 0.05:
            raise ValueError("anomaly_fraction must be between 0 and 0.05")
        if self.start_time.tzinfo is None or self.start_time.utcoffset() is None:
            raise ValueError("start_time must include a timezone")


@dataclass(frozen=True, slots=True)
class SimulatedDatasetResult:
    dataset_path: Path
    manifest_path: Path
    manifest: TrainingDatasetManifest
    simulated_anomaly_rows: int


def generate_simulated_dataset(
    request: SimulatedDatasetRequest,
    *,
    clock: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> SimulatedDatasetResult:
    """Create an atomic v1 dataset with reproducible predominantly normal traffic."""

    dataset_path = request.output_path.absolute()
    manifest_path = manifest_path_for(dataset_path)
    dataset_path.parent.mkdir(parents=True, exist_ok=True)
    for target in (dataset_path, manifest_path):
        if target.exists() or target.is_symlink():
            raise SimulatedDatasetError(f"refusing to overwrite existing output: {target.name}")

    rng = np.random.default_rng(request.random_seed)
    anomaly_count = round(request.row_count * request.anomaly_fraction)
    anomaly_indices = set(
        int(value) for value in rng.choice(request.row_count, size=anomaly_count, replace=False)
    )
    span = timedelta(days=request.span_days)
    last_time = request.start_time + span
    digest = hashlib.sha256()
    temporary_dataset: Path | None = None
    temporary_manifest: Path | None = None
    dataset_published = False
    manifest_published = False
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=dataset_path.parent,
            prefix=f".{dataset_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as output:
            temporary_dataset = Path(output.name)
            for index in range(request.row_count):
                timestamp = request.start_time + span * (index / (request.row_count - 1))
                record = TrainingEventRecord(
                    event_id=f"simulated-{index + 1:08d}",
                    org_id=request.org_id,
                    time=timestamp,
                    class_uid=_class_uid(rng),
                    features=_feature_values(
                        rng,
                        timestamp,
                        is_anomaly=index in anomaly_indices,
                    ),
                )
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
            output.flush()
            os.fsync(output.fileno())

        exported_at = clock()
        if exported_at.tzinfo is None or exported_at.utcoffset() is None:
            raise SimulatedDatasetError("generator clock must return a timezone-aware datetime")
        manifest = TrainingDatasetManifest(
            dataset_origin="simulated",
            generator_version=SIMULATED_DATA_GENERATOR_VERSION,
            dataset_file=dataset_path.name,
            org_id=request.org_id,
            from_time=request.start_time,
            to_time=last_time + timedelta(seconds=1),
            exported_at=exported_at,
            row_count=request.row_count,
            feature_count=len(AI_FEATURE_NAMES),
            feature_names=list(AI_FEATURE_NAMES),
            sha256=digest.hexdigest(),
        )
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=manifest_path.parent,
            prefix=f".{manifest_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as output:
            temporary_manifest = Path(output.name)
            output.write((manifest.model_dump_json(indent=2) + "\n").encode("utf-8"))
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
        return SimulatedDatasetResult(
            dataset_path=dataset_path,
            manifest_path=manifest_path,
            manifest=manifest,
            simulated_anomaly_rows=anomaly_count,
        )
    except SimulatedDatasetError:
        raise
    except Exception as error:
        raise SimulatedDatasetError("simulated dataset generation failed") from error
    finally:
        for temporary in (temporary_dataset, temporary_manifest):
            if temporary is not None:
                temporary.unlink(missing_ok=True)
        if dataset_published and not manifest_published:
            dataset_path.unlink(missing_ok=True)


def representative_normal_features() -> dict[str, float]:
    return {
        "hour_of_day": 11.0,
        "day_of_week": 2.0,
        "is_business_hours": 1.0,
        "time_since_last_event": 45.0,
        "time_deviation_score": 0.1,
        "events_per_minute_src_ip": 2.0,
        "events_per_hour_user": 18.0,
        "unique_dst_ips_per_src": 3.0,
        "unique_users_per_src_ip": 1.0,
        "frequency_deviation": 0.2,
        "src_ip_entropy": 2.0,
        "username_entropy": 1.5,
        "process_name_entropy": 2.2,
        "bytes_sent": 1500.0,
        "bytes_received": 6000.0,
        "bytes_ratio": 0.25,
        "severity_id": 1.0,
        "failed_login_count_10min": 0.0,
        "failed_to_success_ratio": 0.0,
        "new_source_ip": 0.0,
    }


def representative_anomalous_features() -> dict[str, float]:
    return {
        "hour_of_day": 3.0,
        "day_of_week": 6.0,
        "is_business_hours": 0.0,
        "time_since_last_event": 86_400.0,
        "time_deviation_score": 15.0,
        "events_per_minute_src_ip": 500.0,
        "events_per_hour_user": 2000.0,
        "unique_dst_ips_per_src": 500.0,
        "unique_users_per_src_ip": 100.0,
        "frequency_deviation": 20.0,
        "src_ip_entropy": 8.0,
        "username_entropy": 8.0,
        "process_name_entropy": 8.0,
        "bytes_sent": 100_000_000.0,
        "bytes_received": 100.0,
        "bytes_ratio": 1_000_000.0,
        "severity_id": 6.0,
        "failed_login_count_10min": 250.0,
        "failed_to_success_ratio": 1.0,
        "new_source_ip": 1.0,
    }


def _feature_values(
    rng: np.random.Generator,
    timestamp: datetime,
    *,
    is_anomaly: bool,
) -> dict[str, float]:
    business_hours = timestamp.weekday() < 5 and 8 <= timestamp.hour < 18
    sent = float(rng.lognormal(mean=7.2, sigma=0.8))
    received = float(rng.lognormal(mean=8.0, sigma=0.9))
    values = {
        "hour_of_day": float(timestamp.hour),
        "day_of_week": float(timestamp.weekday()),
        "is_business_hours": float(business_hours),
        "time_since_last_event": float(rng.exponential(60.0)),
        "time_deviation_score": float(abs(rng.normal(0.0, 0.7))),
        "events_per_minute_src_ip": float(rng.poisson(2.0)),
        "events_per_hour_user": float(rng.poisson(20.0)),
        "unique_dst_ips_per_src": float(max(1, rng.poisson(3.0))),
        "unique_users_per_src_ip": float(max(1, rng.poisson(1.0))),
        "frequency_deviation": float(abs(rng.normal(0.0, 0.8))),
        "src_ip_entropy": float(rng.uniform(0.5, 4.0)),
        "username_entropy": float(rng.uniform(0.2, 3.5)),
        "process_name_entropy": float(rng.uniform(0.5, 4.5)),
        "bytes_sent": sent,
        "bytes_received": received,
        "bytes_ratio": sent / max(received, 1.0),
        "severity_id": float(rng.choice([0, 1, 2, 3], p=[0.1, 0.65, 0.2, 0.05])),
        "failed_login_count_10min": float(rng.poisson(0.3)),
        "failed_to_success_ratio": float(rng.beta(1.0, 15.0)),
        "new_source_ip": float(rng.random() < 0.03),
    }
    if is_anomaly:
        values.update(
            {
                "time_deviation_score": float(rng.uniform(5.0, 12.0)),
                "events_per_minute_src_ip": float(rng.integers(60, 180)),
                "events_per_hour_user": float(rng.integers(300, 900)),
                "frequency_deviation": float(rng.uniform(8.0, 18.0)),
                "bytes_sent": float(rng.uniform(1_000_000, 20_000_000)),
                "severity_id": float(rng.integers(4, 7)),
                "failed_login_count_10min": float(rng.integers(25, 100)),
                "failed_to_success_ratio": float(rng.uniform(0.75, 1.0)),
                "new_source_ip": 1.0,
            }
        )
        values["bytes_ratio"] = values["bytes_sent"] / max(values["bytes_received"], 1.0)
    return values


def _class_uid(rng: np.random.Generator) -> int:
    return int(rng.choice([3002, 4001, 1007], p=[0.45, 0.4, 0.15]))


def _publish_without_overwrite(temporary: Path, target: Path) -> None:
    try:
        os.link(temporary, target)
    except FileExistsError as error:
        raise SimulatedDatasetError(
            f"refusing to overwrite existing output: {target.name}"
        ) from error
    temporary.unlink()

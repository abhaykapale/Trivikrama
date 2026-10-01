"""Thread-safe process-local state exposed through operational endpoints."""

from __future__ import annotations

from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from math import ceil
from threading import Lock
from time import monotonic


@dataclass(frozen=True, slots=True)
class RuntimeSnapshot:
    model_loaded: bool
    model_version: str | None
    uptime_seconds: float
    total_predictions: int
    avg_latency_ms: float
    p99_latency_ms: float
    errors_total: int
    total_requests: int
    total_events_processed: int
    total_anomalies_detected: int
    avg_batch_size: float
    p50_latency_ms: float
    p95_latency_ms: float
    error_rate: float
    total_explanations: int
    avg_explanation_ms: float
    model_threshold: float | None
    model_loaded_at: datetime | None


class RuntimeState:
    """Owns mutable state for one AI Engine process.

    The lock makes snapshots internally consistent if synchronous inference
    workers update counters concurrently in a later milestone.
    """

    def __init__(
        self,
        clock: Callable[[], float] = monotonic,
        wall_clock: Callable[[], datetime] | None = None,
        *,
        latency_window_size: int = 10_000,
    ) -> None:
        if latency_window_size < 1:
            raise ValueError("latency_window_size must be positive")
        self._clock = clock
        self._wall_clock = wall_clock or (lambda: datetime.now(UTC))
        self._started_at = clock()
        self._lock = Lock()
        self._model_loaded = False
        self._model_version: str | None = None
        self._model_threshold: float | None = None
        self._model_loaded_at: datetime | None = None
        self._total_requests = 0
        self._total_events_processed = 0
        self._total_anomalies_detected = 0
        self._total_latency_ms = 0.0
        self._latencies_ms: deque[float] = deque(maxlen=latency_window_size)
        self._errors_total = 0
        self._total_explanations = 0
        self._total_explanation_ms = 0.0

    def mark_model_loaded(self, version: str, *, threshold: float | None = None) -> None:
        normalized_version = version.strip()
        if not normalized_version:
            raise ValueError("model version must not be blank")
        if threshold is not None and not 0.0 <= threshold <= 1.0:
            raise ValueError("model threshold must be between 0 and 1")
        loaded_at = self._wall_clock()
        if loaded_at.tzinfo is None:
            raise ValueError("wall clock must return a timezone-aware datetime")
        with self._lock:
            self._model_loaded = True
            self._model_version = normalized_version
            self._model_threshold = threshold
            self._model_loaded_at = loaded_at

    def mark_model_unloaded(self) -> None:
        with self._lock:
            self._model_loaded = False
            self._model_version = None
            self._model_threshold = None
            self._model_loaded_at = None

    def record_prediction(
        self,
        latency_ms: float,
        *,
        failed: bool = False,
        events_processed: int = 1,
        anomalies_detected: int = 0,
    ) -> None:
        if latency_ms < 0:
            raise ValueError("prediction latency must not be negative")
        if events_processed < 0:
            raise ValueError("events_processed must not be negative")
        if anomalies_detected < 0 or anomalies_detected > events_processed:
            raise ValueError("anomalies_detected must be between 0 and events_processed")
        with self._lock:
            self._total_requests += 1
            self._total_events_processed += events_processed
            self._total_anomalies_detected += anomalies_detected
            self._total_latency_ms += latency_ms
            self._latencies_ms.append(latency_ms)
            if failed:
                self._errors_total += 1

    def record_explanation(self, latency_ms: float) -> None:
        if latency_ms < 0:
            raise ValueError("explanation latency must not be negative")
        with self._lock:
            self._total_explanations += 1
            self._total_explanation_ms += latency_ms

    def snapshot(self) -> RuntimeSnapshot:
        with self._lock:
            total_requests = self._total_requests
            average = self._total_latency_ms / total_requests if total_requests else 0.0
            latencies = list(self._latencies_ms)
            p50 = _nearest_rank_percentile(latencies, 0.50)
            p95 = _nearest_rank_percentile(latencies, 0.95)
            p99 = _nearest_rank_percentile(latencies, 0.99)
            return RuntimeSnapshot(
                model_loaded=self._model_loaded,
                model_version=self._model_version,
                uptime_seconds=max(0.0, self._clock() - self._started_at),
                # Preserve the original health contract: this counts inference
                # attempts, while /metrics exposes the separate event total.
                total_predictions=total_requests,
                avg_latency_ms=average,
                p99_latency_ms=p99,
                errors_total=self._errors_total,
                total_requests=total_requests,
                total_events_processed=self._total_events_processed,
                total_anomalies_detected=self._total_anomalies_detected,
                avg_batch_size=(
                    self._total_events_processed / total_requests if total_requests else 0.0
                ),
                p50_latency_ms=p50,
                p95_latency_ms=p95,
                error_rate=(self._errors_total / total_requests if total_requests else 0.0),
                total_explanations=self._total_explanations,
                avg_explanation_ms=(
                    self._total_explanation_ms / self._total_explanations
                    if self._total_explanations
                    else 0.0
                ),
                model_threshold=self._model_threshold,
                model_loaded_at=self._model_loaded_at,
            )


def _nearest_rank_percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = max(1, ceil(len(ordered) * percentile))
    return ordered[min(rank - 1, len(ordered) - 1)]

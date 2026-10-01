"""Canonical v1 feature contract shared by preprocessing and model metadata."""

from __future__ import annotations

from types import MappingProxyType
from typing import Final

# Ordering is part of the model contract. A reordering requires a new model.
AI_FEATURE_NAMES: Final[tuple[str, ...]] = (
    "hour_of_day",
    "day_of_week",
    "is_business_hours",
    "time_since_last_event",
    "time_deviation_score",
    "events_per_minute_src_ip",
    "events_per_hour_user",
    "unique_dst_ips_per_src",
    "unique_users_per_src_ip",
    "frequency_deviation",
    "src_ip_entropy",
    "username_entropy",
    "process_name_entropy",
    "bytes_sent",
    "bytes_received",
    "bytes_ratio",
    "severity_id",
    "failed_login_count_10min",
    "failed_to_success_ratio",
    "new_source_ip",
)

# These four values describe every event and must be supplied by the backend.
REQUIRED_FEATURE_NAMES: Final[frozenset[str]] = frozenset(
    {"hour_of_day", "day_of_week", "is_business_hours", "severity_id"}
)

# The model artifact may override these values. In particular,
# time_since_last_event should become the training-set median.
DEFAULT_FEATURE_VALUES = MappingProxyType(
    {
        "hour_of_day": 12.0,
        "day_of_week": 2.0,
        "is_business_hours": 1.0,
        "time_since_last_event": 0.0,
        "time_deviation_score": 0.0,
        "events_per_minute_src_ip": 0.0,
        "events_per_hour_user": 0.0,
        "unique_dst_ips_per_src": 1.0,
        "unique_users_per_src_ip": 1.0,
        "frequency_deviation": 0.0,
        "src_ip_entropy": 0.0,
        "username_entropy": 0.0,
        "process_name_entropy": 0.0,
        "bytes_sent": 0.0,
        "bytes_received": 0.0,
        "bytes_ratio": 1.0,
        "severity_id": 0.0,
        "failed_login_count_10min": 0.0,
        "failed_to_success_ratio": 0.0,
        "new_source_ip": 0.0,
    }
)

# None means that side is intentionally unbounded. Bounds come from the
# architecture contract and are applied before scaling.
FEATURE_BOUNDS = MappingProxyType(
    {
        "hour_of_day": (0.0, 23.0),
        "day_of_week": (0.0, 6.0),
        "is_business_hours": (0.0, 1.0),
        "time_since_last_event": (0.0, None),
        "time_deviation_score": (None, None),
        "events_per_minute_src_ip": (0.0, None),
        "events_per_hour_user": (0.0, None),
        "unique_dst_ips_per_src": (0.0, None),
        "unique_users_per_src_ip": (0.0, None),
        "frequency_deviation": (None, None),
        "src_ip_entropy": (0.0, 8.0),
        "username_entropy": (0.0, 8.0),
        "process_name_entropy": (0.0, 8.0),
        "bytes_sent": (0.0, None),
        "bytes_received": (0.0, None),
        "bytes_ratio": (0.0, None),
        "severity_id": (0.0, 6.0),
        "failed_login_count_10min": (0.0, None),
        "failed_to_success_ratio": (0.0, 1.0),
        "new_source_ip": (0.0, 1.0),
    }
)

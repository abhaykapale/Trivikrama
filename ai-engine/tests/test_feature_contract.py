from __future__ import annotations

import unittest

from pydantic import ValidationError

from app.core.feature_contract import AI_FEATURE_NAMES, DEFAULT_FEATURE_VALUES
from app.schemas.detection import DetectionRequest, FeatureValues


class FeatureContractTests(unittest.TestCase):
    def test_contract_matches_the_backend_v1_order(self) -> None:
        self.assertEqual(
            AI_FEATURE_NAMES,
            (
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
            ),
        )
        self.assertEqual(set(DEFAULT_FEATURE_VALUES), set(AI_FEATURE_NAMES))

    def test_accepts_optional_missing_values_and_contextual_features(self) -> None:
        features = FeatureValues.model_validate(
            {
                "hour_of_day": 3,
                "day_of_week": 6,
                "is_business_hours": 0,
                "severity_id": 4,
                "process_rarity_score": 0.8,
            }
        )

        self.assertIsNone(features.bytes_sent)
        self.assertEqual(features.model_extra, {"process_rarity_score": 0.8})

    def test_rejects_missing_fundamental_features(self) -> None:
        with self.assertRaises(ValidationError):
            FeatureValues.model_validate(
                {
                    "day_of_week": 1,
                    "is_business_hours": 1,
                    "severity_id": 2,
                }
            )

    def test_rejects_string_coercion_and_oversized_batches(self) -> None:
        with self.assertRaises(ValidationError):
            FeatureValues.model_validate(
                {
                    "hour_of_day": "3",
                    "day_of_week": 1,
                    "is_business_hours": 1,
                    "severity_id": 2,
                }
            )

        event = {
            "event_id": "event-1",
            "features": {
                "hour_of_day": 3,
                "day_of_week": 1,
                "is_business_hours": 0,
                "severity_id": 2,
            },
        }
        with self.assertRaises(ValidationError):
            DetectionRequest.model_validate({"events": [event] * 101})


if __name__ == "__main__":
    unittest.main()

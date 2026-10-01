from __future__ import annotations

import unittest

from app.training.source_config import (
    TrainingSourceConfigurationError,
    load_training_source_settings,
)


class TrainingSourceConfigurationTests(unittest.TestCase):
    def test_loads_explicit_tenant_scoped_source_without_exposing_uri_in_repr(self) -> None:
        settings = load_training_source_settings(
            {
                "TRAINING_MONGODB_URI": "mongodb://user:secret@localhost:27017/trivikrama",
                "TRAINING_ORG_ID": "org-1",
                "TRAINING_MONGODB_DATABASE": "trivikrama",
                "TRAINING_MONGODB_TIMEOUT_MS": "2500",
            }
        )

        self.assertEqual(settings.org_id, "org-1")
        self.assertEqual(settings.database_name, "trivikrama")
        self.assertEqual(settings.server_selection_timeout_ms, 2500)
        self.assertNotIn("secret", repr(settings))

    def test_rejects_missing_invalid_and_unbounded_settings(self) -> None:
        cases = [
            {},
            {"TRAINING_MONGODB_URI": "https://localhost", "TRAINING_ORG_ID": "org"},
            {"TRAINING_MONGODB_URI": "mongodb://localhost", "TRAINING_ORG_ID": ""},
            {
                "TRAINING_MONGODB_URI": "mongodb://localhost",
                "TRAINING_ORG_ID": "org",
                "TRAINING_MONGODB_DATABASE": "bad/name",
            },
            {
                "TRAINING_MONGODB_URI": "mongodb://localhost",
                "TRAINING_ORG_ID": "org",
                "TRAINING_MONGODB_TIMEOUT_MS": "999999",
            },
        ]
        for environ in cases:
            with self.subTest(environ=environ), self.assertRaises(TrainingSourceConfigurationError):
                load_training_source_settings(environ)


if __name__ == "__main__":
    unittest.main()

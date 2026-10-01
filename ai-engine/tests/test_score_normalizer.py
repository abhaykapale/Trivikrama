from __future__ import annotations

import unittest

import numpy as np

from app.core.score_normalizer import (
    ScoreNormalizationError,
    ScoreNormalizer,
    anomaly_confidence,
)


class ScoreNormalizerTests(unittest.TestCase):
    def test_clips_scales_and_inverts_isolation_forest_scores(self) -> None:
        normalizer = ScoreNormalizer(raw_score_min=-0.5, raw_score_max=0.5)

        result = normalizer.normalize([-1.0, -0.5, 0.0, 0.5, 1.0])

        np.testing.assert_allclose(result, [1.0, 1.0, 0.5, 0.0, 0.0])

    def test_rejects_invalid_bounds_and_score_arrays(self) -> None:
        with self.assertRaisesRegex(ScoreNormalizationError, "greater"):
            ScoreNormalizer(raw_score_min=0.5, raw_score_max=0.5)
        with self.assertRaisesRegex(ScoreNormalizationError, "finite"):
            ScoreNormalizer(raw_score_min=float("nan"), raw_score_max=0.5)

        normalizer = ScoreNormalizer(raw_score_min=-0.5, raw_score_max=0.5)
        with self.assertRaisesRegex(ScoreNormalizationError, "one-dimensional"):
            normalizer.normalize([[0.0]])
        with self.assertRaisesRegex(ScoreNormalizationError, "finite"):
            normalizer.normalize([float("inf")])

    def test_confidence_is_half_at_the_boundary_and_symmetric(self) -> None:
        self.assertEqual(anomaly_confidence(0.65, 0.65), 0.5)
        self.assertEqual(
            anomaly_confidence(0.55, 0.65),
            anomaly_confidence(0.75, 0.65),
        )
        self.assertGreater(anomaly_confidence(1.0, 0.65), 0.5)


if __name__ == "__main__":
    unittest.main()

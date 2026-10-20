from __future__ import annotations

import unittest

import numpy as np

from app.training.thresholds import ThresholdSelectionError, select_percentile_threshold


class ThresholdSelectionTests(unittest.TestCase):
    def test_selects_rounded_percentile(self) -> None:
        scores = np.linspace(0.0, 1.0, 101)

        self.assertEqual(select_percentile_threshold(scores), 0.95)

    def test_rejects_invalid_percentile_shape_range_and_finiteness(self) -> None:
        cases: tuple[tuple[list[float] | list[list[float]], float], ...] = (
            ([], 95.0),
            ([[0.1, 0.2]], 95.0),
            ([0.1, 1.1], 95.0),
            ([0.1, float("nan")], 95.0),
            ([0.1], 0.0),
            ([0.1], 100.0),
        )
        for scores, percentile in cases:
            with (
                self.subTest(scores=scores, percentile=percentile),
                self.assertRaises(ThresholdSelectionError),
            ):
                select_percentile_threshold(scores, percentile=percentile)


if __name__ == "__main__":
    unittest.main()

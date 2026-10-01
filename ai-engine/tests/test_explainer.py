from __future__ import annotations

import unittest
from importlib.util import find_spec
from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray
from sklearn.ensemble import IsolationForest

from app.core.explainer import (
    ShapExplanationError,
    TreeShapExplanationProvider,
    build_tree_shap_explanation_provider,
)
from app.core.feature_contract import AI_FEATURE_NAMES


class FakeTreeShapBackend:
    def __init__(self, values: ArrayLike, expected_value: object = 4.0) -> None:
        self._values = values
        self.expected_value = expected_value
        self.received: NDArray[np.float64] | None = None

    def shap_values(
        self,
        values: NDArray[np.float64],
        *,
        check_additivity: bool = True,
    ) -> ArrayLike:
        self.received = values.copy()
        return self._values


class FailingTreeShapBackend(FakeTreeShapBackend):
    def shap_values(
        self,
        values: NDArray[np.float64],
        *,
        check_additivity: bool = True,
    ) -> Any:
        raise RuntimeError("private backend failure")


class TreeShapExplanationProviderTests(unittest.TestCase):
    def test_reverses_direction_sorts_and_keeps_display_values(self) -> None:
        backend = FakeTreeShapBackend([[0.1, -0.8, 0.3]])
        provider = TreeShapExplanationProvider(backend, ["first", "second", "third"])

        explanation = provider.explain(
            np.asarray([[10.0, 20.0, 30.0]]),
            np.asarray([[1.0, 2.0, 3.0]]),
        )

        self.assertEqual(explanation.base_value, -4.0)
        self.assertEqual(
            [feature.name for feature in explanation.features],
            ["second", "third", "first"],
        )
        self.assertEqual(
            [feature.value for feature in explanation.features],
            [2.0, 3.0, 1.0],
        )
        self.assertEqual(
            [feature.shap_value for feature in explanation.features],
            [0.8, -0.3, -0.1],
        )
        assert backend.received is not None
        np.testing.assert_allclose(backend.received, [[10.0, 20.0, 30.0]])

    def test_rejects_invalid_shapes_and_nonfinite_output(self) -> None:
        provider = TreeShapExplanationProvider(
            FakeTreeShapBackend([[0.1, 0.2]]),
            ["first", "second"],
        )
        with self.assertRaisesRegex(ShapExplanationError, "shape"):
            provider.explain(np.ones((2, 2)), np.ones((2, 2)))

        nonfinite = TreeShapExplanationProvider(
            FakeTreeShapBackend([[0.1, float("nan")]]),
            ["first", "second"],
        )
        with self.assertRaisesRegex(ShapExplanationError, "NaN"):
            nonfinite.explain(np.ones((1, 2)), np.ones((1, 2)))

    def test_wraps_backend_errors_without_exposing_details(self) -> None:
        provider = TreeShapExplanationProvider(
            FailingTreeShapBackend([[0.1]]),
            ["first"],
        )

        with self.assertRaisesRegex(ShapExplanationError, "evaluation failed"):
            provider.explain(np.ones((1, 1)), np.ones((1, 1)))

    @unittest.skipUnless(find_spec("shap"), "SHAP is not installed")
    def test_builds_the_real_tree_explainer_for_isolation_forest(self) -> None:
        random = np.random.default_rng(42)
        training = random.normal(size=(64, len(AI_FEATURE_NAMES)))
        model = IsolationForest(n_estimators=10, random_state=42).fit(training)
        provider = build_tree_shap_explanation_provider(model, AI_FEATURE_NAMES)

        explanation = provider.explain(training[:1], training[:1])

        self.assertEqual(len(explanation.features), len(AI_FEATURE_NAMES))
        magnitudes = [abs(feature.shap_value) for feature in explanation.features]
        self.assertEqual(magnitudes, sorted(magnitudes, reverse=True))


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

import numpy as np
from numpy.typing import NDArray

from app.core.explainer import ShapExplanation, ShapFeatureContribution
from app.core.feature_contract import AI_FEATURE_NAMES
from app.training.proof import EndToEndAiProofRequest, run_end_to_end_ai_proof


class StubExplanationProvider:
    def explain(
        self,
        scaled_values: NDArray[np.float64],
        display_values: NDArray[np.float64],
    ) -> ShapExplanation:
        del scaled_values
        return ShapExplanation(
            base_value=-1.0,
            features=tuple(
                ShapFeatureContribution(
                    name=name,
                    value=float(display_values[0, index]),
                    shap_value=float(1.0 / (index + 1)),
                )
                for index, name in enumerate(AI_FEATURE_NAMES)
            ),
        )


class EndToEndAiProofTests(unittest.TestCase):
    @patch(
        "app.training.proof.build_tree_shap_explanation_provider",
        return_value=StubExplanationProvider(),
    )
    @patch(
        "app.training.trainer.build_tree_shap_explanation_provider",
        return_value=StubExplanationProvider(),
    )
    def test_generates_complete_simulated_evidence(self, _: object, __: object) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            result = run_end_to_end_ai_proof(
                EndToEndAiProofRequest(
                    output_directory=Path(temporary_directory) / "proof",
                    version="v20261010_010203",
                ),
                clock=lambda: datetime(2026, 10, 10, 1, 2, 3, tzinfo=UTC),
            )

            self.assertTrue(result.report.proof_passed)
            self.assertEqual(result.report.evidence_classification, "simulated-demonstration")
            self.assertEqual(result.report.dataset_rows, 10_000)
            self.assertEqual(result.report.dataset_time_span_days, 8.0)
            self.assertTrue(result.report.runtime_bundle_loaded)
            self.assertFalse(result.report.trained_model_production_eligible)
            self.assertTrue(result.report.predictions[1].is_anomaly)
            self.assertGreater(
                result.report.predictions[1].anomaly_score,
                result.report.predictions[0].anomaly_score,
            )
            self.assertEqual(len(result.report.anomalous_event_top_shap), 5)
            self.assertTrue(result.report_path.is_file())


if __name__ == "__main__":
    unittest.main()

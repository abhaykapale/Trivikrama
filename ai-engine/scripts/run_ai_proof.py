"""Run the complete simulated-data AI training and inference proof."""

from __future__ import annotations

import argparse
from pathlib import Path

from app.training.proof import EndToEndAiProofRequest, run_end_to_end_ai_proof


def main() -> int:
    arguments = _parse_arguments()
    result = run_end_to_end_ai_proof(
        EndToEndAiProofRequest(
            output_directory=arguments.output_directory,
            version=arguments.version,
            rows=arguments.rows,
            span_days=arguments.span_days,
            random_seed=arguments.seed,
        )
    )
    print("evidence_classification=simulated-demonstration")
    print(f"proof_passed={str(result.report.proof_passed).lower()}")
    print(f"dataset_rows={result.report.dataset_rows}")
    print(f"dataset_time_span_days={result.report.dataset_time_span_days:.6f}")
    print(f"model_version={result.report.model_version}")
    print(f"threshold={result.report.threshold:.4f}")
    for prediction in result.report.predictions:
        print(
            f"prediction={prediction.event_id},score={prediction.anomaly_score:.6f},"
            f"is_anomaly={str(prediction.is_anomaly).lower()}"
        )
    print(f"report={result.report_path}")
    print(f"models_directory={result.models_directory}")
    return 0


def _parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create reproducible simulated evidence for the complete AI pipeline.",
    )
    parser.add_argument("--output-directory", required=True, type=Path)
    parser.add_argument("--version", help="Optional immutable vYYYYMMDD_HHMMSS model version")
    parser.add_argument("--rows", type=int, default=10_000)
    parser.add_argument("--span-days", type=float, default=8.0)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())

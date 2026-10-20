"""Train and publish a versioned Isolation Forest model bundle."""

from __future__ import annotations

import argparse
from pathlib import Path

from app.training.trainer import ModelTrainingRequest, train_and_publish_model


def main() -> int:
    arguments = _parse_arguments()
    result = train_and_publish_model(
        ModelTrainingRequest(
            dataset_path=arguments.dataset,
            manifest_path=arguments.manifest,
            models_dir=arguments.models_dir,
            version=arguments.version,
            holdout_fraction=arguments.holdout_fraction,
            threshold_percentile=arguments.threshold_percentile,
            allow_insufficient_data=arguments.allow_insufficient_data,
        )
    )
    print(f"version={result.version}")
    print(f"training_samples={result.report.training_samples}")
    print(f"holdout_samples={result.report.holdout_samples}")
    print(f"threshold={result.report.threshold:.4f}")
    print(f"production_eligible={str(result.report.production_eligible).lower()}")
    print(f"model_directory={result.version_directory}")
    print(f"registry={result.registry_path}")
    return 0


def _parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train and atomically publish a Trivikrama Isolation Forest bundle.",
    )
    parser.add_argument("--dataset", required=True, type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--models-dir", type=Path, default=Path("models"))
    parser.add_argument("--version", help="Optional immutable vYYYYMMDD_HHMMSS version")
    parser.add_argument("--holdout-fraction", type=float, default=0.2)
    parser.add_argument("--threshold-percentile", type=float, default=95.0)
    parser.add_argument(
        "--allow-insufficient-data",
        action="store_true",
        help="Create a development-only bundle when 10000 rows or 7 days are unavailable",
    )
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())

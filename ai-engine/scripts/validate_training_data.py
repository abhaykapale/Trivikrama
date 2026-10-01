"""Validate a canonical dataset and emit its quality report."""

from __future__ import annotations

import argparse
from pathlib import Path

from app.training.loader import TrainingDatasetLoader, write_quality_report


def main() -> int:
    arguments = _parse_arguments()
    loaded = TrainingDatasetLoader().load(arguments.dataset, arguments.manifest)
    output = arguments.output or arguments.dataset.with_suffix(".quality.json")
    report_path = write_quality_report(loaded.quality_report, output)
    print(f"rows={loaded.manifest.row_count}")
    print(f"shape={loaded.values.shape}")
    print(f"quality_report={report_path}")
    return 0


def _parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate a Trivikrama AI training dataset and report quality.",
    )
    parser.add_argument("--dataset", required=True, type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())

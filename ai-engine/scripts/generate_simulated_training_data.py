"""Generate a deterministic demonstration dataset under the production contract."""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path

from app.training.synthetic import SimulatedDatasetRequest, generate_simulated_dataset


def main() -> int:
    arguments = _parse_arguments()
    result = generate_simulated_dataset(
        SimulatedDatasetRequest(
            output_path=arguments.output,
            org_id=arguments.org_id,
            row_count=arguments.rows,
            span_days=arguments.span_days,
            anomaly_fraction=arguments.anomaly_fraction,
            random_seed=arguments.seed,
            start_time=_parse_time(arguments.start_time),
        )
    )
    print("dataset_origin=simulated")
    print(f"dataset={result.dataset_path}")
    print(f"manifest={result.manifest_path}")
    print(f"rows={result.manifest.row_count}")
    print(f"simulated_anomaly_rows={result.simulated_anomaly_rows}")
    print(f"sha256={result.manifest.sha256}")
    return 0


def _parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate simulated AI training evidence.")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--org-id", default="trivikrama-simulated-demo")
    parser.add_argument("--rows", type=int, default=10_000)
    parser.add_argument("--span-days", type=float, default=8.0)
    parser.add_argument("--anomaly-fraction", type=float, default=0.02)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--start-time", default="2026-08-01T00:00:00+00:00")
    return parser.parse_args()


def _parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise argparse.ArgumentTypeError("start time must include a timezone")
    return parsed


if __name__ == "__main__":
    raise SystemExit(main())

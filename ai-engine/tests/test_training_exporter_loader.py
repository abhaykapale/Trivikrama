from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from collections.abc import Iterator, Mapping
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np

from app.core.feature_contract import AI_FEATURE_NAMES, DEFAULT_FEATURE_VALUES
from app.training.contracts import TrainingDatasetManifest
from app.training.exporter import (
    DatasetExportError,
    TrainingDatasetExportRequest,
    export_training_dataset,
)
from app.training.loader import DatasetLoadError, TrainingDatasetLoader, write_quality_report


def features(**overrides: object) -> dict[str, object]:
    values: dict[str, object] = dict(DEFAULT_FEATURE_VALUES)
    values.update(overrides)
    return values


def event(
    event_id: str,
    timestamp: datetime,
    *,
    org_id: str = "org-1",
    class_uid: int = 3002,
    feature_values: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "event_id": event_id,
        "org_id": org_id,
        "time": timestamp,
        "class_uid": class_uid,
        "features": feature_values or features(),
    }


class FakeCursor:
    def __init__(self, documents: list[Mapping[str, Any]]) -> None:
        self.documents = documents
        self.sort_keys: list[tuple[str, int]] | None = None
        self.selected_batch_size: int | None = None

    def sort(self, keys: list[tuple[str, int]]) -> FakeCursor:
        self.sort_keys = keys
        self.documents.sort(key=lambda value: (value["time"], value["event_id"]))
        return self

    def batch_size(self, size: int) -> FakeCursor:
        self.selected_batch_size = size
        return self

    def __iter__(self) -> Iterator[Mapping[str, Any]]:
        return iter(self.documents)


class FakeCollection:
    def __init__(self, documents: list[Mapping[str, Any]]) -> None:
        self.cursor = FakeCursor(documents)
        self.query: Mapping[str, Any] | None = None
        self.projection: Mapping[str, int] | None = None

    def find(
        self,
        query: Mapping[str, Any],
        projection: Mapping[str, int],
    ) -> FakeCursor:
        self.query = query
        self.projection = projection
        return self.cursor


class TrainingExportAndLoaderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary_directory.name)
        self.start = datetime(2026, 9, 1, tzinfo=UTC)
        self.end = self.start + timedelta(days=8)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def export(self, documents: list[Mapping[str, Any]]) -> Path:
        output = self.directory / "events.jsonl"
        export_training_dataset(
            FakeCollection(documents),
            TrainingDatasetExportRequest(
                org_id="org-1",
                from_time=self.start,
                to_time=self.end,
                output_path=output,
                batch_size=100,
            ),
            clock=lambda: self.end,
        )
        return output

    def test_streams_atomic_export_then_loads_ordered_matrix_and_quality(self) -> None:
        collection = FakeCollection(
            [
                event(
                    "evt-2",
                    self.start + timedelta(days=7),
                    class_uid=4001,
                    feature_values=features(bytes_sent=200),
                ),
                event(
                    "evt-1",
                    self.start,
                    feature_values=features(
                        bytes_sent=100,
                        process_rarity_score=0.75,
                        dst_port_rarity=0.5,
                    ),
                ),
            ]
        )
        output = self.directory / "events.jsonl"

        result = export_training_dataset(
            collection,
            TrainingDatasetExportRequest(
                org_id="org-1",
                from_time=self.start,
                to_time=self.end,
                output_path=output,
                batch_size=100,
            ),
            clock=lambda: self.end,
        )
        loaded = TrainingDatasetLoader().load(output)

        self.assertEqual(result.manifest.row_count, 2)
        self.assertEqual(collection.cursor.sort_keys, [("time", 1), ("event_id", 1)])
        self.assertEqual(collection.cursor.selected_batch_size, 100)
        assert collection.query is not None
        self.assertEqual(collection.query["org_id"], "org-1")
        self.assertEqual(loaded.values.shape, (2, 20))
        bytes_column = AI_FEATURE_NAMES.index("bytes_sent")
        np.testing.assert_array_equal(loaded.values[:, bytes_column], [100.0, 200.0])
        exported_first = json.loads(output.read_bytes().splitlines()[0])
        self.assertNotIn("process_rarity_score", exported_first["features"])
        self.assertNotIn("dst_port_rarity", exported_first["features"])
        self.assertFalse(loaded.values.flags.writeable)
        self.assertEqual(loaded.quality_report.time_span_days, 7.0)
        self.assertFalse(loaded.quality_report.minimum_sample_requirement_met)
        self.assertTrue(loaded.quality_report.minimum_time_span_requirement_met)
        self.assertTrue(loaded.quality_report.warnings)
        self.assertEqual(loaded.quality_report.class_distribution, {"3002": 1, "4001": 1})
        self.assertEqual(
            loaded.quality_report.feature_statistics["bytes_sent"].p50,
            150.0,
        )

        report_path = write_quality_report(
            loaded.quality_report,
            self.directory / "events.quality.json",
        )
        self.assertTrue(report_path.is_file())

    def test_invalid_mongo_event_leaves_no_partial_output(self) -> None:
        invalid = event("evt-1", self.start)
        invalid["features"] = features(bytes_sent="not-a-number")
        output = self.directory / "events.jsonl"

        with self.assertRaisesRegex(DatasetExportError, "row 1"):
            self.export([invalid])

        self.assertFalse(output.exists())
        self.assertFalse(output.with_suffix(".manifest.json").exists())
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_export_refuses_overwrite_and_cross_tenant_or_out_of_window_rows(self) -> None:
        self.export([event("evt-1", self.start)])
        with self.assertRaisesRegex(DatasetExportError, "overwrite"):
            self.export([event("evt-2", self.start)])

        other_directory = self.directory / "other"
        output = other_directory / "events.jsonl"
        for name, invalid in (
            ("tenant", event("evt-x", self.start, org_id="org-2")),
            ("window", event("evt-x", self.end)),
        ):
            with self.subTest(name=name), self.assertRaises(DatasetExportError):
                export_training_dataset(
                    FakeCollection([invalid]),
                    TrainingDatasetExportRequest(
                        org_id="org-1",
                        from_time=self.start,
                        to_time=self.end,
                        output_path=output,
                    ),
                )

    def test_loader_rejects_checksum_duplicate_tenant_and_order_corruption(self) -> None:
        output = self.export(
            [
                event("evt-1", self.start),
                event("evt-2", self.start + timedelta(hours=1)),
            ]
        )
        manifest_path = output.with_suffix(".manifest.json")
        original_lines = output.read_bytes().splitlines(keepends=True)
        original_manifest = TrainingDatasetManifest.model_validate_json(
            manifest_path.read_text(encoding="utf-8")
        )

        cases: dict[str, list[bytes]] = {
            "duplicate": [original_lines[0], original_lines[0]],
            "order": [original_lines[1], original_lines[0]],
        }
        second = json.loads(original_lines[1])
        second["org_id"] = "org-2"
        cases["organization"] = [
            original_lines[0],
            (json.dumps(second, separators=(",", ":")) + "\n").encode(),
        ]

        for name, lines in cases.items():
            with self.subTest(name=name):
                case_directory = self.directory / name
                case_directory.mkdir()
                case_dataset = case_directory / "events.jsonl"
                case_manifest = case_directory / "events.manifest.json"
                content = b"".join(lines)
                case_dataset.write_bytes(content)
                manifest = original_manifest.model_copy(
                    update={
                        "row_count": len(lines),
                        "sha256": hashlib.sha256(content).hexdigest(),
                    }
                )
                case_manifest.write_text(manifest.model_dump_json(), encoding="utf-8")
                with self.assertRaises(DatasetLoadError):
                    TrainingDatasetLoader().load(case_dataset, case_manifest)

        output.write_bytes(b"".join(original_lines).replace(b"evt-1", b"evt-x"))
        with self.assertRaisesRegex(DatasetLoadError, "checksum"):
            TrainingDatasetLoader().load(output, manifest_path)

    def test_loader_enforces_size_row_and_quality_report_overwrite_limits(self) -> None:
        output = self.export([event("evt-1", self.start)])
        with self.assertRaisesRegex(DatasetLoadError, "size limit"):
            TrainingDatasetLoader(max_dataset_bytes=1).load(output)
        with self.assertRaisesRegex(ValueError, "positive"):
            TrainingDatasetLoader(max_rows=0)

        loaded = TrainingDatasetLoader().load(output)
        report = self.directory / "quality.json"
        write_quality_report(loaded.quality_report, report)
        with self.assertRaisesRegex(DatasetLoadError, "overwrite"):
            write_quality_report(loaded.quality_report, report)


if __name__ == "__main__":
    unittest.main()

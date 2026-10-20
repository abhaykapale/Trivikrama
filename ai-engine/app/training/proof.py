"""One-command simulated training and real inference proof workflow."""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.detector import DetectionEvent, IsolationForestDetector
from app.core.explainer import build_tree_shap_explanation_provider
from app.core.model_loader import VersionedModelLoader
from app.training.loader import TrainingDatasetLoader, write_quality_report
from app.training.synthetic import (
    SimulatedDatasetRequest,
    generate_simulated_dataset,
    representative_anomalous_features,
    representative_normal_features,
)
from app.training.trainer import ModelTrainingRequest, train_and_publish_model


class AiProofError(RuntimeError):
    """Raised when end-to-end proof evidence cannot be completed."""


class ProofPrediction(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    event_id: str
    anomaly_score: float = Field(ge=0.0, le=1.0)
    is_anomaly: bool
    confidence: float = Field(ge=0.0, le=1.0)


class ProofShapContribution(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    name: str
    feature_value: float
    shap_value: float


class EndToEndAiProofReport(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    schema_version: Literal["ai-end-to-end-proof-v1"] = "ai-end-to-end-proof-v1"
    evidence_classification: Literal["simulated-demonstration"] = "simulated-demonstration"
    completed_at: datetime
    dataset_file: str
    dataset_origin: Literal["simulated"] = "simulated"
    dataset_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    dataset_rows: int = Field(ge=10_000)
    dataset_time_span_days: float = Field(ge=7.0)
    feature_count: int = Field(ge=1)
    model_version: str
    threshold: float = Field(ge=0.0, le=1.0)
    production_requirements_met: bool
    trained_model_production_eligible: bool
    runtime_bundle_loaded: bool
    predictions: list[ProofPrediction]
    anomalous_event_top_shap: list[ProofShapContribution]
    proof_passed: bool

    @model_validator(mode="after")
    def validate_evidence(self) -> Self:
        if self.completed_at.tzinfo is None or self.completed_at.utcoffset() is None:
            raise ValueError("completed_at must include a timezone")
        if len(self.predictions) != 2:
            raise ValueError("proof must contain normal and anomalous predictions")
        if not self.anomalous_event_top_shap:
            raise ValueError("proof must contain SHAP evidence")
        if self.trained_model_production_eligible:
            raise ValueError("a simulated proof model must not be production eligible")
        return self


@dataclass(frozen=True, slots=True)
class EndToEndAiProofRequest:
    output_directory: Path
    version: str | None = None
    rows: int = 10_000
    span_days: float = 8.0
    random_seed: int = 42


@dataclass(frozen=True, slots=True)
class EndToEndAiProofResult:
    report_path: Path
    report: EndToEndAiProofReport
    dataset_path: Path
    models_directory: Path


def run_end_to_end_ai_proof(
    request: EndToEndAiProofRequest,
    *,
    clock: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> EndToEndAiProofResult:
    """Generate, validate, train, reload, detect, explain, and record evidence."""

    output_directory = request.output_directory.absolute()
    if output_directory.exists() or output_directory.is_symlink():
        raise AiProofError("proof output directory already exists")
    output_directory.mkdir(parents=True)
    training_directory = output_directory / "training_data"
    models_directory = output_directory / "models"
    dataset_path = training_directory / "simulated-ai-proof-v1.jsonl"
    completed_at = clock()
    if completed_at.tzinfo is None or completed_at.utcoffset() is None:
        raise AiProofError("proof clock must return a timezone-aware datetime")

    generated = generate_simulated_dataset(
        SimulatedDatasetRequest(
            output_path=dataset_path,
            row_count=request.rows,
            span_days=request.span_days,
            random_seed=request.random_seed,
        ),
        clock=lambda: completed_at,
    )
    loaded_dataset = TrainingDatasetLoader().load(
        generated.dataset_path,
        generated.manifest_path,
    )
    write_quality_report(
        loaded_dataset.quality_report,
        training_directory / "simulated-ai-proof-v1.quality.json",
    )
    training = train_and_publish_model(
        ModelTrainingRequest(
            dataset_path=generated.dataset_path,
            manifest_path=generated.manifest_path,
            models_dir=models_directory,
            version=request.version,
        ),
        clock=lambda: completed_at,
    )
    artifacts = VersionedModelLoader(models_directory).load(training.version)
    explanation_provider = build_tree_shap_explanation_provider(
        artifacts.model,
        artifacts.feature_names,
    )
    detector = IsolationForestDetector(
        artifacts,
        explanation_provider=explanation_provider,
    )
    events = (
        DetectionEvent(
            event_id="proof-normal-event",
            features=representative_normal_features(),
        ),
        DetectionEvent(
            event_id="proof-anomalous-event",
            features=representative_anomalous_features(),
        ),
    )
    detection = detector.detect(events, include_shap=True)
    explanation = detector.explain(events[1])
    predictions = [
        ProofPrediction(
            event_id=prediction.event_id,
            anomaly_score=prediction.anomaly_score,
            is_anomaly=prediction.is_anomaly,
            confidence=prediction.confidence,
        )
        for prediction in detection.predictions
    ]
    anomalous_prediction = predictions[1]
    proof_passed = (
        loaded_dataset.quality_report.minimum_sample_requirement_met
        and loaded_dataset.quality_report.minimum_time_span_requirement_met
        and artifacts.version == training.version
        and anomalous_prediction.is_anomaly
        and anomalous_prediction.anomaly_score > predictions[0].anomaly_score
        and len(explanation.shap_explanation.features) == len(artifacts.feature_names)
    )
    if not proof_passed:
        raise AiProofError("end-to-end proof acceptance criteria were not met")

    report = EndToEndAiProofReport(
        completed_at=completed_at,
        dataset_file=generated.dataset_path.name,
        dataset_sha256=generated.manifest.sha256,
        dataset_rows=generated.manifest.row_count,
        dataset_time_span_days=loaded_dataset.quality_report.time_span_days,
        feature_count=len(generated.manifest.feature_names),
        model_version=training.version,
        threshold=training.report.threshold,
        production_requirements_met=True,
        trained_model_production_eligible=training.report.production_eligible,
        runtime_bundle_loaded=True,
        predictions=predictions,
        anomalous_event_top_shap=[
            ProofShapContribution(
                name=contribution.name,
                feature_value=contribution.value,
                shap_value=contribution.shap_value,
            )
            for contribution in explanation.shap_explanation.features[:5]
        ],
        proof_passed=True,
    )
    report_path = output_directory / "ai-end-to-end-proof.json"
    with report_path.open("xb") as output:
        output.write((report.model_dump_json(indent=2) + "\n").encode("utf-8"))
        output.flush()
        os.fsync(output.fileno())
    return EndToEndAiProofResult(
        report_path=report_path,
        report=report,
        dataset_path=generated.dataset_path,
        models_directory=models_directory,
    )

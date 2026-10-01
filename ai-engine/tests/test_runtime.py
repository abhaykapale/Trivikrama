import pytest

from app.runtime import RuntimeState


def test_runtime_rejects_invalid_model_and_latency_values() -> None:
    runtime = RuntimeState()

    with pytest.raises(ValueError, match="version"):
        runtime.mark_model_loaded("  ")
    with pytest.raises(ValueError, match="latency"):
        runtime.record_prediction(-0.1)
    with pytest.raises(ValueError, match="events_processed"):
        runtime.record_prediction(1.0, events_processed=-1)
    with pytest.raises(ValueError, match="anomalies_detected"):
        runtime.record_prediction(1.0, events_processed=1, anomalies_detected=2)
    with pytest.raises(ValueError, match="explanation latency"):
        runtime.record_explanation(-0.1)


def test_unloading_a_model_clears_its_version() -> None:
    runtime = RuntimeState()
    runtime.mark_model_loaded("model-v1")

    runtime.mark_model_unloaded()

    snapshot = runtime.snapshot()
    assert snapshot.model_loaded is False
    assert snapshot.model_version is None

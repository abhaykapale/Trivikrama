# Model artifacts

This directory is populated by the offline training pipeline. Never place
artifacts downloaded from an untrusted source here: Joblib uses pickle and
loading a malicious artifact can execute code.

Expected layout:

```text
models/
├── config.json
└── v20260920_120000/
    ├── model.joblib
    ├── scaler.joblib
    └── training_report.json
```

`config.json` selects `active_version`. Paths must be relative to this models
directory, and every model version must use the canonical 20-feature order.
Each version's training metadata must include `raw_score_min` and
`raw_score_max`, computed from the same training or validation distribution
used to approve that model. Inference uses those fixed bounds to turn raw
Isolation Forest values into stable anomaly scores.

Create artifacts only with `python -m scripts.train_model`. The trainer uses
the AI-02A manifest checksum as provenance, refuses version overwrites,
publishes the registry atomically, and loads the completed bundle through the
runtime loader before returning success. A bundle produced with
`--allow-insufficient-data` is marked non-production in both registry metadata
and `training_report.json`.

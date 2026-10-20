# Trivikrama AI Engine

AI-01A establishes the Python/FastAPI process boundary and health contract.
AI-01B adds the canonical 20-feature contract and model-independent
preprocessing. AI-01C adds the versioned model registry and trusted artifact
loader. AI-01D adds Isolation Forest inference, stable score normalization,
threshold classification, and confidence calculation. AI-01E exposes that
pipeline through a bounded internal FastAPI endpoint. AI-01F adds Tree SHAP
explanations for anomalous events. AI-01G exposes an explicit single-event
explanation endpoint for analyst-driven investigation. AI-01H adds the
internal metrics and active-model information endpoints used for operations
and deployment verification.

## Simulated end-to-end AI proof

The proof command creates reproducible demonstration evidence without
misrepresenting simulated traffic as real production data. It generates
10,000 contract-valid events over eight days, validates the dataset and its
SHA-256 manifest, trains the real 200-tree model, validates Tree SHAP, reloads
the published bundle through the production loader, scores representative
normal and anomalous events, and writes a proof report with the top five SHAP
contributions.

Run it once from the project root. The output directory must be new because
datasets, model versions, and evidence files are deliberately immutable:

```powershell
Set-Location "D:\Trivikrama\ai-engine"
.\.venv\Scripts\Activate.ps1

python -m scripts.run_ai_proof `
  --output-directory ".\proof_runs\ai-02b-demo"
```

Expected evidence:

```text
proof_runs/ai-02b-demo/
├── ai-end-to-end-proof.json
├── training_data/
│   ├── simulated-ai-proof-v1.jsonl
│   ├── simulated-ai-proof-v1.manifest.json
│   └── simulated-ai-proof-v1.quality.json
└── models/
    ├── config.json
    └── vYYYYMMDD_HHMMSS/
        ├── model.joblib
        ├── scaler.joblib
        └── training_report.json
```

Inspect the proof in PowerShell:

```powershell
$proof = Get-Content `
  ".\proof_runs\ai-02b-demo\ai-end-to-end-proof.json" `
  -Raw | ConvertFrom-Json

$proof | Select-Object `
  evidence_classification, dataset_rows, dataset_time_span_days, `
  model_version, threshold, production_requirements_met, `
  trained_model_production_eligible, `
  runtime_bundle_loaded, proof_passed

$proof.predictions | Format-Table
$proof.anomalous_event_top_shap | Format-Table
```

Every manifest and report explicitly records the dataset origin as
`simulated`. Meeting the numeric training requirements demonstrates the full
software pipeline; it does not convert simulated traffic into production
security evidence. A production model must still be trained on approved,
predominantly normal organizational telemetry.

To start the API with the proof model for a local demonstration:

```powershell
$env:AI_MODELS_DIR = ".\proof_runs\ai-02b-demo\models"
$env:AI_REQUIRE_MODEL_ON_STARTUP = "true"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Use a different output directory name for another run; prior evidence is
never overwritten.

## AI-02B offline model training and artifact publication

AI-02B turns one AI-02A checksummed dataset into a runtime-loadable model
bundle. The command performs a deterministic 80/20 split, fits a
`StandardScaler` only on the training partition, trains the architecture's
fixed 200-tree Isolation Forest, calibrates anomaly scores on the holdout
partition, and selects the recommended P95 threshold. Before publication it
constructs the same Tree SHAP adapter used by the service and evaluates one
holdout event, preventing a SHAP-incompatible model from becoming active.

By default, training stops unless the dataset has at least 10,000 rows and
covers at least seven days. `--allow-insufficient-data` is intentionally an
explicit development escape hatch; its report records
`production_eligible: false` and must not be presented as a production model.

Train a production-eligible bundle from a validated AI-02A export:

```powershell
Set-Location "D:\Trivikrama\ai-engine"
.\.venv\Scripts\Activate.ps1

python -m scripts.train_model `
  --dataset "training_data\events-20260901-20260925.jsonl" `
  --models-dir "models"
```

For a small local integration fixture only:

```powershell
python -m scripts.train_model `
  --dataset "training_data\development-events.jsonl" `
  --models-dir "models" `
  --allow-insufficient-data
```

The command never overwrites a version. It creates and validates:

```text
models/
├── config.json
└── vYYYYMMDD_HHMMSS/
    ├── model.joblib
    ├── scaler.joblib
    └── training_report.json
```

`config.json` preserves prior versions for rollback and activates the new
bundle only after all three files are complete. The report contains dataset
provenance, quality evidence, exact hyperparameters, train/holdout sizes,
holdout score distribution, threshold, anomaly rate, SHA-256 artifact
digests, SHAP validation status, and production eligibility.

Verify AI-02A and AI-02B together with:

```powershell
python -m pytest tests\test_training_contracts.py `
  tests\test_training_source_config.py `
  tests\test_training_exporter_loader.py `
  tests\test_training_thresholds.py `
  tests\test_model_training.py -v
```

## AI-02A offline training dataset and loader

AI-02A creates the trusted boundary between feature-enriched MongoDB events and
future model training. It does not fit a scaler or model. The workflow is:

1. stream one organization's valid feature-enriched events from
   `normalized_events` in chronological order;
2. select only the ordered 20-field v1 model contract and discard newer
   process/network context fields;
3. validate every identifier, timestamp, class, feature value, tenant, and
   time-window boundary;
4. atomically publish a newline-delimited JSON dataset and versioned manifest;
5. verify the SHA-256 checksum and load the data into a read-only NumPy matrix;
6. produce a feature-distribution and dataset-quality report.

The exporter requires `schema_valid=true`, `features` to exist, an explicit
`org_id`, and a half-open UTC time window (`from_time <= time < to_time`). It
uses a MongoDB cursor and writes one line at a time, so export memory does not
grow with collection size. Final filenames are never overwritten. A manifest
is published only after the complete dataset has been flushed to disk.

The loader accepts only regular local files, rejects symbolic links, enforces
configurable byte/row/line limits, and validates checksum, row count, tenant,
time range, chronological order, unique event IDs, exact feature names, feature
ranges, and finite numeric values. The default maximum is two million rows and
2 GiB. A one-million-row float64 feature matrix uses approximately 160 MB for
the 20 numeric columns, excluding validation overhead.

Real datasets are excluded from Git and Docker builds. Use a read-only MongoDB
account with access limited to the selected organization's source collection.
The MongoDB URI is accepted only through an environment variable so it is not
placed in shell history or process arguments.

### Export from MongoDB

Install the updated dependencies, then set the offline-only environment:

```powershell
Set-Location "D:\Trivikrama\ai-engine"
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt -r requirements-training.txt

$env:TRAINING_MONGODB_URI = "mongodb://training_reader:YOUR_PASSWORD@localhost:27017/trivikrama"
$env:TRAINING_ORG_ID = "replace-with-your-org-id"
```

If the URI does not contain a database name, also set:

```powershell
$env:TRAINING_MONGODB_DATABASE = "trivikrama"
```

Export a new file. The exporter refuses to overwrite an existing name:

```powershell
python -m scripts.export_training_data `
  --from-time "2026-09-01T00:00:00Z" `
  --to-time "2026-09-26T00:00:00Z" `
  --output "training_data\events-20260901-20260925.jsonl"
```

This creates:

```text
training_data/
├── events-20260901-20260925.jsonl
└── events-20260901-20260925.manifest.json
```

### Validate and inspect quality

```powershell
python -m scripts.validate_training_data `
  --dataset "training_data\events-20260901-20260925.jsonl"
```

The command verifies the full dataset before creating:

```text
training_data/events-20260901-20260925.quality.json
```

Review the report before AI-02B. For a meaningful first model, the architecture
expects at least 10,000 predominantly normal events covering at least seven
days. Pay particular attention to features with a `default_rate` close to 1.0;
that usually means the source logs lack the activity needed for that feature.

Run the AI-02A tests with:

```powershell
python -m pytest `
  tests/test_training_contracts.py `
  tests/test_training_source_config.py `
  tests/test_training_exporter_loader.py `
  -v
```

## AI-01H metrics and model information

`GET /api/v1/metrics` reports process-local inference counters, batch and error
rates, request-latency percentiles, SHAP timing, and the active model identity.
Request count and event count are deliberately separate because one detection
request can contain up to 100 events. Failed requests increase the request and
error counters but do not claim that any events were successfully processed.

Latency percentile samples use a bounded 10,000-request window. This prevents
an always-on worker from retaining one Python object per request forever. The
totals, mean latency, and error rate remain lifetime values for the current
process. These metrics reset when the process restarts and are per worker; a
production metrics collector must aggregate all AI Engine replicas.

SHAP timing is measured by a decorator around the shared explanation provider.
Only successful explanations increment `total_explanations`; failed SHAP calls
continue to follow the endpoint-specific behavior established in AI-01F and
AI-01G.

`GET /api/v1/model/info` reports only metadata from the bundle that passed the
trusted startup loader: active version, threshold, exact feature contract,
an allowlisted public projection of training metadata, and registered versions.
Unknown metadata—including artifact paths—is not exposed. The endpoint returns
`503` if no complete bundle is loaded. Neither operational endpoint accepts
paths or model data from the caller, and both send `Cache-Control: no-store`.

## AI-01G standalone explanation API

`POST /api/v1/explain` accepts exactly one event and returns its normalized
anomaly score plus a complete, ordered SHAP explanation. It deliberately uses
the same startup-created detector, preprocessor, model, normalizer, and SHAP
provider as `/detect/anomaly`; this prevents the two endpoints from producing
results from different model versions or feature orderings.

The endpoint explains the event even when its score is below the anomaly
threshold. This differs from batch detection: batch SHAP is an optional cost
paid only for anomalies, while `/explain` represents an analyst explicitly
requesting an explanation for a particular event.

The route returns:

- `200` with the event ID, anomaly score, SHAP values, model version, and
  request processing time;
- `422` for an invalid event ID or feature contract;
- `503` before a complete model and SHAP provider are ready;
- a generic `500` when scoring or SHAP evaluation fails.

All responses use `Cache-Control: no-store`. Successful and failed requests
also update the existing process-local inference metrics. Internal SHAP errors
are logged server-side and never copied into the HTTP response.

## AI-01F SHAP explanations

When `include_shap=true`, the detector explains only predictions whose anomaly
score meets the selected threshold. Normal predictions keep
`shap_explanation: null`, avoiding the most expensive inference step when an
event is not suspicious.

The application builds one `TreeExplainer` alongside the loaded model during
startup. It uses `tree_path_dependent` mode, so the fitted Isolation Forest's
recorded path counts provide the background distribution. Calls are protected
by a lock because synchronous FastAPI requests may run concurrently against
the same process-local explainer.

Tree SHAP explains Isolation Forest path length, not the normalized anomaly
score. Longer paths indicate normality, so the adapter reverses each SHAP
contribution's sign. The response therefore uses this interpretation:

- positive `shap_value`: pushes the event toward anomaly;
- negative `shap_value`: pushes the event toward normal;
- absolute magnitude: relative influence on this prediction.

Contributions are sorted by absolute magnitude and report cleaned, unscaled
feature values so analysts see meaningful units rather than StandardScaler
coordinates. These directional values are not probabilities and are not
additive components of the normalized anomaly score.

If SHAP fails for an individual anomaly, its prediction remains valid and the
endpoint returns `200` with `shap_explanation: null` for that event. A scoring
failure still returns the generic `500` response.

## AI-01E detection API

`POST /api/v1/detect/anomaly` accepts between 1 and 100 enriched events. The
route validates the HTTP payload, translates each Pydantic event into a domain
`DetectionEvent`, invokes the startup-created detector once for the batch, and
maps the result back to the public response contract.

The route returns:

- `200` for successful inference;
- `422` when Pydantic rejects malformed input or duplicate event IDs;
- `503` when no complete model bundle is loaded;
- a generic `500` when inference fails, while the detailed exception stays in
  server logs.

If `threshold` is omitted, the detector uses the threshold stored with the
active model version. Responses use `Cache-Control: no-store`, and successful
and failed inference attempts update the existing health metrics.

The detector is created only after the complete model and scaler bundle loads
during application startup. Therefore a request can observe either a complete
detector or no detector; it cannot observe partially initialized inference
state.

## AI-01D detection and score normalization

`IsolationForest.decision_function` produces larger values for normal samples
and smaller values for anomalous samples. The dashboard contract is the
opposite: an anomaly score of `1` means highly anomalous and `0` means normal.
`ScoreNormalizer` therefore clips raw scores to the range observed during
training, applies min-max scaling, and inverts the result.

The range is stored as `raw_score_min` and `raw_score_max` in each version's
training metadata. Never calculate these bounds from an incoming request. A
request-relative range would make one event's score depend on which other
events happened to share its batch, and a one-event batch has no usable range.

`IsolationForestDetector` owns the inference sequence:

1. validate event identifiers, batch size, and threshold;
2. preprocess every event using the loaded version's scaler;
3. call the model once for the whole batch;
4. validate and normalize the returned raw scores;
5. classify with `anomaly_score >= threshold` and calculate confidence.

The detector is transport-independent. AI-01E can expose it through FastAPI
without putting HTTP concerns into the inference code.

## AI-01C versioned model loading

At startup, `VersionedModelLoader` reads `models/config.json`, validates the
active version and exact feature order, resolves artifact paths beneath the
models root, and loads both `model.joblib` and `scaler.joblib`. The application
publishes the bundle and marks health ready only after every check succeeds.

Development can start without `models/config.json` and will report
`model_loaded: false`. Production defaults to requiring a valid model and
aborts startup if the configured bundle cannot be loaded. Override this only
deliberately with `AI_REQUIRE_MODEL_ON_STARTUP`.

Joblib is pickle-based. Never load an artifact supplied through an HTTP request
or downloaded from an untrusted source. The loader accepts only deployment-
controlled regular files inside `AI_MODELS_DIR` and rejects traversal,
symbolic-link artifacts, oversized files, incompatible feature counts, and
invalid interfaces.

## AI-01B feature preprocessing

The backend sends named features because names are safe across HTTP. A machine
learning model consumes an ordered numeric matrix. `FeaturePreprocessor` is the
boundary between those representations:

1. select only the 20 v1 model features;
2. fill absent or null values from model-compatible defaults;
3. replace NaN/infinity and clip values with documented bounds;
4. arrange columns in the exact training order;
5. call the injected scaler and validate its output.

The preprocessor receives a scaler instead of constructing one. The future
model loader will supply the `StandardScaler` fitted during training. This is
essential: fitting a new scaler during inference would make input values
incompatible with the trained Isolation Forest.

`process_rarity_score` and other contextual process/network fields may be
present in the payload, but the v1 selector discards them. Adding a feature to
the model requires retraining and versioning; it is not a harmless API change.

## What this milestone teaches

The service is split into four small layers:

1. `config.py` translates untrusted environment strings into typed settings.
2. `runtime.py` owns process-local model and inference state.
3. `schemas/health.py` defines the public response contract.
4. `routes/health.py` translates runtime state into HTTP.

`main.py` is the composition root: it creates these objects and connects them.
Keeping composition at the edge makes each layer testable without starting a
real server.

The health endpoint returns HTTP 200 while the process can answer requests. Its
body reports `status: unhealthy` and `model_loaded: false` until a later model
loader marks the runtime ready. This distinction is important:

- **Liveness** asks whether the process is responsive.
- **Readiness** asks whether the process can perform useful inference.

## Run locally (PowerShell)

Python 3.11 or newer is required.

```powershell
Set-Location "D:\Trivikrama\ai-engine"
py -3.11 -m venv .venv
Set-ExecutionPolicy -Scope Process Bypass
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements-dev.txt
python -m pytest
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

In another PowerShell window:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/api/v1/health
```

After a model bundle has been configured, call detection with:

```powershell
$body = @{
  events = @(
    @{
      event_id = "evt-demo-1"
      features = @{
        hour_of_day = 3
        day_of_week = 5
        is_business_hours = 0
        severity_id = 3
      }
    }
  )
  include_shap = $false
} | ConvertTo-Json -Depth 6

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8000/api/v1/detect/anomaly `
  -ContentType "application/json" `
  -Body $body
```

Request a standalone explanation with:

```powershell
$explainBody = @{
  event_id = "evt-demo-1"
  features = @{
    hour_of_day = 3
    day_of_week = 5
    is_business_hours = 0
    severity_id = 3
  }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8000/api/v1/explain `
  -ContentType "application/json" `
  -Body $explainBody
```

Interactive API documentation is available at
`http://127.0.0.1:8000/docs` in development and test environments. It is
disabled when `AI_ENVIRONMENT=production`.

## Run with Docker

```powershell
docker build -t trivikrama-ai-engine:ai-01g .
docker run --rm -p 8000:8000 trivikrama-ai-engine:ai-01g
```

## Read before extending it

- FastAPI lifespan: https://fastapi.tiangolo.com/advanced/events/
- FastAPI dependency injection: https://fastapi.tiangolo.com/tutorial/dependencies/
- FastAPI testing: https://fastapi.tiangolo.com/tutorial/testing/
- FastAPI response models: https://fastapi.tiangolo.com/tutorial/response-model/
- FastAPI handling errors: https://fastapi.tiangolo.com/tutorial/handling-errors/
- Pydantic models: https://docs.pydantic.dev/latest/concepts/models/
- Pydantic strict mode: https://docs.pydantic.dev/latest/concepts/strict_mode/
- NumPy array basics: https://numpy.org/doc/stable/user/absolute_beginners.html
- StandardScaler: https://scikit-learn.org/stable/modules/generated/sklearn.preprocessing.StandardScaler.html
- Scikit-learn model persistence: https://scikit-learn.org/stable/model_persistence.html
- Isolation Forest: https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.IsolationForest.html
- NumPy clipping: https://numpy.org/doc/stable/reference/generated/numpy.clip.html
- SHAP TreeExplainer: https://shap.readthedocs.io/en/latest/generated/shap.TreeExplainer.html
- Joblib persistence: https://joblib.readthedocs.io/en/latest/persistence.html
- ASGI concepts: https://asgi.readthedocs.io/en/latest/specs/main.html

Before the next milestone, explain why `/detect/anomaly` tolerates an optional
SHAP failure but `/explain` fails the request, why the standalone endpoint also
explains normal events, and why both endpoints must share one loaded detector.

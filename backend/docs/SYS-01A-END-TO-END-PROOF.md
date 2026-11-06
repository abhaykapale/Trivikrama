# SYS-01A — End-to-End SIEM Demonstration

This command verifies real data already processed by Trivikrama. It does not
use mocked results and does not create a fake incident.

## 1. Prerequisites

The following services must be running with matching `.env` configuration:

- PostgreSQL
- MongoDB
- Redis
- AI Engine
- Collector processing worker
- Collector heartbeat monitor
- Collector intake cycle or scheduler

Apply the latest database changes and seed the built-in rule:

```powershell
npm install
npm run migrate
npm run db:mongo:bootstrap
npm run db:seed
```

## 2. Start the processing components

Open separate PowerShell terminals in the backend directory.

```powershell
npm run ingestion:worker
```

```powershell
npm run ingestion:heartbeat
```

After the Collector writes a signed batch:

```powershell
npm run ingestion:run-once
```

Wait until the worker reports that the batch was processed.

## 3. Run the proof

To verify the most recently incident-linked event:

```powershell
npm run proof:system
```

To verify a specific event:

```powershell
npm run proof:system -- "<actual-event-id>"
```

Do not type the literal text `<actual-event-id>`. Use the event ID printed by
the Collector/worker or stored in `normalized_events`. If no ID is supplied,
the command safely discovers the latest linked event for the configured
organization.

## 4. Evidence produced

The command prints a simple PASS/FAIL report and writes two files:

```text
artifacts/system-proof/system-proof-...json
artifacts/system-proof/system-proof-...txt
```

The JSON file contains:

- Collector and batch identifiers
- Canonical unsigned SHA-256 digest
- OCSF class and severity
- Feature-contract validation
- Model version, anomaly score, confidence, SHAP count, and inference time
- Alert identifiers and detection types
- Incident ID, source, risk score, severity, alert count, and event count
- Audit identifier
- Notification and Redis publication evidence
- Collector heartbeat statistics
- Pipeline timing

Raw event bodies and secrets are deliberately excluded.

## 5. Final demonstration rule

For the final professor demonstration, run without diagnostic flags:

```powershell
npm run proof:system
```

The final line must be:

```text
OVERALL RESULT: PASS
```

If it reports `FAIL`, read the failed stage instead of editing the report. The
stage indicates which real service or stored record must be corrected.

## 6. Diagnostic flags

These flags help isolate infrastructure during development:

```powershell
npm run proof:system -- --allow-pending-notification
npm run proof:system -- --allow-missing-heartbeat
```

They must not be used as final proof because they relax notification or
heartbeat verification.

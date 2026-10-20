# Backend AI integration

This module implements the internal backend-to-AI boundary defined by
`backend-detection.md` and `ai-engine.md`.

The worker supplies `FeatureEnrichedEvent[]`. `HttpAiClient` selects only the
versioned 20-field model contract, splits requests into batches of at most 100,
validates the complete FastAPI response, and returns predictions without
exposing transport errors. Timeouts, invalid responses, non-2xx responses, and
an open circuit activate rule-only fallback.

`DetectAndPersistAiResultsService` stores successful predictions in MongoDB,
including the exact input features and optional SHAP explanation. The compound
event/model identity makes BullMQ replay idempotent while permitting the same
event to be scored by a later model version.

Run the unit contract suite with:

```powershell
npm run test:analysis:be-ai-01a
```

With the AI Engine running, prove the live backend client boundary with:

```powershell
npm run proof:backend-ai
```

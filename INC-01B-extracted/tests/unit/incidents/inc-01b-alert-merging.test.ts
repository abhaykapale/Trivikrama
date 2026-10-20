import assert from "node:assert/strict";
import test from "node:test";

import type { AiResultDocument } from "../../../src/database/repositories/mongodb/ai-result.repository.js";
import type { AlertRecord } from "../../../src/database/repositories/alerts/alert.repository.js";
import {
  createDeterministicAiAlertId,
  createUnifiedAlertDedupKey,
  UnifiedAlertDeduplicator,
  UnifiedAlertMerger,
  type UnifiedAlert,
  type UnifiedRuleAlert,
} from "../../../src/modules/incidents/index.js";

const ORG_ID = "incident-test-org";

test("merges persisted rule alerts and anomalous AI results into one contract", () => {
  const result = new UnifiedAlertMerger().merge({
    orgId: ORG_ID,
    ruleAlerts: [ruleAlert()],
    aiResults: [aiResult(true), aiResult(false, "event-normal")],
  });

  assert.equal(result.ruleAlertsMerged, 1);
  assert.equal(result.aiAlertsMerged, 1);
  assert.equal(result.nonAnomalousAiResultsIgnored, 1);
  assert.equal(result.alerts.length, 2);

  const rule = result.alerts[0];
  assert.equal(rule?.type, "rule");
  assert.deepEqual(rule?.matchedEventIds, ["event-a", "event-b"]);

  const ai = result.alerts[1];
  assert.equal(ai?.type, "ai");
  if (ai?.type !== "ai") throw new Error("Expected a unified AI alert.");
  assert.equal(ai.severity, "critical");
  assert.equal(ai.weight, 0.91);
  assert.equal(ai.confidence, 0.98);
  assert.deepEqual(ai.metadata.shapExplanation, aiResult(true).shap_explanation);
});

test("creates a replay-stable UUIDv8 identity for an AI anomaly", () => {
  const input = {
    orgId: ORG_ID,
    eventId: "event-ai-1",
    modelName: "isolation_forest_v1",
    modelVersion: "v20261010_051642",
  };

  const first = createDeterministicAiAlertId(input);
  const replay = createDeterministicAiAlertId(input);
  const newModel = createDeterministicAiAlertId({
    ...input,
    modelVersion: "v20261011_010000",
  });

  assert.match(
    first,
    /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  assert.equal(first, replay);
  assert.notEqual(first, newModel);
});

test("deduplicates replayed alerts but preserves rule, AI, and distinct-rule agreement", () => {
  const merger = new UnifiedAlertMerger();
  const merged = merger.merge({
    orgId: ORG_ID,
    ruleAlerts: [
      ruleAlert(),
      { ...ruleAlert(), id: "22222222-2222-8222-8222-222222222222" },
      ruleAlert({
        id: "33333333-3333-8333-8333-333333333333",
        ruleId: "44444444-4444-4444-8444-444444444444",
        ruleName: "Different Rule",
      }),
    ],
    aiResults: [aiResult(true, "event-a")],
  });

  const result = new UnifiedAlertDeduplicator().deduplicate(merged.alerts);

  assert.equal(result.inputCount, 4);
  assert.equal(result.duplicatesRemoved, 1);
  assert.equal(result.alerts.length, 3);
  assert.deepEqual(
    result.alerts.map((alert) => alert.type),
    ["rule", "rule", "ai"],
  );
});

test("dedup keys ignore event order and separate different detection sources", () => {
  const rule = unifiedRuleAlert();
  const reordered: UnifiedRuleAlert = {
    ...rule,
    matchedEventIds: ["event-b", "event-a"],
  };
  const ai = new UnifiedAlertMerger().merge({
    orgId: ORG_ID,
    ruleAlerts: [],
    aiResults: [aiResult(true, "event-a")],
  }).alerts[0]!;

  assert.equal(
    createUnifiedAlertDedupKey(rule),
    createUnifiedAlertDedupKey(reordered),
  );
  assert.notEqual(
    createUnifiedAlertDedupKey(rule),
    createUnifiedAlertDedupKey(ai),
  );
});

test("rejects tenant crossing and conflicting content under one logical identity", () => {
  const merger = new UnifiedAlertMerger();
  assert.throws(
    () =>
      merger.merge({
        orgId: "another-org",
        ruleAlerts: [ruleAlert()],
        aiResults: [],
      }),
    /organization boundary/u,
  );
  assert.throws(
    () =>
      merger.merge({
        orgId: ORG_ID,
        ruleAlerts: [],
        aiResults: [{ ...aiResult(true), org_id: undefined }],
      }),
    /organization boundary/u,
  );

  const original = unifiedRuleAlert();
  const conflicting: UnifiedAlert = { ...original, severity: "critical" };
  assert.throws(
    () => new UnifiedAlertDeduplicator().deduplicate([original, conflicting]),
    /identity collision/u,
  );
});

function ruleAlert(overrides: Partial<AlertRecord> = {}): AlertRecord {
  return {
    id: "11111111-1111-8111-8111-111111111111",
    incidentId: null,
    alertType: "rule",
    ruleId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ruleName: "Failed Login",
    matchedCondition: "selection",
    anomalyScore: null,
    confidence: null,
    threatCategory: null,
    modelVersion: null,
    shapValues: null,
    severity: "high",
    weight: 0.8,
    tags: ["attack.t1110"],
    metadata: { ruleStateVersion: "compiled-v1" },
    matchedEventIds: ["event-b", "event-a"],
    createdAt: new Date("2026-10-11T06:00:00.000Z"),
    orgId: ORG_ID,
    ...overrides,
  };
}

function aiResult(
  isAnomaly: boolean,
  eventId = "event-ai-1",
): AiResultDocument {
  return {
    event_id: eventId,
    batch_id: "batch-1",
    model_name: "isolation_forest_v1",
    model_version: "v20261010_051642",
    anomaly_score: isAnomaly ? 0.91 : 0.05,
    is_anomaly: isAnomaly,
    confidence: 0.98,
    shap_explanation: {
      base_value: -12.4,
      features: [{ name: "bytes_ratio", value: 1000, shap_value: 0.9 }],
    },
    created_at: new Date("2026-10-11T06:00:01.000Z"),
    org_id: ORG_ID,
  };
}

function unifiedRuleAlert(): UnifiedRuleAlert {
  const alert = new UnifiedAlertMerger().merge({
    orgId: ORG_ID,
    ruleAlerts: [ruleAlert()],
    aiResults: [],
  }).alerts[0];
  if (alert?.type !== "rule") throw new Error("Expected a unified rule alert.");
  return alert;
}

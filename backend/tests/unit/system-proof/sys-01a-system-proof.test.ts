import assert from "node:assert/strict";
import test from "node:test";

import { AI_FEATURE_NAMES } from "../../../src/modules/feature-extraction/index.js";
import {
  formatSystemProof,
  GenerateSystemProofService,
  type SystemProofDataSource,
} from "../../../src/modules/system-proof/index.js";

const NOW = new Date("2026-10-20T06:00:00.000Z");
const EVENT_ID = "event-proof-001";
const INCIDENT_ID = "00000000-0000-4000-8000-000000000701";
const NOTIFICATION_ID = "00000000-0000-4000-8000-000000000702";
const ORG_ID = "organization-proof";

test("SYS-01A passes only when every persisted evidence stage agrees", async () => {
  const source = new ValidDataSource();
  const report = await new GenerateSystemProofService(source, () => NOW).execute({
    eventId: EVENT_ID,
    orgId: ORG_ID,
  });

  assert.equal(report.passed, true);
  assert.equal(report.eventSelection, "explicit");
  assert.equal(report.stages.length, 11);
  assert.equal(report.stages.every((stage) => stage.status === "PASS"), true);
  assert.equal((report.evidence.incident as any).riskScore, 78.5);
  assert.equal((report.evidence.aiResult as any).shapFeatureCount, 2);
  assert.equal(JSON.stringify(report).includes("secret"), false);
});

for (const [name, digest, expected] of [
  ["valid prefixed digest", `sha256:${"0123456789abcdef".repeat(4)}`, "PASS"],
  ["unprefixed digest", "a".repeat(64), "FAIL"],
  ["short digest", `sha256:${"a".repeat(63)}`, "FAIL"],
  ["long digest", `sha256:${"a".repeat(65)}`, "FAIL"],
  ["non-hex digest", `sha256:${"g".repeat(64)}`, "FAIL"],
  ["uppercase digest", `sha256:${"A".repeat(64)}`, "FAIL"],
] as const) {
  test(`archive proof validates ${name}`, async () => {
    const source = new ValidDataSource();
    source.digest = digest;
    const report = await new GenerateSystemProofService(source, () => NOW)
      .execute({ eventId: EVENT_ID, orgId: ORG_ID });
    assert.equal(stageStatus(report, "verified_archive"), expected);
    assert.equal(report.passed, expected === "PASS");
  });
}

test("discovers the latest incident-linked event when no ID is supplied", async () => {
  const source = new ValidDataSource();
  const report = await new GenerateSystemProofService(source, () => NOW).execute({
    orgId: ORG_ID,
  });

  assert.equal(source.latestLookupOrgId, ORG_ID);
  assert.equal(report.eventId, EVENT_ID);
  assert.equal(report.eventSelection, "latest-linked-event");
  assert.equal(report.passed, true);
});

test("fails transparently when genuine AI inference is absent or fallback-marked", async () => {
  const missing = new ValidDataSource();
  missing.ai = null;
  const missingReport = await new GenerateSystemProofService(missing, () => NOW)
    .execute({ eventId: EVENT_ID, orgId: ORG_ID });
  assert.equal(missingReport.passed, false);
  assert.equal(stageStatus(missingReport, "ai_inference"), "FAIL");

  const fallback = new ValidDataSource();
  fallback.ai = { ...fallback.ai!, usedFallback: true };
  const fallbackReport = await new GenerateSystemProofService(fallback, () => NOW)
    .execute({ eventId: EVENT_ID, orgId: ORG_ID });
  assert.equal(fallbackReport.passed, false);
  assert.equal(stageStatus(fallbackReport, "ai_inference"), "FAIL");
});

test("fails closed on tenant crossing, inconsistent counts, and Redis marker mismatch", async () => {
  const source = new ValidDataSource();
  source.incident = { ...source.incident!, orgId: "organization-foreign", alertCount: 99 };
  source.marker = "different-notification";
  const report = await new GenerateSystemProofService(source, () => NOW).execute({
    eventId: EVENT_ID,
    orgId: ORG_ID,
  });

  assert.equal(report.passed, false);
  assert.equal(stageStatus(report, "incident_correlation"), "FAIL");
  assert.equal(stageStatus(report, "redis_publication"), "FAIL");
});

test("explicit diagnostic relaxations are visible and never hide core failures", async () => {
  const source = new ValidDataSource();
  source.notification = { ...source.notification!, status: "pending", publishedAt: null };
  source.marker = null;
  source.collector = null;
  const report = await new GenerateSystemProofService(source, () => NOW).execute({
    eventId: EVENT_ID,
    orgId: ORG_ID,
    requirePublishedNotification: false,
    requireCollectorHeartbeat: false,
  });

  assert.equal(report.passed, true);
  assert.equal((report.stages.find((stage) => stage.id === "redis_publication")?.details as any).required, false);
  assert.equal((report.stages.find((stage) => stage.id === "collector_heartbeat")?.details as any).required, false);
});

test("professor-facing text formatter reports the real verdict and main measurements", async () => {
  const report = await new GenerateSystemProofService(new ValidDataSource(), () => NOW)
    .execute({ eventId: EVENT_ID, orgId: ORG_ID });
  const text = formatSystemProof(report);

  assert.match(text, /TRIVIKRAMA END-TO-END SIEM PROOF/u);
  assert.match(text, /Incident ID:\s+00000000-0000-4000-8000-000000000701/u);
  assert.match(text, /AI anomaly score:\s+0\.91/u);
  assert.match(text, /OVERALL RESULT: PASS/u);
});

class ValidDataSource implements SystemProofDataSource {
  public digest = `sha256:${"a".repeat(64)}`;
  public latestLookupOrgId: string | null = null;
  public marker: string | null = NOTIFICATION_ID;
  public ai: Awaited<ReturnType<SystemProofDataSource["findAiResult"]>> = {
    eventId: EVENT_ID, batchId: "batch-proof-001", orgId: ORG_ID,
    modelName: "isolation_forest_v1", modelVersion: "model-proof-v1",
    anomalyScore: 0.91, confidence: 0.98, isAnomaly: true, usedFallback: false,
    processingTimeMs: 12, inputFeatureCount: 20, shapFeatureCount: 2, createdAt: NOW,
  };
  public incident: Awaited<ReturnType<SystemProofDataSource["findIncident"]>> = {
    id: INCIDENT_ID, orgId: ORG_ID, status: "open", severity: "high", riskScore: 78.5,
    source: "both", alertCount: 2, eventCount: 1, primaryEntity: "192.0.2.10", createdAt: NOW,
  };
  public notification: Awaited<ReturnType<SystemProofDataSource["findNotification"]>> = {
    id: NOTIFICATION_ID, incidentId: INCIDENT_ID, orgId: ORG_ID,
    type: "INCIDENT_CREATED", channel: "incidents:new", status: "published",
    attemptCount: 1, publishedAt: NOW,
  };
  public collector: Awaited<ReturnType<SystemProofDataSource["findCollectorStatus"]>> = {
    collectorId: "collector-proof", orgId: ORG_ID, status: "online", lastHeartbeatAt: NOW,
    filesProcessed: 1, eventsCollected: 10, errorsCount: 0,
  };

  public async resolveLatestEventId(orgId: string) { this.latestLookupOrgId = orgId; return EVENT_ID; }
  public async findNormalizedEvent() {
    return {
      eventId: EVENT_ID, batchId: "batch-proof-001", collectorId: "collector-proof", orgId: ORG_ID,
      classUid: 3002, severityId: 4, schemaValid: true,
      features: Object.fromEntries(AI_FEATURE_NAMES.map((name, index) => [name, index])),
      ingestedAt: new Date(NOW.getTime() - 250), pipelineDurationMs: 250,
    };
  }
  public async findRawArchive() {
    return {
      batchId: "batch-proof-001", collectorId: "collector-proof", orgId: ORG_ID,
      canonicalUnsignedSha256: this.digest, eventCount: 10, storedEventCount: 10, archivedAt: NOW,
    };
  }
  public async findAiResult() { return this.ai; }
  public async listIncidentLinks() { return [{ incidentId: INCIDENT_ID, eventId: EVENT_ID, eventTime: NOW }]; }
  public async findIncident() { return this.incident; }
  public async listIncidentAlerts() {
    return [
      { id: "rule-alert", type: "rule" as const, ruleName: "SSH Brute Force", anomalyScore: null, severity: "high", matchedEventIds: [EVENT_ID] },
      { id: "ai-alert", type: "ai" as const, ruleName: null, anomalyScore: 0.91, severity: "high", matchedEventIds: [EVENT_ID] },
    ];
  }
  public async listIncidentEvents() { return [{ incidentId: INCIDENT_ID, eventId: EVENT_ID, eventTime: NOW }]; }
  public async listIncidentAudits() { return [{ id: "audit-1", action: "incident_create", targetId: INCIDENT_ID, orgId: ORG_ID, createdAt: NOW }]; }
  public async findNotification() { return this.notification; }
  public async findCollectorStatus() { return this.collector; }
  public async getPublishedNotificationMarker() { return this.marker; }
}

function stageStatus(report: { stages: readonly { id: string; status: string }[] }, id: string) {
  return report.stages.find((stage) => stage.id === id)?.status;
}

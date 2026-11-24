import assert from "node:assert/strict";
import test from "node:test";
import { incidentAlertPageSchema, incidentContextSchema, incidentDetailSchema, incidentEventPageSchema, incidentTimelinePageSchema } from "../src/services/api/incident-schemas";

const INCIDENT_ID = "00000000-0000-4000-8000-000000000501";
const PAGINATION = { page: 1, limit: 50, total: 1, totalPages: 1, hasNext: false, hasPrev: false };

test("FE-02B validates and allowlists incident detail risk evidence", () => {
  const detail = incidentDetailSchema.parse({
    id: INCIDENT_ID, title: "SSH brute force", description: "Repeated authentication failures", status: "open", severity: "high", riskScore: 80.67, source: "both",
    scoreBreakdown: { factors: { ruleWeight: { value: .8, weight: .35, contribution: .28, availability: "observed", source: "highest rule alert weight" } }, rawScore: .8067, finalScore: 80.67, formula: "rule + ai = 80.67" },
    primaryEntity: "203.0.113.251", entityType: "src_ip", entities: [{ type: "src_ip", value: "203.0.113.251" }], killChainStages: ["credential_access"],
    alertCount: 2, eventCount: 10, assignedTo: null, firstEventAt: "2026-11-10T10:00:00.000Z", lastEventAt: "2026-11-10T10:04:00.000Z", createdAt: "2026-11-10T10:05:00.000Z", updatedAt: "2026-11-10T10:06:00.000Z", resolvedAt: null, closedAt: null,
    orgId: "must-not-reach-the-view", internalCorrelationKey: "private",
  });
  assert.equal(detail.scoreBreakdown.factors?.ruleWeight?.value, .8);
  assert.equal("orgId" in detail, false);
  assert.equal("internalCorrelationKey" in detail, false);
});

test("FE-02B validates alert and normalized event evidence", () => {
  const alerts = incidentAlertPageSchema.parse({ data: [{
    id: "00000000-0000-4000-8000-000000000602", incidentId: INCIDENT_ID, alertType: "ai", ruleId: null, ruleName: null, matchedCondition: null,
    anomalyScore: .89, confidence: .92, threatCategory: "brute_force", modelVersion: "v1", shapValues: { baseValue: .32, features: [{ name: "failed_login_count_10min", value: 12, shapValue: .22 }] }, severity: "high", weight: .75, tags: ["ai.anomaly"], matchedEventIds: ["event-1"], createdAt: "2026-11-10T10:05:00.000Z", orgId: "discarded",
  }], pagination: PAGINATION });
  assert.equal(alerts.data[0]?.alertType, "ai");
  assert.equal("orgId" in alerts.data[0]!, false);

  const events = incidentEventPageSchema.parse({ data: [{
    eventId: "sha256:abc", classUid: 3002, categoryUid: 3, severityId: 4, statusId: 2, time: "2026-11-10T10:00:00.000Z", message: "Failed login", srcEndpoint: { ip: "203.0.113.251" }, metadata: { version: "1.1.0" }, ingestion: { batchId: "batch-1", collectorId: "collector-1", ingestedAt: "2026-11-10T10:00:01.000Z" }, rawPayload: "discarded",
  }], pagination: { ...PAGINATION, limit: 25 } });
  assert.equal(events.data[0]?.srcEndpoint?.ip, "203.0.113.251");
  assert.equal("rawPayload" in events.data[0]!, false);
});

test("FE-02B validates discriminated timeline and 30-day context", () => {
  const timeline = incidentTimelinePageSchema.parse({ data: [
    { id: "event:1", incidentId: INCIDENT_ID, type: "event", timestamp: "2026-11-10T10:00:00.000Z", eventId: "event-1", eventClassUid: 3002, eventSeverity: 4, eventMessage: "Failed login" },
    { id: "action:1", incidentId: INCIDENT_ID, type: "action", timestamp: "2026-11-10T10:05:00.000Z", action: "created", actorId: "system", actorName: "System", previousValue: null, newValue: "open", noteContent: null },
  ], pagination: { ...PAGINATION, total: 2 } });
  assert.equal(timeline.data[1]?.type, "action");

  const context = incidentContextSchema.parse({ previousIncidents: [{ id: "00000000-0000-4000-8000-000000000502", title: "Earlier activity", severity: "medium", status: "closed", createdAt: "2026-10-20T10:00:00.000Z", orgId: "discarded" }], assets: [{ name: "web-01", assetType: "server", ipAddress: "10.0.0.5", criticality: .9, owner: "Platform", department: "Engineering", tags: ["production"] }], entityHistory: { "203.0.113.251": { firstSeenAt: "2026-10-20T10:00:00.000Z", incidentCount30d: 2, alertCount30d: 5 } } });
  assert.equal(context.entityHistory["203.0.113.251"]?.alertCount30d, 5);
  assert.equal("orgId" in context.previousIncidents[0]!, false);
});

test("FE-02B rejects malformed cross-contract evidence", () => {
  assert.equal(incidentTimelinePageSchema.safeParse({ data: [{ id: "x", incidentId: INCIDENT_ID, type: "unknown", timestamp: "invalid" }], pagination: PAGINATION }).success, false);
  assert.equal(incidentContextSchema.safeParse({ previousIncidents: [], assets: [{ name: "db", assetType: "server", ipAddress: null, criticality: 2, owner: null, department: null, tags: [] }], entityHistory: {} }).success, false);
});

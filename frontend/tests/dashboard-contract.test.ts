import assert from "node:assert/strict";
import test from "node:test";
import {
  dashboardSourceBreakdownSchema,
  dashboardSummarySchema,
  dashboardTimelineSchema,
  dashboardTopAssetsSchema,
  recentIncidentPageSchema,
} from "../src/services/api/dashboard-schemas";
import { parseIncidentNotification } from "../src/services/websocket/incident-websocket";

test("FE-01B validates the implemented dashboard summary contract", () => {
  const result = dashboardSummarySchema.parse({
    timeRange: "24h",
    incidents: { open: 10, openTrend: 2.5, critical: 2, criticalTrend: -1, investigating: 3, resolvedToday: 4, closedToday: 1 },
    alerts: { totalToday: 20, alertsTrend: 5, ruleAlerts: 16, aiAlerts: 4 },
    events: { eventsPerSecond: 1.25, epsTrend: -2, totalToday: 108000 },
    responseTime: { avgMinutes: 18.4, avgTrend: -10, medianMinutes: 12 },
    severityDistribution: { critical: 2, high: 3, medium: 4, low: 1, informational: 0 },
    aiEngine: { status: "online", modelVersion: "v20261029_061230", anomaliesDetected: 4 },
  });
  assert.equal(result.incidents.open, 10);
  assert.equal(result.aiEngine.status, "online");
});

test("FE-01B validates timeline, asset, and source result contracts", () => {
  assert.equal(dashboardTimelineSchema.parse({
    timeRange: "24h",
    interval: "1h",
    buckets: [{ timestamp: "2026-11-10T00:00:00.000Z", critical: 1, high: 0, medium: 0, low: 0, informational: 0, total: 1 }],
  }).buckets.length, 1);
  assert.equal(dashboardTopAssetsSchema.parse({ assets: [{ entity: "host-01", entityType: "host", incidentCount: 2, criticalCount: 1, highCount: 1, latestIncidentAt: "2026-11-10T00:00:00.000Z" }] }).assets[0]?.entity, "host-01");
  assert.equal(dashboardSourceBreakdownSchema.parse({ sources: [{ source: "syslog", eventCount: 100, percentage: 100 }], total: 100 }).total, 100);
});

test("FE-01B keeps only allowlisted recent incident fields", () => {
  const response = recentIncidentPageSchema.parse({
    data: [{ id: "00000000-0000-4000-8000-000000000502", title: "SSH brute force", description: null, status: "open", severity: "high", riskScore: 82.4, source: "rule", primaryEntity: "host-01", entityType: "host", alertCount: 10, eventCount: 12, assignedTo: null, firstEventAt: "2026-11-10T00:00:00.000Z", lastEventAt: "2026-11-10T00:01:00.000Z", createdAt: "2026-11-10T00:00:00.000Z", updatedAt: "2026-11-10T00:01:00.000Z", scoreBreakdown: { private: "discarded" } }],
    pagination: { page: 1, limit: 8, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
  });
  assert.equal("scoreBreakdown" in response.data[0]!, false);
});

test("FE-01B accepts only allowlisted incident WebSocket messages", () => {
  const notification = parseIncidentNotification({ id: "n-1", type: "INCIDENT_CREATED", occurredAt: "2026-11-10T00:00:00.000Z", data: { incidentId: "incident-1" }, orgId: "must-not-propagate" });
  assert.equal(notification?.type, "INCIDENT_CREATED");
  assert.equal(notification ? "orgId" in notification : true, false);
  assert.equal(parseIncidentNotification({ id: "n-2", type: "COLLECTOR_STATUS", occurredAt: "2026-11-10T00:00:00.000Z", data: {} }), null);
  assert.equal(parseIncidentNotification({ id: "n-3", type: "INCIDENT_UPDATED", occurredAt: "invalid", data: {} }), null);
});

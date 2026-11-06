import assert from "node:assert/strict";
import test from "node:test";

import { DashboardIntervalTooFineError } from "../../../src/modules/dashboard/application/dashboard-window.js";
import { GetDashboardSourceBreakdownUseCase } from "../../../src/modules/dashboard/application/get-dashboard-source-breakdown.use-case.js";
import { GetDashboardSummaryUseCase } from "../../../src/modules/dashboard/application/get-dashboard-summary.use-case.js";
import { GetDashboardTimelineUseCase } from "../../../src/modules/dashboard/application/get-dashboard-timeline.use-case.js";
import { GetDashboardTopAssetsUseCase } from "../../../src/modules/dashboard/application/get-dashboard-top-assets.use-case.js";
import type { DashboardWindow, IDashboardEventRepository, IDashboardPostgresRepository } from "../../../src/modules/dashboard/domain/dashboard.contracts.js";

const NOW = new Date("2026-10-27T12:34:00.000Z");
const clock = { now: () => NOW };

test("DASH-01A summary uses trusted tenant windows and computes stable trends", async () => {
  const calls: unknown[] = [];
  const postgres = repository(calls);
  const events: IDashboardEventRepository = {
    async getMetrics(orgId, window) { calls.push(["events", orgId, window]); return { total: 86_400, previousTotal: 43_200 }; },
    async getSourceBreakdown() { return []; },
  };
  const result = await new GetDashboardSummaryUseCase(postgres, events, {
    async getStatus() { return { status: "online", modelVersion: "v1" }; },
  }, clock).execute({ orgId: "tenant-a", range: "24h" });

  assert.equal(result.incidents.openTrend, 100);
  assert.equal(result.incidents.criticalTrend, 2);
  assert.equal(result.alerts.alertsTrend, 50);
  assert.equal(result.events.eventsPerSecond, 1);
  assert.equal(result.events.epsTrend, 100);
  assert.equal(result.responseTime.avgTrend, -50);
  assert.deepEqual(result.aiEngine, { status: "online", modelVersion: "v1", anomaliesDetected: 3 });
  const window = (calls[0] as unknown[])[2] as DashboardWindow;
  assert.equal(window.to.toISOString(), NOW.toISOString());
  assert.equal(window.from.toISOString(), "2026-10-26T12:34:00.000Z");
  assert.equal(window.previousFrom.toISOString(), "2026-10-25T12:34:00.000Z");
  assert.ok(calls.every((call) => (call as unknown[])[1] === "tenant-a"));
});

test("DASH-01A timeline auto-selects interval and zero-fills missing severity buckets", async () => {
  const result = await new GetDashboardTimelineUseCase(repository([]), clock).execute({ orgId: "tenant-a", range: "1h" });
  assert.equal(result.interval, "5m");
  assert.equal(result.buckets.length, 13);
  assert.equal(result.buckets.reduce((sum, bucket) => sum + bucket.total, 0), 2);
  assert.equal(result.buckets.find((bucket) => bucket.timestamp.toISOString() === "2026-10-27T12:00:00.000Z")?.critical, 2);
});

test("DASH-01A rejects interval/range combinations exceeding the chart bound", async () => {
  await assert.rejects(
    () => new GetDashboardTimelineUseCase(repository([]), clock).execute({ orgId: "tenant-a", range: "30d", interval: "5m" }),
    DashboardIntervalTooFineError,
  );
});

test("DASH-01A returns bounded top assets and source percentages", async () => {
  const postgres = repository([]);
  const top = await new GetDashboardTopAssetsUseCase(postgres, clock).execute({ orgId: "tenant-a", range: "24h", limit: 5 });
  assert.equal(top.assets[0]?.entity, "web-01");
  const source = await new GetDashboardSourceBreakdownUseCase({
    async getMetrics() { return { total: 0, previousTotal: 0 }; },
    async getSourceBreakdown() { return [{ source: "syslog", eventCount: 3 }, { source: "file", eventCount: 1 }]; },
  }, clock).execute({ orgId: "tenant-a", range: "24h" });
  assert.equal(source.total, 4);
  assert.deepEqual(source.sources.map((row) => row.percentage), [75, 25]);
});

function repository(calls: unknown[]): IDashboardPostgresRepository {
  return {
    async getIncidentMetrics(orgId, window) {
      calls.push(["incidents", orgId, window]);
      return { open: 10, previousOpen: 5, critical: 3, previousCritical: 1, investigating: 2, resolved: 4, closed: 1, severity: { critical: 3, high: 2, medium: 3, low: 1, informational: 1 }, averageResponseMinutes: 20, previousAverageResponseMinutes: 40, medianResponseMinutes: 15 };
    },
    async getAlertMetrics(orgId, window) { calls.push(["alerts", orgId, window]); return { total: 9, previousTotal: 6, ruleAlerts: 6, aiAlerts: 3 }; },
    async getTimeline(orgId, window, intervalSeconds) {
      calls.push(["timeline", orgId, window, intervalSeconds]);
      return [{ timestamp: new Date("2026-10-27T12:00:00.000Z"), severity: "critical", count: 2 }];
    },
    async getTopAssets(orgId, window, limit) {
      calls.push(["top", orgId, window, limit]);
      return [{ entity: "web-01", entityType: "host", incidentCount: 4, criticalCount: 1, highCount: 2, latestIncidentAt: NOW }];
    },
  };
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { closeMongoDb, connectMongoDb, createMongoDbClient } from "../../../src/database/mongodb/client.js";
import { closePostgres, createPostgresClient } from "../../../src/database/postgres/client.js";
import { MongoNormalizedEventRepository } from "../../../src/database/repositories/mongodb/mongo-normalized-event.repository.js";
import type { NormalizedEventDocument } from "../../../src/database/repositories/mongodb/normalized-event.repository.js";
import { GetDashboardSourceBreakdownUseCase } from "../../../src/modules/dashboard/application/get-dashboard-source-breakdown.use-case.js";
import { GetDashboardSummaryUseCase } from "../../../src/modules/dashboard/application/get-dashboard-summary.use-case.js";
import { GetDashboardTimelineUseCase } from "../../../src/modules/dashboard/application/get-dashboard-timeline.use-case.js";
import { GetDashboardTopAssetsUseCase } from "../../../src/modules/dashboard/application/get-dashboard-top-assets.use-case.js";
import { MongoDashboardEventRepository } from "../../../src/modules/dashboard/infrastructure/mongo-dashboard-event.repository.js";
import { PostgresDashboardRepository } from "../../../src/modules/dashboard/infrastructure/postgres-dashboard.repository.js";

test("DASH-01A aggregates real tenant stores without cross-tenant leakage", async (context) => {
  if (process.env.NODE_ENV === "production") throw new Error("DASH-01A integration tests refuse to run in production.");
  const postgres = createPostgresClient({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/trivikrama", poolMin: 0, poolMax: 2 });
  const mongo = createMongoDbClient();
  await connectMongoDb(mongo, { uri: process.env.TEST_MONGODB_URI ?? process.env.MONGODB_URI ?? "mongodb://localhost:27017/trivikrama", maxPoolSize: 2, serverSelectionTimeoutMs: 5_000 });
  const suffix = randomUUID();
  const orgId = `dash-01a-${suffix}`;
  const otherOrgId = `dash-01a-other-${suffix}`;
  const now = new Date("2026-10-27T12:00:00.000Z");
  const eventCollection = mongo.db!.collection<NormalizedEventDocument>("normalized_events");

  context.after(async () => {
    try {
      await eventCollection.deleteMany({ org_id: { $in: [orgId, otherOrgId] } });
      await postgres("public.alerts").whereIn("org_id", [orgId, otherOrgId]).delete();
      await postgres("public.incidents").whereIn("org_id", [orgId, otherOrgId]).delete();
    } finally { await Promise.allSettled([closeMongoDb(mongo), closePostgres(postgres)]); }
  });

  const incidentIds = [randomUUID(), randomUUID(), randomUUID()];
  await postgres("public.incidents").insert([
    incident(incidentIds[0]!, orgId, "open", "critical", "web-01", new Date("2026-10-27T11:10:00.000Z")),
    incident(incidentIds[1]!, orgId, "resolved", "high", "web-01", new Date("2026-10-27T10:10:00.000Z"), new Date("2026-10-27T10:40:00.000Z")),
    incident(incidentIds[2]!, orgId, "investigating", "medium", "db-01", new Date("2026-10-26T13:10:00.000Z")),
    incident(randomUUID(), otherOrgId, "open", "critical", "foreign-host", new Date("2026-10-27T11:20:00.000Z")),
  ]);
  await postgres("public.alerts").insert([
    alert(randomUUID(), orgId, "rule", new Date("2026-10-27T11:20:00.000Z")),
    alert(randomUUID(), orgId, "ai", new Date("2026-10-27T11:30:00.000Z")),
    alert(randomUUID(), otherOrgId, "ai", new Date("2026-10-27T11:40:00.000Z")),
  ]);
  await new MongoNormalizedEventRepository(mongo).createMany([
    event(`syslog-${suffix}`, orgId, "syslog-main", "syslog", new Date("2026-10-27T11:45:00.000Z")),
    event(`syslog-2-${suffix}`, orgId, "syslog-main", "syslog", new Date("2026-10-27T11:46:00.000Z")),
    event(`file-${suffix}`, orgId, "file-main", "file", new Date("2026-10-27T11:47:00.000Z")),
    event(`foreign-${suffix}`, otherOrgId, "foreign", "http", new Date("2026-10-27T11:48:00.000Z")),
  ]);

  const relational = new PostgresDashboardRepository(postgres);
  const events = new MongoDashboardEventRepository(mongo);
  const clock = { now: () => now };
  const summary = await new GetDashboardSummaryUseCase(relational, events, { async getStatus() { return { status: "online", modelVersion: "integration-v1" }; } }, clock).execute({ orgId, range: "24h" });
  assert.equal(summary.incidents.open, 1);
  assert.equal(summary.incidents.critical, 1);
  assert.equal(summary.alerts.totalToday, 2);
  assert.equal(summary.events.totalToday, 3);
  assert.equal(summary.aiEngine.anomaliesDetected, 1);

  const timeline = await new GetDashboardTimelineUseCase(relational, clock).execute({ orgId, range: "24h", interval: "1h" });
  assert.equal(timeline.buckets.reduce((total, bucket) => total + bucket.total, 0), 3);
  const top = await new GetDashboardTopAssetsUseCase(relational, clock).execute({ orgId, range: "24h", limit: 10 });
  assert.equal(top.assets[0]?.entity, "web-01");
  assert.equal(top.assets[0]?.incidentCount, 2);
  const sources = await new GetDashboardSourceBreakdownUseCase(events, clock).execute({ orgId, range: "24h" });
  assert.equal(sources.total, 3);
  assert.deepEqual(sources.sources.map((source) => [source.source, source.eventCount]), [["syslog", 2], ["file", 1]]);
});

function incident(id: string, orgId: string, status: string, severity: string, entity: string, createdAt: Date, resolvedAt: Date | null = null) {
  return { id, title: `Dashboard ${entity}`, status, severity, risk_score: 70, source: "rule", primary_entity: entity, entity_type: "host", alert_count: 1, event_count: 1, created_at: createdAt, updated_at: createdAt, resolved_at: resolvedAt, org_id: orgId };
}
function alert(id: string, orgId: string, alertType: string, createdAt: Date) { return { id, alert_type: alertType, severity: "high", weight: 0.8, created_at: createdAt, org_id: orgId }; }
function event(eventId: string, orgId: string, collectorId: string, sourceType: string, time: Date): NormalizedEventDocument {
  return { event_id: eventId, class_uid: 3002, category_uid: 3, severity_id: 4, time, message: "dashboard integration event", metadata: { version: "1.1.0", product: { source_type: sourceType } }, ingestion: { batch_id: `batch-${eventId}`, collector_id: collectorId, ingested_at: time }, org_id: orgId };
}

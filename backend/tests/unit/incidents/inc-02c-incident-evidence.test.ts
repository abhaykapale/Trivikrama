import assert from "node:assert/strict";
import test from "node:test";

import type { NormalizedEventDocument } from "../../../src/database/repositories/mongodb/normalized-event.repository.js";
import { ListIncidentAlertsUseCase } from "../../../src/modules/incidents/application/list-incident-alerts.use-case.js";
import { ListIncidentEventsUseCase } from "../../../src/modules/incidents/application/list-incident-events.use-case.js";
import type {
  IncidentAlertQueryPage,
  IncidentEventLinkQueryPage,
  ListIncidentAlertsQuery,
  ListIncidentEventsQuery,
} from "../../../src/modules/incidents/domain/incident-evidence.contracts.js";
import type { IncidentQueryRecord } from "../../../src/modules/incidents/domain/incident-query.contracts.js";

const INCIDENT_ID = "00000000-0000-4000-8000-000000000501";

test("lists tenant-scoped alerts with stable pagination metadata", async () => {
  const harness = createHarness();
  harness.evidence.alertPage = {
    items: [alertView()],
    total: 3,
  };
  const input: ListIncidentAlertsQuery = {
    incidentId: INCIDENT_ID,
    orgId: "org-alpha",
    type: "rule",
    page: 2,
    limit: 2,
  };

  const result = await harness.alerts.execute(input);

  assert.deepEqual(result?.data, [alertView()]);
  assert.deepEqual(result?.pagination, {
    page: 2,
    limit: 2,
    total: 3,
    totalPages: 2,
    hasNext: false,
    hasPrev: true,
  });
  assert.deepEqual(harness.evidence.alertInputs, [input]);
});

test("lists only same-tenant linked normalized events in PostgreSQL order", async () => {
  const harness = createHarness();
  harness.evidence.eventPage = {
    items: [
      { eventId: "event-later", eventTime: new Date("2026-10-18T01:01:00Z") },
      { eventId: "event-first", eventTime: new Date("2026-10-18T01:02:00Z") },
      { eventId: "event-foreign", eventTime: new Date("2026-10-18T01:03:00Z") },
    ],
    total: 5,
  };
  harness.normalized.documents = [
    event("event-first", "org-alpha"),
    event("event-foreign", "org-other"),
    event("event-later", "org-alpha"),
  ];
  const input: ListIncidentEventsQuery = {
    incidentId: INCIDENT_ID,
    orgId: "org-alpha",
    page: 1,
    limit: 3,
  };

  const result = await harness.events.execute(input);

  assert.deepEqual(
    result?.data.map((item) => item.eventId),
    ["event-later", "event-first"],
  );
  assert.equal(JSON.stringify(result).includes("org-other"), false);
  assert.deepEqual(result?.data[0]?.ingestion, {
    batchId: "batch-inc-02c",
    collectorId: "collector-inc-02c",
    ingestedAt: new Date("2026-10-18T01:00:01.000Z"),
  });
  assert.deepEqual(harness.normalized.requestedIds, [
    ["event-later", "event-first", "event-foreign"],
  ]);
  assert.equal(result?.pagination.total, 5);
});

test("missing or cross-tenant incidents short-circuit every evidence source", async () => {
  const harness = createHarness();
  harness.incidents.result = null;

  const alertResult = await harness.alerts.execute(alertInput());
  const eventResult = await harness.events.execute(eventInput());

  assert.equal(alertResult, null);
  assert.equal(eventResult, null);
  assert.equal(harness.evidence.alertInputs.length, 0);
  assert.equal(harness.evidence.eventInputs.length, 0);
  assert.equal(harness.normalized.requestedIds.length, 0);
});

test("an empty linked-event page does not query MongoDB", async () => {
  const harness = createHarness();

  const result = await harness.events.execute(eventInput());

  assert.deepEqual(result?.data, []);
  assert.equal(harness.normalized.requestedIds.length, 0);
});

function createHarness() {
  const incidents = {
    result: incident() as IncidentQueryRecord | null,
    async findById() {
      return this.result;
    },
  };
  const evidence = {
    alertPage: { items: [], total: 0 } as IncidentAlertQueryPage,
    eventPage: { items: [], total: 0 } as IncidentEventLinkQueryPage,
    alertInputs: [] as ListIncidentAlertsQuery[],
    eventInputs: [] as ListIncidentEventsQuery[],
    async listAlerts(input: ListIncidentAlertsQuery) {
      this.alertInputs.push(input);
      return this.alertPage;
    },
    async listEventLinks(input: ListIncidentEventsQuery) {
      this.eventInputs.push(input);
      return this.eventPage;
    },
  };
  const normalized = {
    documents: [] as NormalizedEventDocument[],
    requestedIds: [] as string[][],
    async listByEventIds(ids: readonly string[]) {
      this.requestedIds.push([...ids]);
      return this.documents;
    },
  };

  return {
    incidents,
    evidence,
    normalized,
    alerts: new ListIncidentAlertsUseCase(incidents, evidence),
    events: new ListIncidentEventsUseCase(incidents, evidence, normalized),
  };
}

function alertInput(): ListIncidentAlertsQuery {
  return { incidentId: INCIDENT_ID, orgId: "org-alpha", page: 1, limit: 50 };
}

function eventInput(): ListIncidentEventsQuery {
  return { incidentId: INCIDENT_ID, orgId: "org-alpha", page: 1, limit: 25 };
}

function alertView() {
  return {
    id: "00000000-0000-4000-8000-000000000601",
    incidentId: INCIDENT_ID,
    alertType: "rule" as const,
    ruleId: "00000000-0000-4000-8000-000000000701",
    ruleName: "SSH Brute Force",
    matchedCondition: "count >= 10",
    anomalyScore: null,
    confidence: null,
    threatCategory: null,
    modelVersion: null,
    shapValues: null,
    severity: "high" as const,
    weight: 0.8,
    tags: ["attack.t1110"],
    matchedEventIds: ["event-first"],
    createdAt: new Date("2026-10-18T01:05:00.000Z"),
  };
}

function event(eventId: string, orgId: string): NormalizedEventDocument {
  return {
    event_id: eventId,
    class_uid: 3002,
    category_uid: 3,
    severity_id: 3,
    time: new Date("2026-10-18T01:00:00.000Z"),
    message: `Message for ${eventId}`,
    metadata: { version: "1.1.0" },
    ingestion: {
      batch_id: "batch-inc-02c",
      collector_id: "collector-inc-02c",
      ingested_at: new Date("2026-10-18T01:00:01.000Z"),
    },
    org_id: orgId,
  };
}

function incident(): IncidentQueryRecord {
  return {
    id: INCIDENT_ID,
    title: "HIGH — SSH brute force",
    description: null,
    status: "open",
    severity: "high",
    riskScore: 78.5,
    source: "both",
    scoreBreakdown: {},
    primaryEntity: "192.168.1.100",
    entityType: "src_ip",
    entities: [],
    killChainStages: [],
    alertCount: 1,
    eventCount: 1,
    assignedTo: null,
    firstEventAt: null,
    lastEventAt: null,
    createdAt: new Date("2026-10-18T01:00:00.000Z"),
    updatedAt: new Date("2026-10-18T01:00:00.000Z"),
    resolvedAt: null,
    closedAt: null,
  };
}

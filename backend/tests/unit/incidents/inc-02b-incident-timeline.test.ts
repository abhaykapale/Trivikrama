import assert from "node:assert/strict";
import test from "node:test";

import type { NormalizedEventDocument } from "../../../src/database/repositories/mongodb/normalized-event.repository.js";
import { GetIncidentTimelineUseCase } from "../../../src/modules/incidents/application/get-incident-timeline.use-case.js";
import type {
  GetIncidentQuery,
  IncidentQueryRecord,
} from "../../../src/modules/incidents/domain/incident-query.contracts.js";
import type {
  GetIncidentTimelineQuery,
  IncidentTimelinePage,
} from "../../../src/modules/incidents/domain/incident-timeline.contracts.js";

test("builds a chronological mixed timeline and enriches only same-tenant events", async () => {
  const harness = createHarness();
  harness.timeline.page = {
    items: [
      {
        id: "event:1",
        type: "event",
        timestamp: new Date("2026-10-18T01:00:00.000Z"),
        eventId: "event-visible",
        eventClassUid: 3002,
        eventSeverity: 3,
      },
      {
        id: "event:2",
        type: "event",
        timestamp: new Date("2026-10-18T01:01:00.000Z"),
        eventId: "event-foreign",
        eventClassUid: 1007,
        eventSeverity: 4,
      },
      {
        id: "alert:1",
        type: "alert",
        timestamp: new Date("2026-10-18T01:02:00.000Z"),
        alertId: "00000000-0000-4000-8000-000000000601",
        alertType: "rule",
        alertSeverity: "high",
        alertTitle: "SSH Brute Force",
        anomalyScore: null,
      },
      {
        id: "action:1",
        type: "action",
        timestamp: new Date("2026-10-18T01:03:00.000Z"),
        action: "created",
        actorId: "system",
        actorName: "System",
        previousValue: null,
        newValue: "open",
        noteContent: null,
      },
    ],
    total: 6,
  };
  harness.normalized.documents = [
    normalizedEvent("event-visible", "org-alpha", "Visible message"),
    normalizedEvent("event-foreign", "org-other", "Secret foreign message"),
  ];
  const input = timelineInput();

  const result = await harness.useCase.execute(input);

  assert.ok(result !== null);
  assert.equal(result.data.every((entry) => entry.incidentId === input.incidentId), true);
  assert.equal(result.data[0]?.type, "event");
  assert.equal(
    result.data[0]?.type === "event" ? result.data[0].eventMessage : null,
    "Visible message",
  );
  assert.equal(
    result.data[1]?.type === "event" ? result.data[1].eventMessage : "wrong",
    null,
  );
  assert.equal(JSON.stringify(result).includes("Secret foreign message"), false);
  assert.deepEqual(result.pagination, {
    page: 1,
    limit: 4,
    total: 6,
    totalPages: 2,
    hasNext: true,
    hasPrev: false,
  });
  assert.deepEqual(harness.timeline.inputs, [input]);
  assert.deepEqual(harness.normalized.requestedEventIds, [
    ["event-visible", "event-foreign"],
  ]);
});

test("does not query timeline sources for a missing or cross-tenant incident", async () => {
  const harness = createHarness();
  harness.incidents.result = null;

  const result = await harness.useCase.execute(timelineInput());

  assert.equal(result, null);
  assert.equal(harness.timeline.inputs.length, 0);
  assert.equal(harness.normalized.requestedEventIds.length, 0);
});

test("does not call MongoDB when the selected page contains no events", async () => {
  const harness = createHarness();
  harness.timeline.page = {
    items: [
      {
        id: "action:1",
        type: "action",
        timestamp: new Date("2026-10-18T01:03:00.000Z"),
        action: "status_change",
        actorId: "system",
        actorName: "System",
        previousValue: "open",
        newValue: "closed",
        noteContent: null,
      },
    ],
    total: 1,
  };

  const result = await harness.useCase.execute({
    ...timelineInput(),
    type: "action",
  });

  assert.equal(result?.data[0]?.type, "action");
  assert.equal(harness.normalized.requestedEventIds.length, 0);
});

function createHarness() {
  const incidents = {
    result: incidentRecord() as IncidentQueryRecord | null,
    inputs: [] as GetIncidentQuery[],
    async findById(input: GetIncidentQuery) {
      this.inputs.push(input);
      return this.result;
    },
  };
  const timeline = {
    page: { items: [], total: 0 } as IncidentTimelinePage,
    inputs: [] as GetIncidentTimelineQuery[],
    async list(input: GetIncidentTimelineQuery) {
      this.inputs.push(input);
      return this.page;
    },
  };
  const normalized = {
    documents: [] as NormalizedEventDocument[],
    requestedEventIds: [] as string[][],
    async listByEventIds(eventIds: readonly string[]) {
      this.requestedEventIds.push([...eventIds]);
      return this.documents;
    },
  };

  return {
    incidents,
    timeline,
    normalized,
    useCase: new GetIncidentTimelineUseCase({
      incidentQueries: incidents,
      timeline,
      normalizedEvents: normalized,
    }),
  };
}

function timelineInput(): GetIncidentTimelineQuery {
  return {
    incidentId: "00000000-0000-4000-8000-000000000501",
    orgId: "org-alpha",
    page: 1,
    limit: 4,
  };
}

function incidentRecord(): IncidentQueryRecord {
  return {
    id: "00000000-0000-4000-8000-000000000501",
    title: "HIGH — SSH brute force",
    description: null,
    status: "open",
    severity: "high",
    riskScore: 78.5,
    source: "both",
    scoreBreakdown: {},
    primaryEntity: "192.168.1.100",
    entityType: "src_ip",
    entities: [{ type: "src_ip", value: "192.168.1.100" }],
    killChainStages: [],
    alertCount: 2,
    eventCount: 2,
    assignedTo: null,
    firstEventAt: null,
    lastEventAt: null,
    createdAt: new Date("2026-10-18T01:00:00.000Z"),
    updatedAt: new Date("2026-10-18T01:00:00.000Z"),
    resolvedAt: null,
    closedAt: null,
  };
}

function normalizedEvent(
  eventId: string,
  orgId: string,
  message: string,
): NormalizedEventDocument {
  return {
    event_id: eventId,
    class_uid: 3002,
    category_uid: 3,
    severity_id: 3,
    time: new Date("2026-10-18T01:00:00.000Z"),
    message,
    metadata: { version: "1.1.0" },
    ingestion: {
      batch_id: "batch-inc-02b",
      collector_id: "collector-inc-02b",
      ingested_at: new Date("2026-10-18T01:00:01.000Z"),
    },
    org_id: orgId,
  };
}

import assert from "node:assert/strict";
import test from "node:test";

import type { AlertRecord, CreateAlertInput } from "../../../src/database/repositories/alerts/index.js";
import type { IncidentRecord } from "../../../src/database/repositories/incidents/index.js";
import {
  TransactionalIncidentCorrelator,
  type CorrelateIncidentAlertsInput,
  type IncidentCorrelationTransaction,
  type IncidentCorrelationUnitOfWork,
} from "../../../src/modules/incidents/index.js";

const ORG_ID = "incident-test-org";
const EVENT_TIME = new Date("2026-10-11T06:00:00.000Z");

test("creates one scored incident and merges rule plus AI evidence", async () => {
  const unitOfWork = new InMemoryCorrelationUnitOfWork();
  const correlator = new TransactionalIncidentCorrelator({ unitOfWork });

  const result = await correlator.correlate(input());

  assert.equal(result.incidentsCreated, 1);
  assert.equal(result.incidentsUpdated, 1);
  assert.equal(result.alertsAttached, 2);
  assert.equal(result.eventLinksCreated, 1);
  assert.equal(result.replayedAlerts, 0);
  assert.equal(unitOfWork.incidents.size, 1);
  const incident = [...unitOfWork.incidents.values()][0]!;
  assert.equal(incident.alertCount, 2);
  assert.equal(incident.eventCount, 1);
  assert.equal(incident.source, "both");
  assert.ok(incident.riskScore > 0);
  assert.equal(unitOfWork.audit.length, 2);
});

test("replaying the same correlation input creates no duplicates", async () => {
  const unitOfWork = new InMemoryCorrelationUnitOfWork();
  const correlator = new TransactionalIncidentCorrelator({ unitOfWork });
  await correlator.correlate(input());
  const snapshot = snapshotCounts(unitOfWork);

  const replay = await correlator.correlate(input());

  assert.equal(replay.incidentsCreated, 0);
  assert.equal(replay.incidentsUpdated, 0);
  assert.equal(replay.alertsAttached, 0);
  assert.equal(replay.eventLinksCreated, 0);
  assert.equal(replay.replayedAlerts, 2);
  assert.deepEqual(snapshotCounts(unitOfWork), snapshot);
});

test("rejects changed evidence that reuses an existing deterministic alert ID", async () => {
  const unitOfWork = new InMemoryCorrelationUnitOfWork();
  const correlator = new TransactionalIncidentCorrelator({ unitOfWork });
  await correlator.correlate(input());
  const changed = input();
  changed.aiResults = [{ ...changed.aiResults[0]!, anomaly_score: 0.7 }];

  await assert.rejects(correlator.correlate(changed), /identity collision/u);
  assert.equal(unitOfWork.rollbackCount, 1);
});

test("leaves entity-less alerts standalone without creating an incident", async () => {
  const unitOfWork = new InMemoryCorrelationUnitOfWork();
  const correlator = new TransactionalIncidentCorrelator({ unitOfWork });
  const noEntity = input();
  noEntity.events[0] = {
    ...noEntity.events[0]!,
    src_endpoint: undefined,
    actor: undefined,
    device: undefined,
  };

  const result = await correlator.correlate(noEntity);

  assert.equal(result.standaloneAlerts, 2);
  assert.equal(result.incidentsCreated, 0);
  assert.equal(unitOfWork.incidents.size, 0);
  assert.equal(unitOfWork.alerts.size, 2);
});

test("rolls back every write when a later transaction step fails", async () => {
  const unitOfWork = new InMemoryCorrelationUnitOfWork();
  unitOfWork.failAudit = true;
  const correlator = new TransactionalIncidentCorrelator({ unitOfWork });

  await assert.rejects(correlator.correlate(input()), /simulated audit failure/u);
  assert.deepEqual(snapshotCounts(unitOfWork), {
    incidents: 0,
    alerts: 0,
    eventLinks: 0,
    audit: 0,
  });
  assert.equal(unitOfWork.rollbackCount, 1);
});

test("fails before opening a transaction when referenced events are missing", async () => {
  const unitOfWork = new InMemoryCorrelationUnitOfWork();
  const correlator = new TransactionalIncidentCorrelator({ unitOfWork });
  const missing = input();
  missing.events.length = 0;

  await assert.rejects(correlator.correlate(missing), /missing normalized events/u);
  assert.equal(unitOfWork.executeCount, 0);
});

function input(): MutableCorrelationInput {
  return {
    orgId: ORG_ID,
    ruleAlerts: [
      {
        id: "11111111-1111-8111-8111-111111111111",
        alertType: "rule",
        ruleId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        ruleName: "Failed Login",
        matchedCondition: "selection",
        severity: "high",
        weight: 0.8,
        tags: [],
        metadata: {},
        matchedEventIds: ["event-1"],
        createdAt: EVENT_TIME,
        orgId: ORG_ID,
      },
    ],
    aiResults: [
      {
        event_id: "event-1",
        model_name: "isolation_forest_v1",
        model_version: "v1",
        anomaly_score: 0.9,
        is_anomaly: true,
        confidence: 0.95,
        created_at: new Date(EVENT_TIME.getTime() + 1000),
        org_id: ORG_ID,
      },
    ],
    events: [
      {
        event_id: "event-1",
        org_id: ORG_ID,
        time: EVENT_TIME,
        class_uid: 3002,
        severity_id: 4,
        src_endpoint: { ip: "192.0.2.10" },
        actor: { user: { name: "ROOT" } },
        device: { hostname: "WEB-01.EXAMPLE.LOCAL" },
      },
    ],
    evaluatedAt: new Date("2026-10-11T06:01:00.000Z"),
  };
}

interface MutableCorrelationInput {
  orgId: string;
  ruleAlerts: CorrelateIncidentAlertsInput["ruleAlerts"];
  aiResults: CorrelateIncidentAlertsInput["aiResults"];
  events: Array<CorrelateIncidentAlertsInput["events"][number]>;
  evaluatedAt: Date;
}

class InMemoryCorrelationUnitOfWork implements IncidentCorrelationUnitOfWork {
  public incidents = new Map<string, IncidentRecord>();
  public alerts = new Map<string, AlertRecord>();
  public eventLinks = new Set<string>();
  public audit: unknown[] = [];
  public failAudit = false;
  public executeCount = 0;
  public rollbackCount = 0;
  private nextIncident = 1;

  public async execute<TResult>(
    operation: (transaction: IncidentCorrelationTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    this.executeCount += 1;
    const snapshot = structuredClone({
      incidents: this.incidents,
      alerts: this.alerts,
      eventLinks: this.eventLinks,
      audit: this.audit,
      nextIncident: this.nextIncident,
    });
    try {
      return await operation(this.transaction());
    } catch (error) {
      this.incidents = snapshot.incidents;
      this.alerts = snapshot.alerts;
      this.eventLinks = snapshot.eventLinks;
      this.audit = snapshot.audit;
      this.nextIncident = snapshot.nextIncident;
      this.rollbackCount += 1;
      throw error;
    }
  }

  private transaction(): IncidentCorrelationTransaction {
    return {
      incidents: {
        create: async (value) => {
          const now = new Date("2026-10-11T06:01:00.000Z");
          const id = value.id ?? `00000000-0000-4000-8000-${String(this.nextIncident++).padStart(12, "0")}`;
          const record: IncidentRecord = {
            id,
            title: value.title,
            description: value.description ?? null,
            status: value.status ?? "open",
            severity: value.severity ?? "medium",
            riskScore: value.riskScore ?? 0,
            source: value.source ?? "rule",
            scoreBreakdown: value.scoreBreakdown ?? {},
            primaryEntity: value.primaryEntity ?? null,
            entityType: value.entityType ?? null,
            entities: value.entities ?? [],
            killChainStages: value.killChainStages ?? [],
            alertCount: value.alertCount ?? 0,
            eventCount: value.eventCount ?? 0,
            assignedTo: value.assignedTo ?? null,
            firstEventAt: value.firstEventAt ?? null,
            lastEventAt: value.lastEventAt ?? null,
            createdAt: now,
            updatedAt: now,
            resolvedAt: value.resolvedAt ?? null,
            closedAt: value.closedAt ?? null,
            orgId: value.orgId ?? "default",
          };
          this.incidents.set(id, record);
          return record;
        },
        findById: async (id) => this.incidents.get(id) ?? null,
        findOpenCandidatesForUpdate: async (candidate) =>
          [...this.incidents.values()].filter(
            (incident) =>
              incident.orgId === candidate.orgId &&
              (incident.status === "open" || incident.status === "investigating") &&
              incident.lastEventAt !== null &&
              incident.lastEventAt >= candidate.activeAfter &&
              candidate.entities.some(
                (entity) =>
                  entity.type === incident.entityType &&
                  entity.value === incident.primaryEntity,
              ),
          ),
        update: async (id, update) => {
          const current = this.incidents.get(id);
          if (current === undefined) return null;
          const next = { ...current, ...update, updatedAt: new Date() } as IncidentRecord;
          this.incidents.set(id, next);
          return next;
        },
        transitionStatus: async (id, transition) => {
          const current = this.incidents.get(id);
          if (current === undefined) return null;
          const next: IncidentRecord = {
            ...current,
            status: transition.status,
            resolvedAt: transition.resolvedAt ?? current.resolvedAt,
            closedAt: transition.closedAt ?? current.closedAt,
          };
          this.incidents.set(id, next);
          return next;
        },
      },
      alerts: {
        createManyIfAbsent: async (inputs) => {
          let insertedCount = 0;
          const records = inputs.map((value) => {
            const id = value.id!;
            const existing = this.alerts.get(id);
            if (existing !== undefined) return existing;
            const record = alertRecord(value);
            this.alerts.set(id, record);
            insertedCount += 1;
            return record;
          });
          return { insertedCount, existingCount: inputs.length - insertedCount, records };
        },
        findById: async (id) => this.alerts.get(id) ?? null,
        attachToIncidentIfUnassigned: async (id, incidentId, orgId) => {
          const current = this.alerts.get(id);
          if (
            current === undefined ||
            current.orgId !== orgId ||
            (current.incidentId !== null && current.incidentId !== incidentId)
          ) return null;
          const next = { ...current, incidentId };
          this.alerts.set(id, next);
          return next;
        },
        listByIncident: async (incidentId, options = {}) => {
          const all = [...this.alerts.values()].filter((item) => item.incidentId === incidentId);
          const offset = options.offset ?? 0;
          const limit = options.limit ?? 50;
          return {
            items: all.slice(offset, offset + limit),
            offset,
            limit,
            hasMore: all.length > offset + limit,
          };
        },
      },
      incidentEvents: {
        createManyIfAbsent: async (inputs) => {
          let insertedCount = 0;
          for (const value of inputs) {
            const key = `${value.incidentId}|${value.eventId}|${value.eventTime.toISOString()}`;
            if (!this.eventLinks.has(key)) {
              this.eventLinks.add(key);
              insertedCount += 1;
            }
          }
          return { insertedCount, existingCount: inputs.length - insertedCount };
        },
      },
      audit: {
        create: async (value) => {
          if (this.failAudit) throw new Error("simulated audit failure");
          this.audit.push(value);
          return {} as never;
        },
      },
      assetCriticality: {
        resolve: async () => 0.8,
      },
    };
  }
}

function alertRecord(input: CreateAlertInput): AlertRecord {
  return {
    id: input.id!,
    incidentId: input.incidentId ?? null,
    alertType: input.alertType,
    ruleId: input.ruleId ?? null,
    ruleName: input.ruleName ?? null,
    matchedCondition: input.matchedCondition ?? null,
    anomalyScore: input.anomalyScore ?? null,
    confidence: input.confidence ?? null,
    threatCategory: input.threatCategory ?? null,
    modelVersion: input.modelVersion ?? null,
    shapValues: input.shapValues ?? null,
    severity: input.severity ?? "medium",
    weight: input.weight ?? 0.5,
    tags: input.tags ?? [],
    metadata: JSON.parse(JSON.stringify(input.metadata ?? {})) as Record<string, unknown>,
    matchedEventIds: input.matchedEventIds ?? [],
    createdAt: EVENT_TIME,
    orgId: input.orgId ?? "default",
  };
}

function snapshotCounts(unitOfWork: InMemoryCorrelationUnitOfWork) {
  return {
    incidents: unitOfWork.incidents.size,
    alerts: unitOfWork.alerts.size,
    eventLinks: unitOfWork.eventLinks.size,
    audit: unitOfWork.audit.length,
  };
}

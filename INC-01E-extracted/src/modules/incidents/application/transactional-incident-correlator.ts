import { isDeepStrictEqual } from "node:util";

import type { AlertRecord, CreateAlertInput } from "../../../database/repositories/alerts/alert.repository.js";
import type { CreateIncidentEventInput } from "../../../database/repositories/incident-events/incident-event.repository.js";
import type { IncidentRecord } from "../../../database/repositories/incidents/incident.repository.js";
import { IncidentCandidateSelector } from "./incident-candidate-ranker.js";
import { IncidentRiskScorer } from "./incident-risk-scorer.js";
import { UnifiedAlertDeduplicator } from "./unified-alert-deduplicator.js";
import { UnifiedAlertEntityExtractor } from "./unified-alert-entity-extractor.js";
import { UnifiedAlertMerger } from "./unified-alert-merger.js";
import { normalizeIncidentEntities } from "../domain/incident-entity.js";
import type {
  CorrelateIncidentAlertsInput,
  CorrelateIncidentAlertsResult,
  IncidentCorrelationEventSource,
  IncidentCorrelationTransaction,
  IncidentCorrelationUnitOfWork,
} from "../domain/incident-correlation.contracts.js";
import type {
  IncidentEntity,
  IncidentSeverity,
  IncidentSource,
} from "../domain/incident.contracts.js";
import type {
  UnifiedAiAlert,
  UnifiedAlert,
  UnifiedRuleAlert,
} from "../domain/unified-alert.contracts.js";

const MAX_ALERTS_PER_INCIDENT = 500;
const ALERT_PAGE_SIZE = 100;

export interface TransactionalIncidentCorrelatorDependencies {
  readonly unitOfWork: IncidentCorrelationUnitOfWork;
}

export class TransactionalIncidentCorrelator {
  public constructor(
    private readonly dependencies: TransactionalIncidentCorrelatorDependencies,
  ) {}

  public async correlate(
    input: CorrelateIncidentAlertsInput,
  ): Promise<CorrelateIncidentAlertsResult> {
    const evaluatedAt = validDate(input.evaluatedAt, "evaluatedAt");
    const merged = new UnifiedAlertMerger().merge({
      orgId: input.orgId,
      ruleAlerts: input.ruleAlerts,
      aiResults: input.aiResults,
    });
    const deduplicated = new UnifiedAlertDeduplicator().deduplicate(merged.alerts);
    const enriched = new UnifiedAlertEntityExtractor().enrich({
      orgId: input.orgId,
      alerts: deduplicated.alerts,
      events: input.events,
    });

    if (enriched.missingEventIds.length > 0) {
      throw new Error(
        `Incident correlation is missing normalized events: ${enriched.missingEventIds.join(", ")}.`,
      );
    }
    if (enriched.alerts.length === 0) return emptyResult();

    const eventsById = new Map(input.events.map((event) => [event.event_id, event]));
    const alerts = [...enriched.alerts].sort(compareAlerts);

    return this.dependencies.unitOfWork.execute(async (transaction) => {
      const persistence = await transaction.alerts.createManyIfAbsent(
        alerts.map(toCreateAlertInput),
      );
      verifyPersistedAlerts(alerts, persistence.records);

      const state = mutableResult();
      for (const alert of alerts) {
        const persisted = persistence.records.find((record) => record.id === alert.id);
        if (persisted === undefined) {
          throw new Error(`Persisted alert ${alert.id} is missing from the transaction result.`);
        }
        await this.correlateAlert(
          transaction,
          alert,
          persisted,
          eventsById,
          evaluatedAt,
          state,
        );
      }
      return freezeResult(state);
    });
  }

  private async correlateAlert(
    transaction: IncidentCorrelationTransaction,
    alert: UnifiedAlert,
    persisted: AlertRecord,
    eventsById: ReadonlyMap<string, IncidentCorrelationEventSource>,
    evaluatedAt: Date,
    state: MutableCorrelationResult,
  ): Promise<void> {
    if (persisted.incidentId !== null) {
      const replayIncident = await requireIncident(
        transaction,
        persisted.incidentId,
        alert.orgId,
      );
      state.replayedAlerts += 1;
      state.incidentIds.add(replayIncident.id);
      return;
    }

    if (alert.entities.length === 0) {
      state.standaloneAlerts += 1;
      return;
    }

    const selector = new IncidentCandidateSelector({
      findOpenCandidates: (candidateInput) =>
        transaction.incidents.findOpenCandidatesForUpdate(candidateInput),
    });
    const selection = await selector.select({ alert, evaluatedAt });

    for (const expiredId of selection.expiredCandidateIds) {
      const expired = await requireIncident(transaction, expiredId, alert.orgId);
      if (expired.status === "open" || expired.status === "investigating") {
        const closed = await transaction.incidents.transitionStatus(expired.id, {
          status: "closed",
          closedAt: evaluatedAt,
        });
        if (closed === null) throw new Error(`Expired incident ${expired.id} disappeared.`);
        await transaction.audit.create({
          action: "incident_status_change",
          targetType: "incident",
          targetId: expired.id,
          targetName: expired.title,
          details: { reason: "correlation_max_duration" },
          previousState: { status: expired.status },
          newState: { status: "closed" },
          orgId: alert.orgId,
        });
        state.expiredIncidentsClosed += 1;
      }
    }

    let incident = selection.selected;
    let created = false;
    if (incident === null || incident.alertCount >= MAX_ALERTS_PER_INCIDENT) {
      const primary = alert.entities[0]!;
      incident = await transaction.incidents.create({
        title: provisionalTitle(alert, primary),
        description: "Automatically created from correlated security detections.",
        status: "open",
        severity: alert.severity,
        source: alert.type,
        primaryEntity: primary.value,
        entityType: primary.type,
        entities: alert.entities,
        alertCount: 0,
        eventCount: 0,
        firstEventAt: null,
        lastEventAt: null,
        orgId: alert.orgId,
      });
      created = true;
    }

    const attached = await transaction.alerts.attachToIncidentIfUnassigned(
      alert.id,
      incident.id,
      alert.orgId,
    );
    if (attached === null) {
      const current = await transaction.alerts.findById(alert.id);
      if (current?.incidentId !== null && current?.incidentId !== undefined) {
        const replayIncident = await requireIncident(
          transaction,
          current.incidentId,
          alert.orgId,
        );
        state.replayedAlerts += 1;
        state.incidentIds.add(replayIncident.id);
        return;
      }
      throw new Error(`Alert ${alert.id} could not be attached atomically.`);
    }

    const eventInputs = alert.matchedEventIds.map((eventId) =>
      toIncidentEventInput(incident!.id, requireEvent(eventsById, eventId)),
    );
    const linked = await transaction.incidentEvents.createManyIfAbsent(eventInputs);
    const incidentAlerts = await loadIncidentAlerts(transaction, incident.id);
    if (incidentAlerts.length > MAX_ALERTS_PER_INCIDENT) {
      throw new Error(`Incident ${incident.id} exceeded the ${MAX_ALERTS_PER_INCIDENT}-alert cap.`);
    }

    const unifiedIncidentAlerts = incidentAlerts.map(toUnifiedAlert);
    const entities = normalizeIncidentEntities([
      ...incident.entities,
      ...alert.entities,
      ...unifiedIncidentAlerts.flatMap((item) => item.entities),
    ]);
    const eventTimes = eventInputs.map((item) => item.eventTime.getTime());
    const firstEventAt = minDate(incident.firstEventAt, eventTimes);
    const lastEventAt = maxDate(incident.lastEventAt, eventTimes);
    const source = deriveIncidentSource(unifiedIncidentAlerts);
    const scorer = new IncidentRiskScorer(transaction.assetCriticality);
    const score = await scorer.score({
      incidentId: incident.id,
      orgId: alert.orgId,
      alerts: unifiedIncidentAlerts,
      primaryEntity:
        incident.primaryEntity === null || incident.entityType === null
          ? null
          : { type: incident.entityType, value: incident.primaryEntity },
      killChainStages: incident.killChainStages,
    });
    const highestAlert = [...unifiedIncidentAlerts].sort(compareAlertSeverity)[0]!;
    const primaryEntity = entities[0] ?? null;
    const updated = await transaction.incidents.update(incident.id, {
      title: buildTitle(score.severity, highestAlert, primaryEntity),
      severity: score.severity,
      riskScore: score.riskScore,
      scoreBreakdown: { ...score.scoreBreakdown },
      source,
      entities,
      alertCount: incidentAlerts.length,
      eventCount: incident.eventCount + linked.insertedCount,
      firstEventAt,
      lastEventAt,
    });
    if (updated === null) throw new Error(`Incident ${incident.id} disappeared during update.`);

    await transaction.audit.create({
      action: created ? "incident_create" : "incident_update",
      targetType: "incident",
      targetId: updated.id,
      targetName: updated.title,
      details: {
        alertId: alert.id,
        eventIds: [...alert.matchedEventIds],
        riskScore: updated.riskScore,
      },
      previousState: created
        ? null
        : { alertCount: incident.alertCount, riskScore: incident.riskScore },
      newState: {
        alertCount: updated.alertCount,
        eventCount: updated.eventCount,
        riskScore: updated.riskScore,
        severity: updated.severity,
      },
      orgId: alert.orgId,
    });

    if (created) state.incidentsCreated += 1;
    else state.incidentsUpdated += 1;
    state.alertsAttached += 1;
    state.eventLinksCreated += linked.insertedCount;
    state.incidentIds.add(updated.id);
  }
}

interface MutableCorrelationResult {
  incidentsCreated: number;
  incidentsUpdated: number;
  expiredIncidentsClosed: number;
  alertsAttached: number;
  eventLinksCreated: number;
  standaloneAlerts: number;
  replayedAlerts: number;
  incidentIds: Set<string>;
}

function mutableResult(): MutableCorrelationResult {
  return {
    incidentsCreated: 0,
    incidentsUpdated: 0,
    expiredIncidentsClosed: 0,
    alertsAttached: 0,
    eventLinksCreated: 0,
    standaloneAlerts: 0,
    replayedAlerts: 0,
    incidentIds: new Set(),
  };
}

function emptyResult(): CorrelateIncidentAlertsResult {
  return freezeResult(mutableResult());
}

function freezeResult(state: MutableCorrelationResult): CorrelateIncidentAlertsResult {
  return Object.freeze({
    incidentsCreated: state.incidentsCreated,
    incidentsUpdated: state.incidentsUpdated,
    expiredIncidentsClosed: state.expiredIncidentsClosed,
    alertsAttached: state.alertsAttached,
    eventLinksCreated: state.eventLinksCreated,
    standaloneAlerts: state.standaloneAlerts,
    replayedAlerts: state.replayedAlerts,
    incidentIds: Object.freeze([...state.incidentIds].sort()),
  });
}

async function requireIncident(
  transaction: IncidentCorrelationTransaction,
  incidentId: string,
  orgId: string,
): Promise<IncidentRecord> {
  const incident = await transaction.incidents.findById(incidentId);
  if (incident === null) throw new Error(`Incident ${incidentId} does not exist.`);
  if (incident.orgId !== orgId) {
    throw new Error(`Incident ${incident.id} crossed the organization boundary.`);
  }
  return incident;
}

async function loadIncidentAlerts(
  transaction: IncidentCorrelationTransaction,
  incidentId: string,
): Promise<readonly AlertRecord[]> {
  const records: AlertRecord[] = [];
  for (let offset = 0; offset <= MAX_ALERTS_PER_INCIDENT; offset += ALERT_PAGE_SIZE) {
    const page = await transaction.alerts.listByIncident(incidentId, {
      limit: ALERT_PAGE_SIZE,
      offset,
    });
    records.push(...page.items);
    if (!page.hasMore) return records;
  }
  throw new Error(`Incident ${incidentId} exceeds the supported alert cap.`);
}

function toCreateAlertInput(alert: UnifiedAlert): CreateAlertInput {
  if (alert.type === "rule") {
    return {
      id: alert.id,
      incidentId: null,
      alertType: "rule",
      ruleId: alert.ruleId,
      ruleName: alert.ruleName,
      matchedCondition: alert.matchedCondition,
      severity: alert.severity,
      weight: alert.weight,
      tags: alert.tags,
      metadata: { ...alert.metadata },
      matchedEventIds: alert.matchedEventIds,
      orgId: alert.orgId,
    };
  }
  return {
    id: alert.id,
    incidentId: null,
    alertType: "ai",
    anomalyScore: alert.anomalyScore,
    confidence: alert.confidence,
    threatCategory: optionalString(alert.metadata.threatCategory),
    modelVersion: alert.modelVersion,
    shapValues: asRecord(alert.metadata.shapExplanation),
    severity: alert.severity,
    weight: alert.weight,
    tags: alert.tags,
    metadata: {
      ...alert.metadata,
      modelName: alert.modelName,
      correlationEntities: alert.entities,
    },
    matchedEventIds: alert.matchedEventIds,
    orgId: alert.orgId,
  };
}

function verifyPersistedAlerts(
  expected: readonly UnifiedAlert[],
  records: readonly AlertRecord[],
): void {
  if (records.length !== expected.length) {
    throw new Error("Idempotent alert persistence returned an incomplete result.");
  }
  const recordsById = new Map(records.map((record) => [record.id, record]));
  for (const alert of expected) {
    const record = recordsById.get(alert.id);
    if (record === undefined || !samePersistedAlert(alert, record)) {
      throw new Error(`Alert identity collision detected for ${alert.id}.`);
    }
  }
}

function samePersistedAlert(alert: UnifiedAlert, record: AlertRecord): boolean {
  if (
    record.alertType !== alert.type ||
    record.orgId !== alert.orgId ||
    record.severity !== alert.severity ||
    record.weight !== alert.weight ||
    !isDeepStrictEqual(stringArray(record.tags), [...alert.tags]) ||
    !isDeepStrictEqual(
      [...record.matchedEventIds].sort(),
      [...alert.matchedEventIds].sort(),
    )
  ) return false;
  if (alert.type === "rule") {
    return (
      record.ruleId === alert.ruleId &&
      record.ruleName === alert.ruleName &&
      record.matchedCondition === alert.matchedCondition &&
      record.anomalyScore === null &&
      record.confidence === null &&
      record.modelVersion === null &&
      record.shapValues === null &&
      isDeepStrictEqual(record.metadata, jsonObject(alert.metadata))
    );
  }
  const expectedMetadata = jsonObject({
    ...alert.metadata,
    modelName: alert.modelName,
    correlationEntities: alert.entities,
  });
  return (
    record.anomalyScore === alert.anomalyScore &&
    record.confidence === alert.confidence &&
    record.modelVersion === alert.modelVersion &&
    record.threatCategory === optionalString(alert.metadata.threatCategory) &&
    isDeepStrictEqual(record.shapValues, asRecord(alert.metadata.shapExplanation)) &&
    isDeepStrictEqual(record.metadata, expectedMetadata)
  );
}

function toUnifiedAlert(record: AlertRecord): UnifiedAlert {
  const common = {
    id: record.id,
    orgId: record.orgId,
    severity: record.severity,
    weight: record.weight,
    tags: stringArray(record.tags),
    matchedEventIds: stringArray(record.matchedEventIds),
    timestamp: new Date(record.createdAt),
    entities: entityArray(record.metadata.correlationEntities),
    metadata: Object.freeze({ ...record.metadata }),
  };
  if (record.alertType === "rule") {
    return Object.freeze({
      ...common,
      type: "rule",
      ruleId: requireString(record.ruleId, "ruleId"),
      ruleName: requireString(record.ruleName, "ruleName"),
      matchedCondition: requireString(record.matchedCondition, "matchedCondition"),
    }) satisfies UnifiedRuleAlert;
  }
  return Object.freeze({
    ...common,
    type: "ai",
    modelName: requireString(record.metadata.modelName, "modelName"),
    modelVersion: requireString(record.modelVersion, "modelVersion"),
    anomalyScore: requireNumber(record.anomalyScore, "anomalyScore"),
    confidence: record.confidence,
  }) satisfies UnifiedAiAlert;
}

function toIncidentEventInput(
  incidentId: string,
  event: IncidentCorrelationEventSource,
): CreateIncidentEventInput {
  return {
    incidentId,
    eventId: event.event_id,
    eventTime: validDate(event.time, "event.time"),
    classUid: event.class_uid,
    severityId: event.severity_id,
    srcIp: event.src_endpoint?.ip ?? null,
    dstIp: event.dst_endpoint?.ip ?? null,
    username: event.actor?.user?.name ?? null,
    hostname: event.device?.hostname ?? null,
  };
}

function requireEvent(
  events: ReadonlyMap<string, IncidentCorrelationEventSource>,
  eventId: string,
): IncidentCorrelationEventSource {
  const event = events.get(eventId);
  if (event === undefined) throw new Error(`Normalized event ${eventId} is unavailable.`);
  return event;
}

function deriveIncidentSource(alerts: readonly UnifiedAlert[]): IncidentSource {
  const hasRule = alerts.some((alert) => alert.type === "rule");
  const hasAi = alerts.some((alert) => alert.type === "ai");
  return hasRule && hasAi ? "both" : hasAi ? "ai" : "rule";
}

function provisionalTitle(alert: UnifiedAlert, entity: IncidentEntity): string {
  return buildTitle(alert.severity, alert, entity);
}

function buildTitle(
  severity: IncidentSeverity,
  alert: UnifiedAlert,
  entity: IncidentEntity | null,
): string {
  const finding = alert.type === "rule" ? alert.ruleName : "AI anomaly";
  const target = entity === null ? "unknown entity" : entity.value;
  return `${capitalize(severity)} - ${finding} on ${target}`.slice(0, 500);
}

function compareAlerts(left: UnifiedAlert, right: UnifiedAlert): number {
  return left.timestamp.getTime() - right.timestamp.getTime() || left.id.localeCompare(right.id);
}

const SEVERITY_RANK: Record<IncidentSeverity, number> = {
  informational: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function compareAlertSeverity(left: UnifiedAlert, right: UnifiedAlert): number {
  return SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity] || compareAlerts(left, right);
}

function minDate(current: Date | null, values: readonly number[]): Date | null {
  const candidates = [current?.getTime(), ...values].filter(
    (value): value is number => value !== undefined,
  );
  return candidates.length === 0 ? null : new Date(Math.min(...candidates));
}

function maxDate(current: Date | null, values: readonly number[]): Date | null {
  const candidates = [current?.getTime(), ...values].filter(
    (value): value is number => value !== undefined,
  );
  return candidates.length === 0 ? null : new Date(Math.max(...candidates));
}

function entityArray(value: unknown): readonly IncidentEntity[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return normalizeIncidentEntities(
    value.filter(
      (item): item is IncidentEntity =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { type?: unknown }).type === "string" &&
        typeof (item as { value?: unknown }).value === "string",
    ),
  );
}

function stringArray(values: readonly unknown[]): readonly string[] {
  return Object.freeze(values.map((value) => requireString(value, "array value")));
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : null;
}

function jsonObject(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-blank string.`);
  }
  return value.trim();
}

function requireNumber(value: number | null, fieldName: string): number {
  if (value === null || !Number.isFinite(value)) throw new Error(`${fieldName} must be numeric.`);
  return value;
}

function validDate(value: Date, fieldName: string): Date {
  const copy = new Date(value.getTime());
  if (!Number.isFinite(copy.getTime())) throw new Error(`${fieldName} must be a valid date.`);
  return copy;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

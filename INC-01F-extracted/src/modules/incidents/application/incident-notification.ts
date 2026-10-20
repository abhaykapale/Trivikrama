import { createHash, type Hash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type {
  EnqueueIncidentNotificationInput,
  IncidentNotificationChannel,
  IncidentNotificationPayload,
  IncidentNotificationType,
} from "../../../database/repositories/incident-notification-outbox/index.js";
import type { IncidentRecord } from "../../../database/repositories/incidents/incident.repository.js";

export interface CreateIncidentNotificationInput {
  readonly incident: IncidentRecord;
  readonly type: IncidentNotificationType;
  readonly occurredAt: Date;
  readonly causationId: string;
}

export function createIncidentNotification(
  input: CreateIncidentNotificationInput,
): EnqueueIncidentNotificationInput {
  const channel = channelFor(input.type);
  const deduplicationKey = [
    "incident-notification-v1",
    input.incident.orgId,
    input.incident.id,
    input.type,
    requireNonBlank(input.causationId, "causationId"),
  ].join(":");
  const id = deterministicUuid(deduplicationKey);
  const occurredAt = validDate(input.occurredAt, "occurredAt").toISOString();

  return Object.freeze({
    id,
    orgId: input.incident.orgId,
    incidentId: input.incident.id,
    eventType: input.type,
    channel,
    deduplicationKey,
    availableAt: new Date(occurredAt),
    payload: Object.freeze({
      id,
      type: input.type,
      occurredAt,
      orgId: input.incident.orgId,
      data: Object.freeze({
        incidentId: input.incident.id,
        title: input.incident.title,
        severity: input.incident.severity,
        riskScore: input.incident.riskScore,
        alertCount: input.incident.alertCount,
        eventCount: input.incident.eventCount,
        primaryEntity: input.incident.primaryEntity,
        status: input.incident.status,
        createdAt: input.incident.createdAt.toISOString(),
        updatedAt: input.incident.updatedAt.toISOString(),
        source: input.incident.source,
      }),
    }),
  });
}

export function assertSameIncidentNotification(
  expected: EnqueueIncidentNotificationInput,
  actual: {
    readonly id: string;
    readonly orgId: string;
    readonly incidentId: string;
    readonly eventType: IncidentNotificationType;
    readonly channel: IncidentNotificationChannel;
    readonly deduplicationKey: string;
    readonly payload: IncidentNotificationPayload;
  },
): void {
  const same =
    expected.id === actual.id &&
    expected.orgId === actual.orgId &&
    expected.incidentId === actual.incidentId &&
    expected.eventType === actual.eventType &&
    expected.channel === actual.channel &&
    expected.deduplicationKey === actual.deduplicationKey &&
    isDeepStrictEqual(expected.payload, actual.payload);
  if (!same) {
    throw new Error(
      `Incident notification deduplication collision for ${expected.deduplicationKey}.`,
    );
  }
}

function channelFor(type: IncidentNotificationType): IncidentNotificationChannel {
  if (type === "INCIDENT_CREATED") return "incidents:new";
  if (type === "INCIDENT_UPDATED") return "incidents:updated";
  return "incidents:status";
}

function deterministicUuid(value: string): string {
  const hash = createHash("sha256");
  append(hash, value);
  const bytes = hash.digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function append(hash: Hash, value: string): void {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  hash.update(length);
  hash.update(bytes);
}

function requireNonBlank(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${fieldName} must not be blank.`);
  return normalized;
}

function validDate(value: Date, fieldName: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${fieldName} must be a valid Date.`);
  }
  return value;
}

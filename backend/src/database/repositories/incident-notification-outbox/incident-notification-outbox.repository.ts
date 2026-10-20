import type { TransactionClient } from "../common/repository.types.js";

export type IncidentNotificationType =
  | "INCIDENT_CREATED"
  | "INCIDENT_UPDATED"
  | "INCIDENT_STATUS_CHANGED";

export type IncidentNotificationChannel =
  | "incidents:new"
  | "incidents:updated"
  | "incidents:status";

export type IncidentNotificationOutboxStatus =
  | "pending"
  | "published"
  | "dead_letter";

export interface IncidentNotificationPayload {
  readonly id: string;
  readonly type: IncidentNotificationType;
  readonly occurredAt: string;
  readonly orgId: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface IncidentNotificationOutboxRecord {
  readonly id: string;
  readonly orgId: string;
  readonly incidentId: string;
  readonly eventType: IncidentNotificationType;
  readonly channel: IncidentNotificationChannel;
  readonly deduplicationKey: string;
  readonly payload: IncidentNotificationPayload;
  readonly status: IncidentNotificationOutboxStatus;
  readonly attemptCount: number;
  readonly availableAt: Date;
  readonly lockedAt: Date | null;
  readonly lockedUntil: Date | null;
  readonly lockOwner: string | null;
  readonly publishedAt: Date | null;
  readonly lastError: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface EnqueueIncidentNotificationInput {
  readonly id: string;
  readonly orgId: string;
  readonly incidentId: string;
  readonly eventType: IncidentNotificationType;
  readonly channel: IncidentNotificationChannel;
  readonly deduplicationKey: string;
  readonly payload: IncidentNotificationPayload;
  readonly availableAt?: Date;
}

export interface EnqueueIncidentNotificationResult {
  readonly record: IncidentNotificationOutboxRecord;
  readonly inserted: boolean;
}

export interface ClaimIncidentNotificationsInput {
  readonly owner: string;
  readonly now: Date;
  readonly lockedUntil: Date;
  readonly limit: number;
}

export interface FailIncidentNotificationInput {
  readonly owner: string;
  readonly now: Date;
  readonly nextAvailableAt: Date;
  readonly error: string;
  readonly deadLetter: boolean;
}

export interface IncidentNotificationOutboxCounts {
  readonly pending: number;
  readonly published: number;
  readonly deadLetter: number;
}

export interface IIncidentNotificationOutboxRepository {
  withTransaction(transaction: TransactionClient): IIncidentNotificationOutboxRepository;
  enqueueIfAbsent(
    input: EnqueueIncidentNotificationInput,
  ): Promise<EnqueueIncidentNotificationResult>;
  findById(id: string): Promise<IncidentNotificationOutboxRecord | null>;
  findByDeduplicationKey(
    deduplicationKey: string,
  ): Promise<IncidentNotificationOutboxRecord | null>;
  findLatestByIncident(
    incidentId: string,
    orgId: string,
  ): Promise<IncidentNotificationOutboxRecord | null>;
  claimBatch(
    input: ClaimIncidentNotificationsInput,
  ): Promise<readonly IncidentNotificationOutboxRecord[]>;
  markPublished(
    id: string,
    owner: string,
    publishedAt: Date,
  ): Promise<IncidentNotificationOutboxRecord | null>;
  markFailed(
    id: string,
    input: FailIncidentNotificationInput,
  ): Promise<IncidentNotificationOutboxRecord | null>;
  countByStatus(): Promise<IncidentNotificationOutboxCounts>;
}

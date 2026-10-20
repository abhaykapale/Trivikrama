import type {
  IIncidentNotificationOutboxRepository,
  IncidentNotificationOutboxRecord,
} from "../../../database/repositories/incident-notification-outbox/index.js";

export interface IncidentNotificationPublishResult {
  readonly published: boolean;
  readonly subscriberCount: number;
}

export interface IncidentNotificationPublisher {
  publish(
    notification: IncidentNotificationOutboxRecord,
  ): Promise<IncidentNotificationPublishResult>;
}

export interface IncidentNotificationDispatcherConfiguration {
  readonly batchSize: number;
  readonly lockDurationMs: number;
  readonly maxAttempts: number;
  readonly baseRetryDelayMs: number;
  readonly maxRetryDelayMs: number;
}

export interface DispatchIncidentNotificationsResult {
  readonly claimed: number;
  readonly published: number;
  readonly deduplicated: number;
  readonly failed: number;
  readonly deadLettered: number;
}

export interface IncidentNotificationDispatcherDependencies {
  readonly outbox: Pick<
    IIncidentNotificationOutboxRepository,
    "claimBatch" | "markPublished" | "markFailed"
  >;
  readonly publisher: IncidentNotificationPublisher;
  readonly owner: string;
  readonly now?: () => Date;
  readonly configuration?: Partial<IncidentNotificationDispatcherConfiguration>;
}

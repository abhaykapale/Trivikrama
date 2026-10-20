import type {
  DispatchIncidentNotificationsResult,
  IncidentNotificationDispatcherConfiguration,
  IncidentNotificationDispatcherDependencies,
} from "../domain/incident-notification.contracts.js";

export const DEFAULT_INCIDENT_NOTIFICATION_DISPATCHER_CONFIGURATION:
  IncidentNotificationDispatcherConfiguration = Object.freeze({
    batchSize: 50,
    lockDurationMs: 30_000,
    maxAttempts: 8,
    baseRetryDelayMs: 1_000,
    maxRetryDelayMs: 5 * 60_000,
  });

export class IncidentNotificationDispatcher {
  private readonly configuration: IncidentNotificationDispatcherConfiguration;
  private readonly now: () => Date;

  public constructor(
    private readonly dependencies: IncidentNotificationDispatcherDependencies,
  ) {
    this.configuration = Object.freeze({
      ...DEFAULT_INCIDENT_NOTIFICATION_DISPATCHER_CONFIGURATION,
      ...dependencies.configuration,
    });
    this.now = dependencies.now ?? (() => new Date());
    validateConfiguration(this.configuration);
    if (dependencies.owner.trim().length === 0) {
      throw new Error("Incident notification dispatcher owner must not be blank.");
    }
  }

  public async dispatchBatch(): Promise<DispatchIncidentNotificationsResult> {
    const claimedAt = validDate(this.now(), "now");
    const claimed = await this.dependencies.outbox.claimBatch({
      owner: this.dependencies.owner,
      now: claimedAt,
      lockedUntil: new Date(claimedAt.getTime() + this.configuration.lockDurationMs),
      limit: this.configuration.batchSize,
    });
    const result = {
      claimed: claimed.length,
      published: 0,
      deduplicated: 0,
      failed: 0,
      deadLettered: 0,
    };

    for (const notification of claimed) {
      try {
        const publication = await this.dependencies.publisher.publish(notification);
        const publishedAt = validDate(this.now(), "now");
        const marked = await this.dependencies.outbox.markPublished(
          notification.id,
          this.dependencies.owner,
          publishedAt,
        );
        if (marked === null) {
          throw new Error(`Lost outbox lock while acknowledging ${notification.id}.`);
        }
        if (publication.published) result.published += 1;
        else result.deduplicated += 1;
      } catch (error) {
        const failedAt = validDate(this.now(), "now");
        const nextAttempt = notification.attemptCount + 1;
        const deadLetter = nextAttempt >= this.configuration.maxAttempts;
        const marked = await this.dependencies.outbox.markFailed(notification.id, {
          owner: this.dependencies.owner,
          now: failedAt,
          nextAvailableAt: new Date(
            failedAt.getTime() + retryDelay(nextAttempt, this.configuration),
          ),
          error: safeError(error),
          deadLetter,
        });
        if (marked === null) {
          throw new Error(`Lost outbox lock while failing ${notification.id}.`);
        }
        result.failed += 1;
        if (deadLetter) result.deadLettered += 1;
      }
    }
    return Object.freeze(result);
  }
}

function retryDelay(
  attempt: number,
  configuration: IncidentNotificationDispatcherConfiguration,
): number {
  const exponential = configuration.baseRetryDelayMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(exponential, configuration.maxRetryDelayMs);
}

function safeError(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  const message = error instanceof Error ? error.message : "Notification publication failed";
  return `${name}: ${message}`.replace(/[\r\n\t]+/gu, " ").slice(0, 1000);
}

function validateConfiguration(
  configuration: IncidentNotificationDispatcherConfiguration,
): void {
  integerBetween(configuration.batchSize, 1, 500, "batchSize");
  integerBetween(configuration.lockDurationMs, 1_000, 10 * 60_000, "lockDurationMs");
  integerBetween(configuration.maxAttempts, 1, 100, "maxAttempts");
  integerBetween(configuration.baseRetryDelayMs, 1, 60 * 60_000, "baseRetryDelayMs");
  integerBetween(configuration.maxRetryDelayMs, 1, 24 * 60 * 60_000, "maxRetryDelayMs");
  if (configuration.baseRetryDelayMs > configuration.maxRetryDelayMs) {
    throw new Error("baseRetryDelayMs cannot exceed maxRetryDelayMs.");
  }
}

function integerBetween(value: number, min: number, max: number, name: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
}

function validDate(value: Date, fieldName: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${fieldName} must be a valid Date.`);
  }
  return value;
}

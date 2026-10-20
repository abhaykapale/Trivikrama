import type {
  IncidentNotificationOutboxRecord,
} from "../../../database/repositories/incident-notification-outbox/index.js";
import type {
  IncidentNotificationPublisher,
  IncidentNotificationPublishResult,
} from "../domain/incident-notification.contracts.js";

export interface RedisScriptExecutor {
  eval(
    script: string,
    numberOfKeys: number,
    ...args: readonly (string | number)[]
  ): Promise<unknown>;
}

export interface RedisIncidentNotificationPublisherOptions {
  readonly deduplicationTtlSeconds?: number;
  readonly deduplicationKeyPrefix?: string;
}

const DEFAULT_DEDUPLICATION_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_KEY_PREFIX = "incident-notification:published:v1";
const PUBLISH_ONCE_SCRIPT = `
local inserted = redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', ARGV[2])
if not inserted then
  return {-1, 0}
end
local subscribers = redis.call('PUBLISH', ARGV[3], ARGV[4])
return {1, subscribers}
`;

export class RedisIncidentNotificationPublisher
  implements IncidentNotificationPublisher
{
  private readonly ttlSeconds: number;
  private readonly keyPrefix: string;

  public constructor(
    private readonly redis: RedisScriptExecutor,
    options: RedisIncidentNotificationPublisherOptions = {},
  ) {
    this.ttlSeconds =
      options.deduplicationTtlSeconds ?? DEFAULT_DEDUPLICATION_TTL_SECONDS;
    this.keyPrefix = options.deduplicationKeyPrefix ?? DEFAULT_KEY_PREFIX;
    if (!Number.isInteger(this.ttlSeconds) || this.ttlSeconds < 60) {
      throw new Error("Incident notification deduplication TTL must be at least 60 seconds.");
    }
    if (this.keyPrefix.trim().length === 0) {
      throw new Error("Incident notification deduplication key prefix must not be blank.");
    }
  }

  public async publish(
    notification: IncidentNotificationOutboxRecord,
  ): Promise<IncidentNotificationPublishResult> {
    const raw = await this.redis.eval(
      PUBLISH_ONCE_SCRIPT,
      1,
      `${this.keyPrefix}:${notification.id}`,
      notification.id,
      this.ttlSeconds,
      notification.channel,
      JSON.stringify(notification.payload),
    );
    if (!Array.isArray(raw) || raw.length !== 2) {
      throw new Error("Redis returned an invalid incident notification publish result.");
    }
    const publishedFlag = Number(raw[0]);
    const subscriberCount = Number(raw[1]);
    if (!Number.isInteger(subscriberCount) || subscriberCount < 0) {
      throw new Error("Redis returned an invalid incident subscriber count.");
    }
    if (publishedFlag === -1) {
      return Object.freeze({ published: false, subscriberCount: 0 });
    }
    if (publishedFlag !== 1) {
      throw new Error("Redis returned an invalid incident notification publish flag.");
    }
    return Object.freeze({ published: true, subscriberCount });
  }
}

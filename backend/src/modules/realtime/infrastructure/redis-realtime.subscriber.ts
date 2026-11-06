import type { RedisClient } from "../../../database/redis/client.js";
import { REALTIME_CHANNELS, type RealtimeChannel, type RealtimeNotification } from "../domain/realtime.contracts.js";
import type { TenantConnectionHub } from "../application/tenant-connection-hub.js";

const MAX_NOTIFICATION_BYTES = 65_536;
const TYPES = new Set(["INCIDENT_CREATED", "INCIDENT_UPDATED", "INCIDENT_STATUS_CHANGED"]);

export class RedisRealtimeSubscriber {
  private readonly subscriber: RedisClient;
  private started = false;
  private readonly onMessage = (_channel: string, payload: string): void => {
    const notification = parseNotification(payload);
    if (notification !== null) this.hub.broadcast(notification);
  };

  public constructor(redis: RedisClient, private readonly hub: TenantConnectionHub) {
    this.subscriber = redis.duplicate();
    this.subscriber.on("error", () => undefined);
  }

  public async start(): Promise<void> {
    if (this.started) return;
    if (this.subscriber.status === "wait") await this.subscriber.connect();
    this.subscriber.on("message", this.onMessage);
    await this.subscriber.subscribe(...REALTIME_CHANNELS);
    this.started = true;
  }

  public async close(): Promise<void> {
    this.subscriber.off("message", this.onMessage);
    if (this.started && this.subscriber.status === "ready") await this.subscriber.unsubscribe(...REALTIME_CHANNELS).catch(() => undefined);
    this.started = false;
    if (this.subscriber.status === "ready") await this.subscriber.quit().catch(() => this.subscriber.disconnect());
    else if (this.subscriber.status !== "end") this.subscriber.disconnect();
  }
}

export function parseNotification(payload: string): RealtimeNotification | null {
  if (Buffer.byteLength(payload, "utf8") > MAX_NOTIFICATION_BYTES) return null;
  try {
    const value: unknown = JSON.parse(payload);
    if (!isObject(value) || typeof value.id !== "string" || value.id.length > 128 ||
        typeof value.type !== "string" || !TYPES.has(value.type) ||
        typeof value.occurredAt !== "string" || !Number.isFinite(Date.parse(value.occurredAt)) ||
        typeof value.orgId !== "string" || value.orgId.length === 0 || value.orgId.length > 255 ||
        !isObject(value.data)) return null;
    return value as unknown as RealtimeNotification;
  } catch { return null; }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRealtimeChannel(value: string): value is RealtimeChannel {
  return (REALTIME_CHANNELS as readonly string[]).includes(value);
}

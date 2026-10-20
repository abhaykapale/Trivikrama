import "dotenv/config";

import {
  closePostgres,
  createPostgresClient,
} from "../database/postgres/client.js";
import {
  closeRedis,
  connectRedis,
  createRedisClient,
} from "../database/redis/client.js";
import { createPostgresRepositories } from "../database/repositories/postgres-repository.factory.js";

async function main(): Promise<void> {
  const incidentId = requireValue(
    process.argv[2] ?? process.env.INCIDENT_NOTIFICATION_PROOF_INCIDENT_ID,
    "incident ID",
  );
  const databaseUrl = requireValue(process.env.DATABASE_URL, "DATABASE_URL");
  const redisUrl = requireValue(process.env.REDIS_URL, "REDIS_URL");
  const redisKeyPrefix = requireValue(
    process.env.REDIS_KEY_PREFIX ?? "trivikrama",
    "REDIS_KEY_PREFIX",
  );
  const postgres = createPostgresClient({
    connectionString: databaseUrl,
    poolMin: 0,
    poolMax: 2,
    applicationName: "trivikrama-incident-notification-proof",
  });
  const redis = createRedisClient({ url: redisUrl, keyPrefix: redisKeyPrefix });

  try {
    await connectRedis(redis);
    const repositories = createPostgresRepositories(postgres);
    const incident = await repositories.incidents.findById(incidentId);
    if (incident === null) throw new Error(`Incident ${incidentId} does not exist.`);
    const notification = await repositories.incidentNotificationOutbox.findLatestByIncident(
      incident.id,
      incident.orgId,
    );
    if (notification === null) {
      throw new Error(`Incident ${incidentId} has no notification outbox record.`);
    }
    const redisMarker = await redis.get(
      `incident-notification:published:v1:${notification.id}`,
    );
    const passed =
      notification.status === "published" &&
      notification.publishedAt !== null &&
      redisMarker === notification.id &&
      notification.payload.data.incidentId === incident.id &&
      notification.payload.orgId === incident.orgId;

    console.log(JSON.stringify({
      passed,
      incident: {
        id: incident.id,
        orgId: incident.orgId,
        status: incident.status,
      },
      notification: {
        id: notification.id,
        type: notification.eventType,
        channel: notification.channel,
        status: notification.status,
        attemptCount: notification.attemptCount,
        publishedAt: notification.publishedAt?.toISOString() ?? null,
        redisDeduplicationMarkerPresent: redisMarker === notification.id,
      },
    }, null, 2));
    if (!passed) process.exitCode = 1;
  } finally {
    await Promise.allSettled([closePostgres(postgres), closeRedis(redis)]);
  }
}

function requireValue(value: string | undefined, name: string): string {
  const normalized = value?.trim() ?? "";
  if (normalized.length === 0) throw new Error(`${name} is required.`);
  return normalized;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

import "dotenv/config";

import {
  closeMongoDb,
  connectMongoDb,
  createMongoDbClient,
} from "../database/mongodb/client.js";
import {
  closePostgres,
  createPostgresClient,
} from "../database/postgres/client.js";
import { createMongoRepositories } from "../database/repositories/mongodb/mongo-repository.factory.js";
import { createPostgresRepositories } from "../database/repositories/postgres-repository.factory.js";

async function main(): Promise<void> {
  const eventId = requireValue(process.argv[2] ?? process.env.INCIDENT_PROOF_EVENT_ID, "event ID");
  const databaseUrl = requireValue(process.env.DATABASE_URL, "DATABASE_URL");
  const mongoUri = requireValue(process.env.MONGODB_URI, "MONGODB_URI");
  const postgres = createPostgresClient({
    connectionString: databaseUrl,
    poolMin: 0,
    poolMax: 2,
    applicationName: "trivikrama-incident-proof",
  });
  const mongo = createMongoDbClient();

  try {
    await connectMongoDb(mongo, { uri: mongoUri, minPoolSize: 0, maxPoolSize: 2 });
    const postgresRepositories = createPostgresRepositories(postgres);
    const mongoRepositories = createMongoRepositories(mongo);
    const [normalizedEvent, aiResult, links] = await Promise.all([
      mongoRepositories.normalizedEvents.findByEventId(eventId),
      mongoRepositories.aiResults.findLatestByEventId(eventId),
      postgresRepositories.incidentEvents.list({ eventId, limit: 2 }),
    ]);

    if (links.items.length !== 1) {
      throw new Error(
        `Expected exactly one incident link for ${eventId}; found ${links.items.length}.`,
      );
    }
    const link = links.items[0]!;
    const [incident, alerts] = await Promise.all([
      postgresRepositories.incidents.findById(link.incidentId),
      postgresRepositories.alerts.listByIncident(link.incidentId, { limit: 100 }),
    ]);
    if (incident === null) throw new Error(`Incident ${link.incidentId} does not exist.`);

    const proof = {
      passed:
        normalizedEvent !== null &&
        incident.alertCount === alerts.items.length &&
        incident.eventCount >= 1 &&
        alerts.items.some((alert) => alert.matchedEventIds.includes(eventId)),
      eventId,
      normalizedEvent: normalizedEvent === null
        ? null
        : {
            eventId: normalizedEvent.event_id,
            classUid: normalizedEvent.class_uid,
            severityId: normalizedEvent.severity_id,
          },
      aiResult: aiResult === null
        ? null
        : {
            anomalyScore: aiResult.anomaly_score,
            isAnomaly: aiResult.is_anomaly,
            modelVersion: aiResult.model_version,
          },
      incident: {
        id: incident.id,
        status: incident.status,
        severity: incident.severity,
        riskScore: incident.riskScore,
        source: incident.source,
        alertCount: incident.alertCount,
        eventCount: incident.eventCount,
        primaryEntity: incident.primaryEntity,
      },
      alerts: alerts.items.map((alert) => ({
        id: alert.id,
        type: alert.alertType,
        eventMatched: alert.matchedEventIds.includes(eventId),
      })),
      incidentEventLink: {
        incidentId: link.incidentId,
        eventId: link.eventId,
        eventTime: link.eventTime.toISOString(),
      },
    };
    console.log(JSON.stringify(proof, null, 2));
    if (!proof.passed) process.exitCode = 1;
  } finally {
    await Promise.allSettled([closeMongoDb(mongo), closePostgres(postgres)]);
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

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  closeMongoDb,
  connectMongoDb,
  createMongoDbClient,
} from "../../../src/database/mongodb/client.js";
import type { AiResultDocument } from "../../../src/database/repositories/mongodb/ai-result.repository.js";
import { MongoAiResultRepository } from "../../../src/database/repositories/mongodb/mongo-ai-result.repository.js";
import { MongoNormalizedEventRepository } from "../../../src/database/repositories/mongodb/mongo-normalized-event.repository.js";
import type { NormalizedEventDocument } from "../../../src/database/repositories/mongodb/normalized-event.repository.js";
import { MongoEventInvestigationRepository } from "../../../src/modules/events/infrastructure/mongo-event-investigation.repository.js";

test("LOG-01A performs real tenant-safe Mongo search and AI detail lookup", async (context) => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("LOG-01A integration tests refuse to run in production.");
  }

  const client = createMongoDbClient();
  await connectMongoDb(client, {
    uri:
      process.env.TEST_MONGODB_URI ??
      process.env.MONGODB_URI ??
      "mongodb://localhost:27017/trivikrama",
    maxPoolSize: 2,
    serverSelectionTimeoutMs: 5_000,
  });

  const suffix = randomUUID();
  const orgId = `log-01a-org-${suffix}`;
  const otherOrgId = `log-01a-other-${suffix}`;
  const eventId = `log-01a-event-${suffix}`;
  const otherEventId = `log-01a-other-event-${suffix}`;
  const now = new Date();
  const events = client.db!.collection<NormalizedEventDocument>("normalized_events");
  const aiResults = client.db!.collection<AiResultDocument>("ai_results");

  await new MongoNormalizedEventRepository(client).createManyIfAbsent([
    eventDocument(eventId, orgId, now),
    eventDocument(otherEventId, otherOrgId, now),
  ]);
  await new MongoAiResultRepository(client).create(aiDocument(eventId, orgId, now));

  context.after(async () => {
    try {
      await Promise.all([
        events.deleteMany({ org_id: { $in: [orgId, otherOrgId] } }),
        aiResults.deleteMany({ org_id: orgId }),
      ]);
    } finally {
      await closeMongoDb(client);
    }
  });

  const repository = new MongoEventInvestigationRepository(client);
  const page = await repository.search({
    orgId,
    severityId: 4,
    from: new Date(now.getTime() - 60_000),
    to: new Date(now.getTime() + 60_000),
    offset: 0,
    limit: 50,
    sort: "time",
    order: "desc",
  });

  assert.equal(page.total, 1);
  assert.deepEqual(page.items.map((item) => item.eventId), [eventId]);

  const detail = await repository.findById({ orgId, eventId });
  assert.equal(detail?.eventId, eventId);
  assert.equal(detail?.aiAnalysis?.anomalyScore, 0.91);
  assert.equal(detail?.aiAnalysis?.shapExplanation?.features.length, 1);
  assert.equal(
    await repository.findById({ orgId: otherOrgId, eventId }),
    null,
  );
});

function eventDocument(
  eventId: string,
  orgId: string,
  time: Date,
): NormalizedEventDocument {
  return {
    event_id: eventId,
    class_uid: 3002,
    category_uid: 3,
    severity_id: 4,
    time,
    message: "LOG-01A failed password investigation fixture",
    src_endpoint: { ip: "192.0.2.10" },
    actor: { user: { name: "root" } },
    device: { hostname: "web-01" },
    metadata: { version: "1.1.0" },
    ingestion: {
      batch_id: `batch-${eventId}`,
      collector_id: "collector-log-01a",
      ingested_at: time,
    },
    raw_event: { fixture: "must-not-be-returned" },
    org_id: orgId,
  };
}

function aiDocument(
  eventId: string,
  orgId: string,
  createdAt: Date,
): AiResultDocument {
  return {
    event_id: eventId,
    model_name: "isolation_forest",
    model_version: "log-01a-test",
    anomaly_score: 0.91,
    is_anomaly: true,
    used_fallback: false,
    created_at: createdAt,
    org_id: orgId,
    shap_explanation: {
      features: [{ name: "failed_login_count_10min", value: 12, shap_value: 0.3 }],
    },
  };
}

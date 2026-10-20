import assert from "node:assert/strict";
import test from "node:test";

import type { CreateAiResultInput } from "../../../src/database/repositories/mongodb/ai-result.repository.js";
import type { CreateNormalizedEventInput } from "../../../src/database/repositories/mongodb/normalized-event.repository.js";
import {
  DEVELOPMENT_DEMO_EVENT_IDS,
  buildDevelopmentAiResults,
  buildDevelopmentNormalizedEvents,
  readDevelopmentMongoSeedStatus,
  seedDevelopmentMongoData,
  type DevelopmentMongoSeedRepositories,
} from "../../../src/database/seeds/development-demo-mongodb.seed.js";

test("development Mongo fixtures match PostgreSQL incident event identities", () => {
  const orgId = "default";
  const normalizedEvents = buildDevelopmentNormalizedEvents(orgId);
  const aiResults = buildDevelopmentAiResults(orgId);

  assert.deepEqual(
    normalizedEvents.map((event) => event.event_id),
    DEVELOPMENT_DEMO_EVENT_IDS,
  );
  assert.deepEqual(
    aiResults.map((result) => result.event_id),
    [
      "mongo-demo-normalized-event-ssh-003",
      "mongo-demo-normalized-event-login-001",
    ],
  );

  const normalizedIds = new Set(
    normalizedEvents.map((event) => event.event_id),
  );
  assert.ok(
    aiResults.every((result) => normalizedIds.has(result.event_id)),
    "Every seeded AI result must reference a seeded normalized event",
  );
  assert.ok(
    normalizedEvents.every(
      (event) =>
        event.org_id === orgId &&
        event.dedup_hash?.startsWith("sha256:") === true &&
        event.dedup_hash.length === 71,
    ),
  );
});

test("development Mongo seeding is idempotent and reports complete status", async () => {
  const repositories = createInMemoryRepositories();

  const first = await seedDevelopmentMongoData(repositories, "default");
  assert.equal(first.insertedNormalizedEvents, 4);
  assert.equal(first.existingNormalizedEvents, 0);
  assert.equal(first.insertedAiResults, 2);
  assert.equal(first.existingAiResults, 0);
  assert.equal(first.complete, true);

  const replay = await seedDevelopmentMongoData(repositories, "default");
  assert.equal(replay.insertedNormalizedEvents, 0);
  assert.equal(replay.existingNormalizedEvents, 4);
  assert.equal(replay.insertedAiResults, 0);
  assert.equal(replay.existingAiResults, 2);
  assert.equal(replay.complete, true);

  const status = await readDevelopmentMongoSeedStatus(
    repositories,
    "default",
  );
  assert.deepEqual(status, {
    expectedNormalizedEvents: 4,
    presentNormalizedEvents: 4,
    expectedAiResults: 2,
    presentAiResults: 2,
    complete: true,
  });
});

test("development Mongo seed status detects an incomplete cross-store dataset", async () => {
  const repositories = createInMemoryRepositories();
  const status = await readDevelopmentMongoSeedStatus(
    repositories,
    "default",
  );

  assert.equal(status.presentNormalizedEvents, 0);
  assert.equal(status.presentAiResults, 0);
  assert.equal(status.complete, false);
});

test("development Mongo seeding rejects an empty organization identity", async () => {
  const repositories = createInMemoryRepositories();

  await assert.rejects(
    seedDevelopmentMongoData(repositories, "   "),
    /orgId is required/u,
  );
});

function createInMemoryRepositories(): DevelopmentMongoSeedRepositories {
  const events = new Map<string, CreateNormalizedEventInput>();
  const aiResults = new Map<string, CreateAiResultInput>();

  return {
    normalizedEvents: {
      async createManyIfAbsent(inputs) {
        let insertedCount = 0;
        const documents: CreateNormalizedEventInput[] = [];

        for (const input of inputs) {
          const existing = events.get(input.event_id);
          if (existing === undefined) {
            events.set(input.event_id, input);
            insertedCount += 1;
            documents.push(input);
          } else {
            documents.push(existing);
          }
        }

        return {
          insertedCount,
          existingCount: inputs.length - insertedCount,
          documents,
        };
      },
      async listByEventIds(eventIds) {
        return eventIds.flatMap((eventId) => {
          const event = events.get(eventId);
          return event === undefined ? [] : [event];
        });
      },
    },
    aiResults: {
      async createManyIfAbsent(inputs) {
        let insertedCount = 0;

        for (const input of inputs) {
          const identity = aiIdentity(input);
          if (!aiResults.has(identity)) {
            aiResults.set(identity, input);
            insertedCount += 1;
          }
        }

        return {
          insertedCount,
          existingCount: inputs.length - insertedCount,
        };
      },
      async list(filters = {}) {
        const items = [...aiResults.values()].filter((result) =>
          (filters.orgId === undefined || result.org_id === filters.orgId) &&
          (filters.batchId === undefined || result.batch_id === filters.batchId) &&
          (filters.modelName === undefined || result.model_name === filters.modelName) &&
          (filters.modelVersion === undefined ||
            result.model_version === filters.modelVersion),
        );
        const limit = filters.limit ?? 100;
        const offset = filters.offset ?? 0;

        return {
          items: items.slice(offset, offset + limit),
          limit,
          offset,
          hasMore: items.length > offset + limit,
        };
      },
    },
  };
}

function aiIdentity(result: CreateAiResultInput): string {
  return `${result.event_id}\u0000${result.model_name}\u0000${result.model_version}`;
}

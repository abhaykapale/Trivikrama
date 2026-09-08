import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
    closeMongoDb,
    connectMongoDb,
    createMongoDbClient,
} from "../../../src/database/mongodb/client.js";
import { MongoNormalizedEventRepository } from "../../../src/database/repositories/mongodb/mongo-normalized-event.repository.js";
import type { CreateNormalizedEventInput } from "../../../src/database/repositories/mongodb/normalized-event.repository.js";

test("MongoDB persists a normalized event idempotently by stable event_id", async (context) => {
    if (process.env.NODE_ENV === "production") {
        throw new Error("BE-ING-01E integration tests refuse to run in production.");
    }

    const client = createMongoDbClient();
    const event = createEvent();

    await connectMongoDb(client, {
        uri: process.env.TEST_MONGODB_URI ?? process.env.MONGODB_URI ?? "mongodb://localhost:27017/trivikrama",
        maxPoolSize: 2,
        serverSelectionTimeoutMs: 5_000,
    });

    context.after(async () => {
        try {
            await client.db?.collection("normalized_events").deleteOne({
                event_id: event.event_id,
            });
        } finally {
            await closeMongoDb(client);
        }
    });

    const repository = new MongoNormalizedEventRepository(client);
    const first = await repository.createManyIfAbsent([event]);
    const replay = await repository.createManyIfAbsent([event]);

    assert.equal(first.insertedCount, 1);
    assert.equal(first.existingCount, 0);
    assert.equal(replay.insertedCount, 0);
    assert.equal(replay.existingCount, 1);
    assert.equal(replay.documents[0]?.event_id, event.event_id);
});

function createEvent(): CreateNormalizedEventInput {
    const suffix = randomUUID().replaceAll("-", "");
    const eventId = `be-ing-01e-${suffix}`;

    return {
        event_id: eventId,
        dedup_hash: `sha256:${suffix.padEnd(64, "0")}`,
        class_uid: 3002,
        category_uid: 3,
        severity_id: 3,
        time: new Date("2026-09-08T00:00:00.000Z"),
        message: "BE-ING-01E idempotent persistence test",
        metadata: { version: "1.1.0" },
        schema_valid: true,
        validation_errors: [],
        ingestion: {
            batch_id: randomUUID(),
            collector_id: "collector-dev-01",
            ingested_at: new Date(),
        },
        raw_event: {
            event_id: eventId,
            fixture: "be-ing-01e",
        },
        org_id: "be-ing-01e-integration",
    };
}


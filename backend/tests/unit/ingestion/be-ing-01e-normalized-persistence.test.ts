import assert from "node:assert/strict";
import test from "node:test";

import type {
    CreateNormalizedEventInput,
    CreateNormalizedEventsIfAbsentResult,
} from "../../../src/database/repositories/mongodb/normalized-event.repository.js";
import { PersistNormalizedCollectorEventsService } from "../../../src/modules/ingestion/application/persist-normalized-collector-events.service.js";

test("reports inserted and replayed normalized events", async () => {
    const candidate = createEvent();
    const repository = new FakeRepository({
        insertedCount: 0,
        existingCount: 1,
        documents: [candidate],
    });

    const result = await new PersistNormalizedCollectorEventsService({
        normalizedEvents: repository,
    }).execute([candidate]);

    assert.deepEqual(result, {
        status: "persisted",
        insertedCount: 0,
        alreadyPresentCount: 1,
    });
    assert.deepEqual(repository.inputs, [[candidate]]);
});

test("rejects reuse of an event ID for different normalized content", async () => {
    const candidate = createEvent();
    const repository = new FakeRepository({
        insertedCount: 0,
        existingCount: 1,
        documents: [
            {
                ...candidate,
                dedup_hash:
                    "sha256:abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
            },
        ],
    });

    const result = await new PersistNormalizedCollectorEventsService({
        normalizedEvents: repository,
    }).execute([candidate]);

    assert.deepEqual(result, {
        status: "event_id_collision",
        eventId: candidate.event_id,
    });
});

class FakeRepository {
    public readonly inputs: Array<readonly CreateNormalizedEventInput[]> = [];

    public constructor(private readonly result: CreateNormalizedEventsIfAbsentResult) {}

    public async createManyIfAbsent(
        inputs: readonly CreateNormalizedEventInput[],
    ): Promise<CreateNormalizedEventsIfAbsentResult> {
        this.inputs.push(inputs);
        return this.result;
    }
}

function createEvent(): CreateNormalizedEventInput {
    return {
        event_id:
            "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        dedup_hash:
            "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        class_uid: 3002,
        category_uid: 3,
        severity_id: 3,
        time: new Date("2026-09-07T12:00:00.000Z"),
        message: "Failed login for alice",
        metadata: { version: "1.1.0" },
        schema_valid: true,
        validation_errors: [],
        ingestion: {
            batch_id: "77d8092b-6bd8-4acd-ab16-bd56707a1377",
            collector_id: "collector-dev-01",
            ingested_at: new Date("2026-09-08T00:00:00.000Z"),
        },
        raw_event: {
            event_id:
                "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            raw_payload: "{\"event_type\":\"login_failed\"}",
        },
    };
}

import assert from "node:assert/strict";
import test from "node:test";

import type { CreateNormalizedEventInput } from "../../../src/database/repositories/mongodb/normalized-event.repository.js";
import {
    DeterministicFeatureExtractor,
    RedisBackedFeatureExtractor,
    RedisTemporalFrequencyFeatureStore,
    type IFeatureHistoryStore,
    type RecordFeatureHistoryInput,
    type TemporalFrequencyFeatureSnapshot,
} from "../../../src/modules/feature-extraction/index.js";

test("applies Redis history in event-time order and preserves input order", async () => {
    const history = new RecordingHistoryStore();
    const extractor = createExtractor(history);
    const later = normalizedEvent("event-later", "2026-09-18T10:00:30.000Z");
    const earlier = normalizedEvent("event-earlier", "2026-09-18T10:00:00.000Z");

    const result = await extractor.extract([later, earlier]);

    assert.deepEqual(history.inputs.map((input) => input.eventId), [
        "event-earlier",
        "event-later",
    ]);
    assert.deepEqual(result.events.map((event) => event.event_id), [
        "event-later",
        "event-earlier",
    ]);
    assert.equal(result.events[0]?.features.time_since_last_event, 30);
    assert.equal(result.events[0]?.features.events_per_minute_src_ip, 2);
    assert.equal(result.events[0]?.features.events_per_hour_user, 3);
    assert.equal(result.events[0]?.features.unique_dst_ips_per_src, 4);
    assert.equal(result.events[0]?.features.unique_users_per_src_ip, 5);
    assert.equal(result.events[0]?.features.frequency_deviation, 1.25);
    assert.equal(result.historyAppliedEvents, 2);
    assert.equal(result.historyFallbackEvents, 0);
});

test("keeps neutral values when the Redis feature cache fails", async () => {
    const extractor = createExtractor({
        async record() {
            throw new Error("Redis unavailable");
        },
    });

    const result = await extractor.extract([
        normalizedEvent("event-1", "2026-09-18T10:00:00.000Z"),
    ]);

    assert.equal(result.events[0]?.features.events_per_minute_src_ip, 0);
    assert.equal(result.events[0]?.features.unique_dst_ips_per_src, 1);
    assert.equal(result.historyAppliedEvents, 0);
    assert.equal(result.historyFallbackEvents, 1);
});

test("reports exact replay snapshots without counting again", async () => {
    const history: IFeatureHistoryStore = {
        async record() {
            return snapshot({ replay: true });
        },
    };

    const result = await createExtractor(history).extract([
        normalizedEvent("event-replay", "2026-09-18T10:00:00.000Z"),
    ]);

    assert.equal(result.historyReplayHits, 1);
    assert.equal(result.events[0]?.features.time_since_last_event, 30);
});

test("hashes tenant and event identities before building Redis keys", async () => {
    const redis = new FakeRedisEval();
    const store = new RedisTemporalFrequencyFeatureStore(redis, {
        keyPrefix: "features:test",
    });

    await store.record({
        organizationId: "secret-organization",
        eventId: "sensitive-event-id",
        occurredAtEpochMs: Date.parse("2026-09-18T10:00:00.000Z"),
        sourceIp: "192.0.2.10",
        username: "alice",
        destinationIp: "198.51.100.20",
    });

    const joined = redis.calls[0]?.join("|") ?? "";
    assert.equal(joined.includes("secret-organization"), false);
    assert.equal(joined.includes("sensitive-event-id"), false);
    assert.equal(joined.includes("192.0.2.10"), false);
    assert.equal(redis.numberOfKeys[0], 6);
});

test("rejects malformed Redis snapshots and invalid TTLs", async () => {
    const malformed = new FakeRedisEval([0, "[null,0,\"bad\",0,1,1,0]"]);
    const store = new RedisTemporalFrequencyFeatureStore(malformed);

    await assert.rejects(
        store.record({
            organizationId: "org-1",
            eventId: "event-1",
            occurredAtEpochMs: 1,
        }),
        /non-finite/,
    );
    assert.throws(
        () =>
            new RedisTemporalFrequencyFeatureStore(new FakeRedisEval(), {
                snapshotTtlMs: 100,
            }),
        /1 to 30 days/,
    );
});

class RecordingHistoryStore implements IFeatureHistoryStore {
    public readonly inputs: RecordFeatureHistoryInput[] = [];

    public async record(
        input: RecordFeatureHistoryInput,
    ): Promise<TemporalFrequencyFeatureSnapshot> {
        this.inputs.push(input);
        return snapshot();
    }
}

class FakeRedisEval {
    public readonly calls: Array<readonly (string | number)[]> = [];
    public readonly numberOfKeys: number[] = [];

    public constructor(
        private readonly response: unknown = [
            0,
            "[null,0,1,1,1,1,0]",
        ],
    ) {}

    public async eval(
        _script: string,
        numberOfKeys: number,
        ...arguments_: readonly (string | number)[]
    ): Promise<unknown> {
        this.numberOfKeys.push(numberOfKeys);
        this.calls.push(arguments_);
        return this.response;
    }
}

function createExtractor(history: IFeatureHistoryStore) {
    return new RedisBackedFeatureExtractor({
        deterministic: new DeterministicFeatureExtractor(),
        history,
    });
}

function snapshot(
    overrides: Partial<TemporalFrequencyFeatureSnapshot> = {},
): TemporalFrequencyFeatureSnapshot {
    return {
        replay: false,
        timeSinceLastEventSeconds: 30,
        timeDeviationScore: 0.5,
        eventsPerMinuteSourceIp: 2,
        eventsPerHourUser: 3,
        uniqueDestinationIpsPerSource: 4,
        uniqueUsersPerSourceIp: 5,
        frequencyDeviation: 1.25,
        ...overrides,
    };
}

function normalizedEvent(
    eventId: string,
    timestamp: string,
): CreateNormalizedEventInput {
    return {
        event_id: eventId,
        class_uid: 1001,
        category_uid: 1,
        severity_id: 3,
        time: new Date(timestamp),
        message: "Authentication event",
        src_endpoint: { ip: "192.0.2.10" },
        dst_endpoint: { ip: "198.51.100.20" },
        actor: { user: { name: "alice" } },
        metadata: { version: "1.1.0" },
        ingestion: {
            batch_id: "batch-be-feat-01b",
            collector_id: "collector-dev-01",
            ingested_at: new Date(timestamp),
        },
        org_id: "org-001",
    };
}

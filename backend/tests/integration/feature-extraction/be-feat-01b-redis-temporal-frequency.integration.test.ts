import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Redis } from "ioredis";

import {
    RedisTemporalFrequencyFeatureStore,
} from "../../../src/modules/feature-extraction/index.js";

test("maintains isolated, replay-safe event-time feature windows", async () => {
    if (process.env.NODE_ENV === "production") {
        throw new Error("BE-FEAT-01B integration tests refuse to run in production.");
    }

    const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
        lazyConnect: true,
        connectTimeout: 1_000,
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        retryStrategy: () => null,
    });
    redis.on("error", () => undefined);
    const prefix = `features:be-feat-01b:${randomUUID()}`;
    const store = new RedisTemporalFrequencyFeatureStore(redis, {
        keyPrefix: prefix,
    });
    const baseTime = Date.parse("2026-09-18T10:00:00.000Z");

    try {
        await redis.connect();
        await redis.ping();
        const first = await store.record(input("org-a", "event-1", baseTime, "alice", "198.51.100.1"));
        const second = await store.record(input("org-a", "event-2", baseTime + 30_000, "bob", "198.51.100.2"));
        const replay = await store.record(input("org-a", "event-2", baseTime + 30_000, "bob", "198.51.100.2"));
        const late = await store.record(input("org-a", "event-late", baseTime + 15_000, "alice", "198.51.100.3"));
        const isolated = await store.record(input("org-b", "event-3", baseTime + 30_000, "bob", "198.51.100.2"));

        assert.equal(first.timeSinceLastEventSeconds, null);
        assert.equal(first.eventsPerMinuteSourceIp, 1);
        assert.equal(second.timeSinceLastEventSeconds, 30);
        assert.equal(second.eventsPerMinuteSourceIp, 2);
        assert.equal(second.uniqueDestinationIpsPerSource, 2);
        assert.equal(second.uniqueUsersPerSourceIp, 2);
        assert.equal(replay.replay, true);
        assert.deepEqual(replay, { ...second, replay: true });
        assert.equal(late.timeSinceLastEventSeconds, 15);
        assert.equal(late.uniqueDestinationIpsPerSource, 2);
        assert.equal(late.uniqueUsersPerSourceIp, 1);
        assert.equal(isolated.eventsPerMinuteSourceIp, 1);
        assert.equal(isolated.uniqueDestinationIpsPerSource, 1);
    } finally {
        if (redis.status === "ready") {
            const keys = await redis.keys(`${prefix}:*`);
            if (keys.length > 0) await redis.del(...keys);
        }
        redis.disconnect();
    }
});

function input(
    organizationId: string,
    eventId: string,
    occurredAtEpochMs: number,
    username: string,
    destinationIp: string,
) {
    return {
        organizationId,
        eventId,
        occurredAtEpochMs,
        sourceIp: "192.0.2.10",
        username,
        destinationIp,
    };
}

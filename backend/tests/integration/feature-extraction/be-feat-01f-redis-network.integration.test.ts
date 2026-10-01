import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Redis } from "ioredis";

import { RedisNetworkFeatureStore } from "../../../src/modules/feature-extraction/index.js";

test("maintains replay-safe isolated destination-port baselines", async () => {
    if (process.env.NODE_ENV === "production") {
        throw new Error("BE-FEAT-01F integration tests refuse to run in production.");
    }

    const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
        lazyConnect: true,
        connectTimeout: 1_000,
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        retryStrategy: () => null,
    });
    redis.on("error", () => undefined);
    const prefix = `features:be-feat-01f:${randomUUID()}`;
    const store = new RedisNetworkFeatureStore(redis, { keyPrefix: prefix });
    const baseTime = Date.parse("2026-09-19T10:00:00.000Z");

    try {
        await redis.connect();
        await redis.ping();
        const first = await store.record(input("org-a", "event-1", baseTime, 443));
        const repeated = await store.record(input("org-a", "event-2", baseTime + 1_000, 443));
        const rare = await store.record(input("org-a", "event-3", baseTime + 2_000, 4444));
        const replay = await store.record(input("org-a", "event-3", baseTime + 2_000, 4444));
        const isolated = await store.record(input("org-b", "event-4", baseTime + 2_000, 443));

        assert.deepEqual(first, { replay: false, destinationPortRarity: 1 });
        assert.equal(repeated.destinationPortRarity, 0);
        assert.equal(rare.destinationPortRarity, 1);
        assert.deepEqual(replay, { ...rare, replay: true });
        assert.equal(isolated.destinationPortRarity, 1);
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
    destinationPort: number,
) {
    return {
        organizationId,
        eventId,
        occurredAtEpochMs,
        sourceIdentity: "workstation-01",
        destinationPort,
    } as const;
}

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Redis } from "ioredis";

import { RedisProcessFeatureStore } from "../../../src/modules/feature-extraction/index.js";

test("maintains replay-safe isolated process baselines", async () => {
    if (process.env.NODE_ENV === "production") {
        throw new Error("BE-FEAT-01E integration tests refuse to run in production.");
    }

    const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
        lazyConnect: true,
        connectTimeout: 1_000,
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        retryStrategy: () => null,
    });
    redis.on("error", () => undefined);
    const prefix = `features:be-feat-01e:${randomUUID()}`;
    const store = new RedisProcessFeatureStore(redis, { keyPrefix: prefix });
    const baseTime = Date.parse("2026-09-19T10:00:00.000Z");

    try {
        await redis.connect();
        await redis.ping();
        const first = await store.record(input("org-a", "event-1", baseTime, "powershell.exe", "explorer.exe"));
        const repeated = await store.record(input("org-a", "event-2", baseTime + 1_000, "powershell.exe", "explorer.exe"));
        const rare = await store.record(input("org-a", "event-3", baseTime + 2_000, "nc.exe", "cmd.exe"));
        const replay = await store.record(input("org-a", "event-3", baseTime + 2_000, "nc.exe", "cmd.exe"));
        const isolated = await store.record(input("org-b", "event-4", baseTime + 2_000, "powershell.exe", "explorer.exe"));

        assert.deepEqual(first, {
            replay: false,
            processRarityScore: 1,
            parentChildAnomaly: 1,
        });
        assert.equal(repeated.processRarityScore, 0);
        assert.equal(repeated.parentChildAnomaly, 0);
        assert.equal(rare.processRarityScore, 1);
        assert.equal(rare.parentChildAnomaly, 1);
        assert.deepEqual(replay, { ...rare, replay: true });
        assert.equal(isolated.processRarityScore, 1);
        assert.equal(isolated.parentChildAnomaly, 1);
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
    processName: string,
    parentProcessName: string,
) {
    return {
        organizationId,
        eventId,
        occurredAtEpochMs,
        endpointIdentity: "host-01",
        processName,
        parentProcessName,
    } as const;
}

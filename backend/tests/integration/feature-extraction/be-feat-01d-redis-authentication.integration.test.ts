import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Redis } from "ioredis";

import { RedisAuthenticationFeatureStore } from "../../../src/modules/feature-extraction/index.js";

test("maintains replay-safe isolated authentication windows", async () => {
    if (process.env.NODE_ENV === "production") {
        throw new Error("BE-FEAT-01D integration tests refuse to run in production.");
    }

    const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
        lazyConnect: true,
        connectTimeout: 1_000,
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        retryStrategy: () => null,
    });
    redis.on("error", () => undefined);
    const prefix = `features:be-feat-01d:${randomUUID()}`;
    const store = new RedisAuthenticationFeatureStore(redis, { keyPrefix: prefix });
    const baseTime = Date.parse("2026-09-19T10:00:00.000Z");

    try {
        await redis.connect();
        await redis.ping();
        const firstFailure = await store.record(
            input("org-a", "event-1", baseTime, "failure"),
        );
        const secondFailure = await store.record(
            input("org-a", "event-2", baseTime + 10_000, "failure"),
        );
        const firstSuccess = await store.record(
            input("org-a", "event-3", baseTime + 20_000, "success"),
        );
        const knownSourceFailure = await store.record(
            input("org-a", "event-4", baseTime + 30_000, "failure"),
        );
        const replay = await store.record(
            input("org-a", "event-4", baseTime + 30_000, "failure"),
        );
        const isolated = await store.record(
            input("org-b", "event-5", baseTime + 30_000, "failure"),
        );

        assert.deepEqual(firstFailure, {
            replay: false,
            failedLoginCount10Minutes: 1,
            failedToSuccessRatio: 1,
            newSourceIp: 1,
        });
        assert.equal(secondFailure.failedLoginCount10Minutes, 2);
        assert.equal(secondFailure.failedToSuccessRatio, 1);
        assert.equal(secondFailure.newSourceIp, 1);
        assert.equal(firstSuccess.failedLoginCount10Minutes, 2);
        assert.ok(
  Math.abs(firstSuccess.failedToSuccessRatio - 2 / 3) < 1e-12,
  `Expected failed_to_success_ratio to be approximately ${2 / 3}, received ${firstSuccess.failedToSuccessRatio}`,
);
        assert.equal(firstSuccess.newSourceIp, 1);
        assert.equal(knownSourceFailure.failedLoginCount10Minutes, 3);
        assert.equal(knownSourceFailure.failedToSuccessRatio, 3 / 4);
        assert.equal(knownSourceFailure.newSourceIp, 0);
        assert.deepEqual(replay, { ...knownSourceFailure, replay: true });
        assert.equal(isolated.failedLoginCount10Minutes, 1);
        assert.equal(isolated.newSourceIp, 1);
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
    outcome: "success" | "failure",
) {
    return {
        organizationId,
        eventId,
        occurredAtEpochMs,
        username: "alice",
        sourceIp: "192.0.2.10",
        outcome,
    } as const;
}

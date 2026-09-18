import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Redis } from "ioredis";

import {
  RedisAlertCooldownStore,
  type AcquireAlertCooldownInput,
} from "../../../src/modules/detection/index.js";

test("Redis admits one logical alert owner and rejects a different owner", async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("BE-DET-01D integration tests refuse to run in production.");
  }

  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 1,
  });
  redis.on("error", () => undefined);
  const suffix = randomUUID();
  const keyPrefix = `rule:cooldown:be-det-01d:${suffix}`;
  const store = new RedisAlertCooldownStore(redis, { keyPrefix });
  const input: AcquireAlertCooldownInput = {
    organizationId: `organization-${suffix}`,
    ruleId: `rule-${suffix}`,
    ruleStateVersion: "compiled-v1",
    entityKey: `s:entity-${suffix}`,
    alertId: `alert-${suffix}`,
    cooldownSeconds: 5,
  };

  try {
    await redis.connect();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => store.tryAcquire(input)),
    );

    assert.equal(results.filter(Boolean).length, 20);
    assert.equal(
      await store.tryAcquire({ ...input, alertId: `different-alert-${suffix}` }),
      false,
    );
    assert.equal(
      await store.tryAcquire({ ...input, entityKey: "s:independent-entity" }),
      true,
    );

    const keys = await redis.keys(`${keyPrefix}:*`);
    assert.equal(keys.length, 2);
    assert.equal(keys.some((key) => key.includes(input.organizationId)), false);
    assert.equal(keys.some((key) => key.includes(input.entityKey)), false);
    const ttl = await redis.pttl(keys[0]);
    assert.ok(ttl > 0 && ttl <= 5_000);
  } finally {
    const keys = await redis.keys(`${keyPrefix}:*`).catch(() => []);
    if (keys.length > 0) await redis.del(...keys).catch(() => undefined);
    redis.disconnect();
  }
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Redis } from "ioredis";

import {
  RedisCountWindowStore,
  ReloadableOrganizationSigmaRuleEngine,
  type ActiveCountRuleSourceRecord,
  type IActiveCountRuleSource,
  type IActiveMatchRuleSource,
} from "../../../src/modules/detection/index.js";

test("atomically evaluates an idempotent Redis-backed count rule", async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("BE-DET-01C integration tests refuse to run in production.");
  }

  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 1,
  });
  redis.on("error", () => undefined);
  const suffix = randomUUID();
  const organizationId = `be-det-01c-${suffix}`;
  const keyPrefix = `rule:count:be-det-01c:${suffix}`;
  const store = new RedisCountWindowStore(redis, { keyPrefix });
  const engine = new ReloadableOrganizationSigmaRuleEngine({
    organizationId,
    source: new EmptyMatchSource(),
    countSource: new OneCountRuleSource(organizationId),
    countWindowStore: store,
    now: () => new Date("2026-09-15T10:00:00.000Z"),
    generateAlertId: () => `alert-${suffix}`,
    monotonicNow: () => 1,
  });

  try {
    await redis.connect();
    await engine.reloadRules();

    const first = await engine.evaluate([countEvent(`first-${suffix}`)]);
    const replay = await engine.evaluate([countEvent(`first-${suffix}`)]);
    const second = await engine.evaluate([countEvent(`second-${suffix}`)]);
    const crossing = await engine.evaluate([countEvent(`third-${suffix}`)]);
    const above = await engine.evaluate([countEvent(`fourth-${suffix}`)]);

    assert.equal(first.alerts.length, 0);
    assert.equal(replay.alerts.length, 0);
    assert.equal(second.alerts.length, 0);
    assert.equal(crossing.alerts.length, 1);
    assert.equal(crossing.alerts[0].metadata.count, 3);
    assert.equal(above.alerts.length, 0);

    const expiryProbe = new RedisCountWindowStore(redis, {
      keyPrefix: `${keyPrefix}:expiry`,
    });
    await expiryProbe.recordMatch({
      organizationId,
      ruleId: "expiry-rule",
      ruleStateVersion: "expiry-rule-v1",
      entityKey: "s:192.0.2.50",
      eventId: "old-event",
      occurredAtEpochMs: 1_000,
      windowSeconds: 5,
    });
    const pruned = await expiryProbe.recordMatch({
      organizationId,
      ruleId: "expiry-rule",
      ruleStateVersion: "expiry-rule-v1",
      entityKey: "s:192.0.2.50",
      eventId: "new-event",
      occurredAtEpochMs: 6_001,
      windowSeconds: 5,
    });
    assert.deepEqual(pruned.eventIds, ["new-event"]);
  } finally {
    const keys = await redis.keys(`${keyPrefix}:*`).catch(() => []);
    if (keys.length > 0) await redis.del(...keys).catch(() => undefined);
    redis.disconnect();
  }
});

class EmptyMatchSource implements IActiveMatchRuleSource {
  public async listActiveMatchRules() {
    return [];
  }
}

class OneCountRuleSource implements IActiveCountRuleSource {
  public constructor(private readonly organizationId: string) {}

  public async listActiveCountRules(): Promise<readonly ActiveCountRuleSourceRecord[]> {
    return [{
      databaseId: "database-count-rule",
      organizationId: this.organizationId,
      name: "SSH Brute Force",
      severity: "high",
      weight: 0.8,
      classUid: 3002,
      categoryUid: 3,
      yamlContent: `
title: SSH Brute Force
id: sigma-ssh-brute-force
status: active
level: high
weight: 0.8
logsource:
  class_uid: 3002
  category_uid: 3
detection:
  selection:
    message|contains: Failed password
  condition: selection
  count:
    field: src_endpoint.ip
    threshold: 3
    timewindow: "5m"
`,
    }];
  }
}

function countEvent(eventId: string) {
  return {
    event_id: eventId,
    class_uid: 3002,
    category_uid: 3,
    message: "Failed password for root",
    src_endpoint: { ip: "192.0.2.10" },
  } as const;
}

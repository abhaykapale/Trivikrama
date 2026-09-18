import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Redis } from "ioredis";

import { closePostgres, createPostgresClient, pingPostgres } from "../../../src/database/postgres/client.js";
import { PostgresAlertRepository } from "../../../src/database/repositories/alerts/postgres-alert.repository.js";
import { PostgresRuleRepository } from "../../../src/database/repositories/rules/postgres-rule.repository.js";
import {
  createOrganizationRuleEngine,
  EvaluateAndPersistRuleAlertsService,
  PersistRuleAlertsService,
} from "../../../src/modules/detection/index.js";

test("ingestion detection persists one alert across a cooldown-enabled replay", async (context) => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("BE-DET-01F integration tests refuse to run in production.");
  }

  const suffix = randomUUID();
  const orgId = `be-det-01f-${suffix}`;
  const redisPrefix = `be-det-01f:${suffix}`;
  const postgres = createPostgresClient({
    connectionString:
      process.env.TEST_DATABASE_URL ??
      process.env.DATABASE_URL ??
      "postgresql://trivikrama_app:trivikrama_app_password@localhost:5432/trivikrama",
    poolMin: 0,
    poolMax: 2,
    acquireConnectionTimeoutMs: 5_000,
  });
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 1,
  });
  redis.on("error", () => undefined);
  const rules = new PostgresRuleRepository(postgres);
  const alerts = new PostgresAlertRepository(postgres);

  context.after(async () => {
    try {
      const keys = await redis.keys(`${redisPrefix}:*`).catch(() => []);
      if (keys.length > 0) await redis.del(...keys).catch(() => undefined);
      await postgres("public.alerts").where("org_id", orgId).delete();
      await postgres("public.rules").where("org_id", orgId).delete();
    } finally {
      redis.disconnect();
      await closePostgres(postgres);
    }
  });

  await Promise.all([pingPostgres(postgres), redis.connect()]);
  await rules.create({
    name: "BE-DET-01F Failed Login",
    type: "match",
    severity: "high",
    weight: 0.8,
    yamlContent: matchRuleYaml(`failed-login-${suffix}`),
    classUid: 3002,
    categoryUid: 3,
    orgId,
  });
  const engine = await createOrganizationRuleEngine({
    organizationId: orgId,
    ruleRepository: rules,
    redisClient: redis,
    countWindowKeyPrefix: `${redisPrefix}:count`,
    alertCooldownKeyPrefix: `${redisPrefix}:cooldown`,
  });
  const service = new EvaluateAndPersistRuleAlertsService({
    organizationId: orgId,
    ruleEngine: engine,
    alertPersistence: new PersistRuleAlertsService({ alerts }),
  });
  const event = {
    event_id: `event-${suffix}`,
    class_uid: 3002,
    category_uid: 3,
    severity_id: 3,
    time: new Date("2026-09-18T00:00:00.000Z"),
    message: "Failed password for root",
    metadata: { version: "1.1.0" },
    ingestion: {
      batch_id: `batch-${suffix}`,
      collector_id: "collector-1",
      ingested_at: new Date("2026-09-18T00:00:01.000Z"),
    },
    raw_event: { fixture: "be-det-01f" },
    org_id: orgId,
  } as const;

  const first = await service.execute([event]);
  const retry = await service.execute([event]);
  const stored = await alerts.list({ orgId });

  assert.deepEqual([first.insertedAlerts, first.alreadyPresentAlerts], [1, 0]);
  assert.deepEqual([retry.insertedAlerts, retry.alreadyPresentAlerts], [0, 1]);
  assert.equal(stored.items.length, 1);
});

function matchRuleYaml(sigmaId: string): string {
  return `
title: BE-DET-01F Failed Login
id: ${sigmaId}
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
alert:
  cooldown: "5m"
`;
}

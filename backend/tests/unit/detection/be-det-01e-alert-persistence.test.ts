import assert from "node:assert/strict";
import test from "node:test";

import type {
  AlertRecord,
  CreateAlertInput,
  CreateAlertsIfAbsentResult,
} from "../../../src/database/repositories/alerts/alert.repository.js";
import {
  compileSigmaMatchRuleYaml,
  createDeterministicRuleAlertId,
  PersistRuleAlertsService,
  StatelessSigmaRuleEngine,
  type RuleAlert,
} from "../../../src/modules/detection/index.js";

const ORG_ID = "be-det-01e-org";
const RULE_ID = "11111111-1111-4111-8111-111111111111";

test("derives the same UUIDv8 from the same logical alert", () => {
  const base = {
    organizationId: ORG_ID,
    ruleId: RULE_ID,
    ruleStateVersion: "compiled-v1",
    matchedEventIds: ["event-b", "event-a"],
  };
  const first = createDeterministicRuleAlertId(base);
  const reordered = createDeterministicRuleAlertId({
    ...base,
    matchedEventIds: ["event-a", "event-b"],
  });
  const changedRule = createDeterministicRuleAlertId({
    ...base,
    ruleStateVersion: "compiled-v2",
  });

  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.equal(first, reordered);
  assert.notEqual(first, changedRule);
});

test("organization-bound evaluation creates a replay-stable alert ID", async () => {
  const compiled = compileSigmaMatchRuleYaml(matchRuleYaml());
  const rule = Object.freeze({ ...compiled, id: RULE_ID });
  const engine = new StatelessSigmaRuleEngine([rule], {
    organizationId: ORG_ID,
  });
  const detectionEvent = {
    event_id: "event-1",
    class_uid: 3002,
    category_uid: 3,
    message: "Failed password for root",
  } as const;

  const first = await engine.evaluate([detectionEvent]);
  const replay = await engine.evaluate([detectionEvent]);

  assert.equal(first.alerts[0].alertId, replay.alerts[0].alertId);
  assert.equal(
    first.alerts[0].metadata.ruleStateVersion,
    compiled.compiledHash,
  );
});

test("persists a rule alert once and accepts an exact retry", async () => {
  const repository = new InMemoryIdempotentAlertRepository();
  const service = new PersistRuleAlertsService({ alerts: repository });
  const alert = ruleAlert();

  const first = await service.execute(ORG_ID, [alert]);
  const retry = await service.execute(ORG_ID, [alert]);
  repository.records.set(alert.alertId, {
    ...repository.records.get(alert.alertId)!,
    incidentId: "22222222-2222-4222-8222-222222222222",
  });
  const retryAfterCorrelation = await service.execute(ORG_ID, [alert]);

  assert.deepEqual(
    [first.insertedCount, first.alreadyPresentCount],
    [1, 0],
  );
  assert.deepEqual(
    [retry.insertedCount, retry.alreadyPresentCount],
    [0, 1],
  );
  assert.deepEqual(
    [
      retryAfterCorrelation.insertedCount,
      retryAfterCorrelation.alreadyPresentCount,
    ],
    [0, 1],
  );
  assert.equal(repository.records.size, 1);
  assert.equal(first.records[0].incidentId, null);
  assert.equal(first.records[0].alertType, "rule");
  assert.equal(first.records[0].orgId, ORG_ID);
});

test("rejects reuse of an alert ID for different security content", async () => {
  const repository = new InMemoryIdempotentAlertRepository();
  const service = new PersistRuleAlertsService({ alerts: repository });
  const alert = ruleAlert();
  await service.execute(ORG_ID, [alert]);

  await assert.rejects(
    service.execute(ORG_ID, [{ ...alert, severity: "critical" }]),
    /Alert identity collision/u,
  );
});

test("rejects blank tenant boundaries and non-database rule IDs", async () => {
  const service = new PersistRuleAlertsService({
    alerts: new InMemoryIdempotentAlertRepository(),
  });

  await assert.rejects(service.execute(" ", [ruleAlert()]), /organizationId/u);
  await assert.rejects(
    service.execute(ORG_ID, [{ ...ruleAlert(), ruleId: "sigma-slug" }]),
    /alert\.ruleId must be a UUID/u,
  );
});

class InMemoryIdempotentAlertRepository {
  public readonly records = new Map<string, AlertRecord>();

  public async createManyIfAbsent(
    inputs: readonly CreateAlertInput[],
  ): Promise<CreateAlertsIfAbsentResult> {
    let insertedCount = 0;
    const records = inputs.map((input) => {
      const existing = this.records.get(input.id!);
      if (existing !== undefined) return existing;
      insertedCount += 1;
      const record = toRecord(input);
      this.records.set(record.id, record);
      return record;
    });
    return {
      insertedCount,
      existingCount: inputs.length - insertedCount,
      records,
    };
  }
}

function toRecord(input: CreateAlertInput): AlertRecord {
  return {
    id: input.id!,
    incidentId: input.incidentId ?? null,
    alertType: input.alertType,
    ruleId: input.ruleId ?? null,
    ruleName: input.ruleName ?? null,
    matchedCondition: input.matchedCondition ?? null,
    anomalyScore: input.anomalyScore ?? null,
    confidence: input.confidence ?? null,
    threatCategory: input.threatCategory ?? null,
    modelVersion: input.modelVersion ?? null,
    shapValues: input.shapValues ?? null,
    severity: input.severity ?? "medium",
    weight: input.weight ?? 0.5,
    tags: input.tags ?? [],
    metadata: input.metadata ?? {},
    matchedEventIds: input.matchedEventIds ?? [],
    createdAt: new Date("2026-09-16T10:00:00.000Z"),
    orgId: input.orgId!,
  };
}

function ruleAlert(): RuleAlert {
  return {
    alertId: "88888888-8888-8888-8888-888888888888",
    ruleId: RULE_ID,
    ruleName: "Failed Login",
    ruleDescription: "Detects failed authentication",
    severity: "high",
    weight: 0.8,
    matchedEvents: ["event-1"],
    matchedCondition: "selection",
    tags: ["attack.t1110"],
    timestamp: new Date("2026-09-16T10:00:00.000Z"),
    metadata: {
      ruleType: "match",
      sigmaId: "failed-login-001",
      ruleStateVersion: "compiled-v1",
    },
  };
}

function matchRuleYaml(): string {
  return `
title: Failed Login
id: failed-login-001
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
`;
}

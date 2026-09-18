import assert from "node:assert/strict";
import test from "node:test";

import type { CreateNormalizedEventInput } from "../../../src/database/repositories/mongodb/normalized-event.repository.js";
import {
  compileSigmaCountRuleYaml,
  CountRuleEvaluator,
  EvaluateAndPersistRuleAlertsService,
  type OrganizationCompiledCountRule,
  type RuleAlert,
  type RuleEvaluationResult,
} from "../../../src/modules/detection/index.js";

const ORG_ID = "organization-blue";

test("evaluates trusted normalized events and persists generated alerts", async () => {
  const engine = new RecordingRuleEngine();
  const persistence = new RecordingAlertPersistence();
  const service = new EvaluateAndPersistRuleAlertsService({
    organizationId: ORG_ID,
    ruleEngine: engine,
    alertPersistence: persistence,
  });

  const result = await service.execute([normalizedEvent()]);

  assert.equal(engine.events[0]?.event_id, "event-1");
  assert.equal(persistence.organizationId, ORG_ID);
  assert.equal(persistence.alerts[0]?.alertId, ALERT.alertId);
  assert.deepEqual(result, {
    evaluation: engine.result.stats,
    insertedAlerts: 1,
    alreadyPresentAlerts: 0,
  });
});

test("fails closed before evaluation when an event crosses the tenant boundary", async () => {
  const engine = new RecordingRuleEngine();
  const service = new EvaluateAndPersistRuleAlertsService({
    organizationId: ORG_ID,
    ruleEngine: engine,
    alertPersistence: new RecordingAlertPersistence(),
  });

  await assert.rejects(
    service.execute([{ ...normalizedEvent(), org_id: "organization-red" }]),
    /organization boundary/u,
  );
  assert.equal(engine.calls, 0);
});

test("fails the ingestion step when alert persistence fails", async () => {
  const service = new EvaluateAndPersistRuleAlertsService({
    organizationId: ORG_ID,
    ruleEngine: new RecordingRuleEngine(),
    alertPersistence: {
      async execute(): Promise<never> {
        throw new Error("PostgreSQL unavailable");
      },
    },
  });

  await assert.rejects(
    service.execute([normalizedEvent()]),
    /PostgreSQL unavailable/u,
  );
});

test("reconstructs a count alert when the threshold event is replayed", async () => {
  const compiled = compileSigmaCountRuleYaml(countRuleYaml());
  const rule: OrganizationCompiledCountRule = {
    ...compiled,
    id: "11111111-1111-4111-8111-111111111111",
    organizationId: ORG_ID,
  };
  const evaluator = new CountRuleEvaluator({
    selectRules: () => [rule],
    windowStore: {
      async recordMatch() {
        return {
          inserted: false,
          count: 2,
          eventIds: ["event-0", "event-1"],
        };
      },
    },
    now: () => new Date("2026-09-18T00:00:00.000Z"),
  });

  // The rule engine accepts an open detection-event shape. Spreading models
  // the application adapter that converts the closed persistence DTO.
  const result = await evaluator.evaluate([{ ...normalizedEvent() }]);

  assert.equal(result.alerts.length, 1);
  assert.deepEqual(result.alerts[0]?.matchedEvents, ["event-0", "event-1"]);
});

class RecordingRuleEngine {
  public calls = 0;
  public events: readonly Record<string, unknown>[] = [];
  public readonly result: RuleEvaluationResult = {
    alerts: [ALERT],
    stats: {
      rulesEvaluated: 1,
      rulesMatched: 1,
      alertsGenerated: 1,
      evaluationDurationMs: 1,
      eventsEvaluated: 1,
    },
  };

  public async evaluate(events: readonly Record<string, unknown>[]) {
    this.calls += 1;
    this.events = events;
    return this.result;
  }
}

class RecordingAlertPersistence {
  public organizationId: string | undefined;
  public alerts: readonly RuleAlert[] = [];

  public async execute(organizationId: string, alerts: readonly RuleAlert[]) {
    this.organizationId = organizationId;
    this.alerts = alerts;
    return {
      insertedCount: alerts.length,
      alreadyPresentCount: 0,
      records: [],
    };
  }
}

const ALERT: RuleAlert = {
  alertId: "88888888-8888-8888-8888-888888888888",
  ruleId: "11111111-1111-4111-8111-111111111111",
  ruleName: "Failed Login",
  ruleDescription: "Detects failed authentication",
  severity: "high",
  weight: 0.8,
  matchedEvents: ["event-1"],
  matchedCondition: "selection",
  tags: ["attack.t1110"],
  timestamp: new Date("2026-09-18T00:00:00.000Z"),
  metadata: { ruleType: "match", ruleStateVersion: "compiled-v1" },
};

function normalizedEvent(): CreateNormalizedEventInput {
  return {
    event_id: "event-1",
    dedup_hash: `sha256:${"a".repeat(64)}`,
    class_uid: 3002,
    category_uid: 3,
    severity_id: 3,
    time: new Date("2026-09-18T00:00:00.000Z"),
    message: "Failed password for root",
    src_endpoint: { ip: "192.0.2.10" },
    metadata: { version: "1.1.0" },
    ingestion: {
      batch_id: "batch-1",
      collector_id: "collector-1",
      ingested_at: new Date("2026-09-18T00:00:01.000Z"),
    },
    raw_event: { event_id: "event-1" },
    org_id: ORG_ID,
  };
}

function countRuleYaml(): string {
  return `
title: Failed Login Burst
id: failed-login-burst
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
    threshold: 2
    timewindow: "5m"
`;
}

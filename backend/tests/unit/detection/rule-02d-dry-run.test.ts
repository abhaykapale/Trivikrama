import assert from "node:assert/strict";
import test from "node:test";

import { DryRunRuleUseCase } from "../../../src/modules/detection/application/dry-run-rule.use-case.js";
import { RuleCommandNotFoundError } from "../../../src/modules/detection/domain/rule-command.contracts.js";
import type { RuleDryRunEvent } from "../../../src/modules/detection/domain/rule-operational.contracts.js";
import type { RuleQueryRecord } from "../../../src/modules/detection/domain/rule-query.contracts.js";

const RULE_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-26T12:00:00.000Z");

test("RULE-02D dry-runs a match rule against bounded tenant events", async () => {
  let eventQuery: unknown;
  let tick = 10;
  const useCase = new DryRunRuleUseCase({
    rules: { async findById() { return ruleRecord(matchYaml()); } },
    events: {
      async listForRule(input) {
        eventQuery = input;
        return [
          event("evt-1", "2026-10-26T11:00:00.000Z", "failed login"),
          event("evt-2", "2026-10-26T11:01:00.000Z", "successful login"),
        ];
      },
    },
    clock: { now: () => NOW, monotonicNow: () => tick++ },
  });

  const result = await useCase.execute({
    orgId: "tenant-a",
    ruleId: RULE_ID,
    timeRangeSeconds: 86_400,
    limit: 1_000,
  });
  assert.equal(result.totalEvaluated, 2);
  assert.equal(result.matches, 1);
  assert.deepEqual(result.matchedEventIds, ["evt-1"]);
  assert.equal(result.executionTimeMs, 1);
  assert.deepEqual(eventQuery, {
    orgId: "tenant-a",
    classUid: 3002,
    categoryUid: 3,
    from: new Date("2026-10-25T12:00:00.000Z"),
    to: NOW,
    limit: 1_000,
  });
});

test("RULE-02D dry-runs count rules in memory without Redis state", async () => {
  const useCase = new DryRunRuleUseCase({
    rules: { async findById() { return ruleRecord(countYaml()); } },
    events: {
      async listForRule() {
        return [
          event("evt-1", "2026-10-26T11:00:00.000Z", "failed login", "10.0.0.1"),
          event("evt-2", "2026-10-26T11:01:00.000Z", "failed login", "10.0.0.1"),
          event("evt-3", "2026-10-26T11:02:00.000Z", "failed login", "10.0.0.1"),
          event("evt-4", "2026-10-26T11:03:00.000Z", "failed login", "10.0.0.1"),
        ];
      },
    },
    clock: { now: () => NOW, monotonicNow: () => 0 },
  });

  const result = await useCase.execute({
    orgId: "tenant-a",
    ruleId: RULE_ID,
    timeRangeSeconds: 3_600,
    limit: 100,
  });
  assert.equal(result.matches, 1);
  assert.deepEqual(result.matchedEventIds, ["evt-1", "evt-2", "evt-3"]);
  assert.equal(result.sampleMatches[0]?.eventId, "evt-3");
});

test("RULE-02D dry-run conceals a cross-tenant or absent rule", async () => {
  let queriedEvents = false;
  const useCase = new DryRunRuleUseCase({
    rules: { async findById() { return null; } },
    events: { async listForRule() { queriedEvents = true; return []; } },
  });
  await assert.rejects(
    () => useCase.execute({ orgId: "tenant-b", ruleId: RULE_ID, timeRangeSeconds: 60, limit: 1 }),
    RuleCommandNotFoundError,
  );
  assert.equal(queriedEvents, false);
});

function event(
  eventId: string,
  time: string,
  message: string,
  srcIp = "10.0.0.1",
): RuleDryRunEvent {
  return {
    event: {
      event_id: eventId,
      class_uid: 3002,
      category_uid: 3,
      message,
      src_endpoint: { ip: srcIp },
    },
    time: new Date(time),
    message,
  };
}

function ruleRecord(yamlContent: string): RuleQueryRecord {
  return {
    id: RULE_ID,
    name: "Dry Run Rule",
    description: null,
    status: "active",
    type: yamlContent.includes("count:") ? "count" : "match",
    severity: "high",
    weight: 0.8,
    priority: 800,
    classUid: 3002,
    categoryUid: 3,
    tags: [],
    falsePositives: [],
    references: [],
    yamlContent,
    compiledHash: "a".repeat(64),
    isBuiltin: false,
    version: 1,
    createdBy: null,
    updatedBy: null,
    alertsGenerated: 0,
    lastTriggeredAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function matchYaml(): string {
  return `title: Dry Run Rule
id: rule-dry-run-001
status: active
level: high
weight: 0.8
logsource:
  class_uid: 3002
  category_uid: 3
detection:
  selection:
    message|contains: failed
  condition: selection
`;
}

function countYaml(): string {
  return matchYaml().replace(
    "  condition: selection",
    "  count:\n    field: src_endpoint.ip\n    threshold: 3\n    timewindow: 5m\n  condition: selection",
  );
}

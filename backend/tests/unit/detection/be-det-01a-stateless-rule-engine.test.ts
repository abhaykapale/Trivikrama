import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compileSigmaMatchRuleYaml,
  RuleValidationError,
  StatelessSigmaRuleEngine,
  type DetectionEvent,
} from "../../../src/modules/detection/index.js";

const BASE_RULE = `
title: Suspicious Administrator Login
id: suspicious-admin-login-001
description: Detects a high-severity administrator login outside the allow list.
status: active
level: high
weight: 0.8
priority: 700
logsource:
  class_uid: 3002
  category_uid: 3
detection:
  selection:
    message|contains: Failed password
    severity_id|gte: 3
    actor.user.name|startswith: admin
  filter:
    src_endpoint.ip|in:
      - 10.0.0.10
      - 10.0.0.11
  condition: selection AND NOT filter
tags:
  - attack.credential_access
  - attack.t1110
`;

test("compiles YAML and matches nested OCSF fields with AND and NOT", () => {
  const rule = compileSigmaMatchRuleYaml(BASE_RULE);

  assert.equal(rule.matches(event()), true);
  assert.equal(rule.matches(event({ src_endpoint: { ip: "10.0.0.10" } })), false);
  assert.equal(rule.compiledHash.length, 64);
  assert.equal(rule.priority, 700);
});

test("supports OR groups, list alternatives and the stateless operators", () => {
  const rule = compileSigmaMatchRuleYaml(`
title: Operator Coverage
id: operator-coverage-001
status: active
level: medium
weight: 0.5
logsource:
  class_uid: 3002
detection:
  first:
    - actor.process.name|endswith: sshd
    - message|re: ^Failed.*root$
  second:
    dst_endpoint.port|lt: 1024
    severity_id|lte: 4
    actor.user.uid|exists: true
    actor.user.name|not: SYSTEM
  condition: first OR second
`);

  assert.equal(rule.matches(event({ message: "Failed password root" })), true);
  assert.equal(
    rule.matches(
      event({
        message: "unrelated",
        dst_endpoint: { port: 22 },
        actor: { user: { name: "admin", uid: "42" } },
      }),
    ),
    true,
  );
});

test("preserves significant whitespace in string match targets", () => {
  const rule = compileSigmaMatchRuleYaml(
    BASE_RULE.replace(
      "message|contains: Failed password",
      "message|contains: ' password '",
    ),
  );

  assert.equal(rule.matches(event()), true);
  assert.equal(rule.matches(event({ message: "password" })), false);
});

test("filters by OCSF class and optional category before selection evaluation", () => {
  const rule = compileSigmaMatchRuleYaml(BASE_RULE);

  assert.equal(rule.matches(event({ class_uid: 4001 })), false);
  assert.equal(rule.matches(event({ category_uid: 4 })), false);
});

test("rejects unknown selections, unsafe paths, unsupported operators and stateful rules", () => {
  const cases = [
    BASE_RULE.replace("selection AND NOT filter", "selection AND missing"),
    BASE_RULE.replace("message|contains", "actor.__proto__.polluted"),
    BASE_RULE.replace("message|contains", "message|base64"),
    BASE_RULE.replace(
      "  condition: selection AND NOT filter",
      "  condition: selection AND NOT filter\n  count:\n    field: src_endpoint.ip\n    threshold: 5\n    timewindow: 5m",
    ),
  ];

  for (const source of cases) {
    assert.throws(() => compileSigmaMatchRuleYaml(source), RuleValidationError);
  }
});

test("rejects risky regular expressions instead of executing arbitrary patterns", () => {
  const source = BASE_RULE.replace(
    "message|contains: Failed password",
    "message|re: '(a+)+$'",
  );

  assert.throws(() => compileSigmaMatchRuleYaml(source), RuleValidationError);
});

test("evaluates applicable rules in priority order and builds deterministic alerts", async () => {
  const highPriority = compileSigmaMatchRuleYaml(BASE_RULE);
  const lowerPriority = compileSigmaMatchRuleYaml(
    BASE_RULE
      .replace("suspicious-admin-login-001", "second-admin-login-001")
      .replace("priority: 700", "priority: 100"),
  );
  let alertSequence = 0;
  let monotonicTime = 10;
  const fixedTime = new Date("2026-09-14T00:00:00.000Z");
  const engine = new StatelessSigmaRuleEngine([lowerPriority, highPriority], {
    now: () => fixedTime,
    generateAlertId: () => `alert-${++alertSequence}`,
    monotonicNow: () => monotonicTime++,
  });

  const result = await engine.evaluate([event()]);

  assert.deepEqual(
    result.alerts.map((alert) => alert.ruleId),
    ["suspicious-admin-login-001", "second-admin-login-001"],
  );
  assert.deepEqual(result.alerts[0].matchedEvents, ["event-001"]);
  assert.equal(result.alerts[0].timestamp.toISOString(), fixedTime.toISOString());
  assert.deepEqual(result.stats, {
    rulesEvaluated: 2,
    rulesMatched: 2,
    alertsGenerated: 2,
    evaluationDurationMs: 1,
    eventsEvaluated: 1,
  });
});

test("reports only rules applicable to an event in evaluation statistics", async () => {
  const rule = compileSigmaMatchRuleYaml(BASE_RULE);
  const engine = new StatelessSigmaRuleEngine([rule]);
  const result = await engine.evaluate([event({ class_uid: 4001 })]);

  assert.equal(result.alerts.length, 0);
  assert.equal(result.stats.rulesEvaluated, 0);
  assert.equal(result.stats.eventsEvaluated, 1);
  assert.equal(engine.getStats().rulesByType.match, 1);
});

function event(overrides: Partial<DetectionEvent> = {}): DetectionEvent {
  return {
    event_id: "event-001",
    class_uid: 3002,
    category_uid: 3,
    severity_id: 4,
    message: "Failed password for admin-root",
    src_endpoint: { ip: "203.0.113.10" },
    dst_endpoint: { port: 22 },
    actor: {
      user: { name: "admin-root", uid: "1000" },
      process: { name: "sshd" },
    },
    ...overrides,
  };
}

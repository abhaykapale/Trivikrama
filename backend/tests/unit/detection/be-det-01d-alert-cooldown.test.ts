import assert from "node:assert/strict";
import test from "node:test";

import {
  compileSigmaCountRuleYaml,
  compileSigmaMatchRuleYaml,
  CountRuleEvaluator,
  RedisAlertCooldownStore,
  StatelessSigmaRuleEngine,
  type AcquireAlertCooldownInput,
  type CountWindowSnapshot,
  type DetectionEvent,
  type IAlertCooldownStore,
  type ICountWindowStore,
  type OrganizationCompiledCountRule,
  type RecordCountWindowMatchInput,
} from "../../../src/modules/detection/index.js";

const ORGANIZATION_ID = "be-det-01d-org";

test("compiles an optional bounded alert cooldown", () => {
  assert.equal(compileSigmaMatchRuleYaml(matchRuleYaml()).cooldownSeconds, 0);
  assert.equal(
    compileSigmaMatchRuleYaml(withCooldown(matchRuleYaml(), "2m"))
      .cooldownSeconds,
    120,
  );
  assert.equal(
    compileSigmaCountRuleYaml(withCooldown(countRuleYaml(), "1h"))
      .cooldownSeconds,
    3_600,
  );
});

test("rejects malformed, zero and oversized cooldowns", () => {
  for (const value of ["5d", "0s", "25h"]) {
    assert.throws(
      () => compileSigmaMatchRuleYaml(withCooldown(matchRuleYaml(), value)),
      /alert\.cooldown/u,
    );
  }
});

test("uses an atomic replay-aware Redis lease and hashes every identity", async () => {
  const redis = new FakeRedisEval();
  const store = new RedisAlertCooldownStore(redis, {
    keyPrefix: "rule:cooldown:test",
  });
  const input = cooldownInput();

  assert.equal(await store.tryAcquire(input), true);
  redis.response = 0;
  assert.equal(await store.tryAcquire(input), false);

  const [key, alertId, milliseconds] = redis.calls[0];
  assert.equal(alertId, input.alertId);
  assert.equal(milliseconds, 300_000);
  assert.equal(String(key).includes(input.organizationId), false);
  assert.equal(String(key).includes(input.ruleId), false);
  assert.equal(String(key).includes(input.entityKey), false);
});

test("reconstructs the same cooldown-enabled match alert on an exact retry", async () => {
  const cooldownStore = new InMemoryCooldownStore();
  const rule = compileSigmaMatchRuleYaml(
    withCooldown(matchRuleYaml(), "5m"),
  );
  const engine = new StatelessSigmaRuleEngine([rule], {
    organizationId: ORGANIZATION_ID,
    cooldownStore,
    now: () => new Date("2026-09-16T10:00:00.000Z"),
  });

  const first = await engine.evaluate([event("event-1")]);
  const replay = await engine.evaluate([event("event-1")]);
  const independent = await engine.evaluate([event("event-2")]);

  assert.equal(first.alerts.length, 1);
  assert.equal(replay.alerts.length, 1);
  assert.equal(first.alerts[0]?.alertId, replay.alerts[0]?.alertId);
  assert.equal(independent.alerts.length, 1);
});

test("fails closed when a rule requires cooldown but no store is configured", async () => {
  const rule = compileSigmaMatchRuleYaml(
    withCooldown(matchRuleYaml(), "5m"),
  );
  const engine = new StatelessSigmaRuleEngine([rule]);

  await assert.rejects(
    engine.evaluate([event("event-1")]),
    /Redis cooldown store is required/u,
  );
});

test("applies count-rule cooldown to the configured grouping entity", async () => {
  const compiled = compileSigmaCountRuleYaml(
    withCooldown(countRuleYaml(), "5m"),
  );
  const rule: OrganizationCompiledCountRule = Object.freeze({
    ...compiled,
    id: "database-count-rule",
    organizationId: ORGANIZATION_ID,
  });
  const cooldownStore = new RejectingCooldownStore();
  const evaluator = new CountRuleEvaluator({
    windowStore: new CrossingCountWindowStore(),
    cooldownStore,
    selectRules: () => [rule],
    now: () => new Date("2026-09-16T10:00:00.000Z"),
  });

  const result = await evaluator.evaluate([event("event-1")]);

  assert.equal(result.alerts.length, 0);
  assert.equal(cooldownStore.lastInput?.entityKey, "s:192.0.2.10");
  assert.equal(cooldownStore.lastInput?.ruleId, "database-count-rule");
});

class FakeRedisEval {
  public readonly calls: Array<Array<string | number>> = [];
  public response: unknown = 1;

  public async eval(
    _script: string,
    _numberOfKeys: number,
    ...arguments_: Array<string | number>
  ): Promise<unknown> {
    this.calls.push(arguments_);
    return this.response;
  }
}

class InMemoryCooldownStore implements IAlertCooldownStore {
  private readonly owners = new Map<string, string>();

  public async tryAcquire(input: AcquireAlertCooldownInput): Promise<boolean> {
    const key = [
      input.organizationId,
      input.ruleId,
      input.ruleStateVersion,
      input.entityKey,
    ].join("|");
    const owner = this.owners.get(key);
    if (owner !== undefined) return owner === input.alertId;
    this.owners.set(key, input.alertId);
    return true;
  }
}

class RejectingCooldownStore implements IAlertCooldownStore {
  public lastInput: AcquireAlertCooldownInput | undefined;

  public async tryAcquire(input: AcquireAlertCooldownInput): Promise<boolean> {
    this.lastInput = input;
    return false;
  }
}

class CrossingCountWindowStore implements ICountWindowStore {
  public async recordMatch(
    input: RecordCountWindowMatchInput,
  ): Promise<CountWindowSnapshot> {
    return { inserted: true, count: 1, eventIds: [input.eventId] };
  }
}

function cooldownInput(): AcquireAlertCooldownInput {
  return {
    organizationId: ORGANIZATION_ID,
    ruleId: "database-rule-id",
    ruleStateVersion: "compiled-version",
    entityKey: "s:192.0.2.10",
    alertId: "88888888-8888-8888-8888-888888888888",
    cooldownSeconds: 300,
  };
}

function event(eventId: string): DetectionEvent {
  return {
    event_id: eventId,
    class_uid: 3002,
    category_uid: 3,
    message: "Failed password for root",
    src_endpoint: { ip: "192.0.2.10" },
  };
}

function withCooldown(source: string, cooldown: string): string {
  return `${source}\nalert:\n  cooldown: "${cooldown}"\n`;
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

function countRuleYaml(): string {
  return `
title: SSH Brute Force
id: ssh-brute-force-001
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
    threshold: 1
    timewindow: "5m"
`;
}

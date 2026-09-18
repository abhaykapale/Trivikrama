import assert from "node:assert/strict";
import test from "node:test";

import type { PageResult } from "../../../src/database/repositories/common/repository.types.js";
import type {
  RuleListFilters,
  RuleRecord,
} from "../../../src/database/repositories/rules/rule.repository.js";
import {
  compileSigmaCountRuleYaml,
  PostgresActiveCountRuleSource,
  RedisCountWindowStore,
  ReloadableOrganizationSigmaRuleEngine,
  type ActiveCountRuleSourceRecord,
  type CountWindowSnapshot,
  type IActiveCountRuleSource,
  type IActiveMatchRuleSource,
  type ICountWindowStore,
  type RecordCountWindowMatchInput,
} from "../../../src/modules/detection/index.js";

const ORG_ID = "be-det-01c-org";

test("hashes Redis key identities and versions state by compiled rule", async () => {
  const redis = new FakeRedisEval();
  const store = new RedisCountWindowStore(redis, { keyPrefix: "rule:count:test" });
  const base = {
    organizationId: ORG_ID,
    ruleId: "database-count-rule",
    entityKey: "s:192.0.2.10",
    eventId: "event-1",
    occurredAtEpochMs: 1_000,
    windowSeconds: 300,
  };

  await store.recordMatch({ ...base, ruleStateVersion: "version-one" });
  await store.recordMatch({ ...base, ruleStateVersion: "version-two" });

  const firstKey = String(redis.calls[0][0]);
  const secondKey = String(redis.calls[1][0]);
  assert.notEqual(firstKey, secondKey);
  assert.equal(firstKey.includes(ORG_ID), false);
  assert.equal(firstKey.includes("database-count-rule"), false);
  assert.equal(firstKey.includes("192.0.2.10"), false);
});

test("requests only active organization-scoped count rules from PostgreSQL", async () => {
  const calls: RuleListFilters[] = [];
  const repository = {
    async list(filters: RuleListFilters = {}): Promise<PageResult<RuleRecord>> {
      calls.push(filters);
      return {
        items: [databaseCountRule()],
        limit: 25,
        offset: 0,
        hasMore: false,
      };
    },
  };

  const rules = await new PostgresActiveCountRuleSource(repository, 25)
    .listActiveCountRules(ORG_ID);

  assert.equal(rules.length, 1);
  assert.deepEqual(calls, [{
    orgId: ORG_ID,
    status: "active",
    type: "count",
    limit: 25,
    offset: 0,
  }]);
});

test("compiles count selection, grouping field, threshold and time window", () => {
  const rule = compileSigmaCountRuleYaml(countRuleYaml());

  assert.equal(rule.type, "count");
  assert.equal(rule.count.field, "src_endpoint.ip");
  assert.deepEqual(rule.count.fieldSegments, ["src_endpoint", "ip"]);
  assert.equal(rule.count.threshold, 3);
  assert.equal(rule.count.timeWindowSeconds, 300);
  assert.equal(rule.matches(event("event-1", "192.0.2.10")), true);
});

test("rejects invalid count thresholds, windows and unsafe grouping paths", () => {
  assert.throws(
    () => compileSigmaCountRuleYaml(countRuleYaml().replace("threshold: 3", "threshold: 0")),
    /detection\.count\.threshold/u,
  );
  assert.throws(
    () => compileSigmaCountRuleYaml(countRuleYaml().replace('timewindow: "5m"', 'timewindow: "5d"')),
    /detection\.count\.timewindow/u,
  );
  assert.throws(
    () => compileSigmaCountRuleYaml(countRuleYaml().replace("src_endpoint.ip", "__proto__.ip")),
    /detection\.count\.field/u,
  );
});

test("alerts once when one entity crosses the threshold", async () => {
  const windowStore = new InMemoryCountWindowStore();
  const engine = createEngine(windowStore);
  await engine.reloadRules();

  const belowThreshold = await engine.evaluate([
    event("event-1", "192.0.2.10"),
    event("event-2", "192.0.2.10"),
  ]);
  const crossing = await engine.evaluate([event("event-3", "192.0.2.10")]);
  const aboveThreshold = await engine.evaluate([event("event-4", "192.0.2.10")]);

  assert.equal(belowThreshold.alerts.length, 0);
  assert.equal(crossing.alerts.length, 1);
  assert.deepEqual(crossing.alerts[0].matchedEvents, ["event-1", "event-2", "event-3"]);
  assert.equal(crossing.alerts[0].metadata.count, 3);
  assert.equal(crossing.alerts[0].metadata.groupByValue, "192.0.2.10");
  assert.equal(aboveThreshold.alerts.length, 0);
});

test("keeps independent rolling windows for different grouping values", async () => {
  const engine = createEngine(new InMemoryCountWindowStore());
  await engine.reloadRules();

  const result = await engine.evaluate([
    event("a-1", "192.0.2.10"),
    event("b-1", "192.0.2.20"),
    event("a-2", "192.0.2.10"),
    event("b-2", "192.0.2.20"),
  ]);

  assert.equal(result.alerts.length, 0);
});

test("does not count an exact event replay twice", async () => {
  const engine = createEngine(new InMemoryCountWindowStore());
  await engine.reloadRules();

  await engine.evaluate([event("event-1", "192.0.2.10")]);
  await engine.evaluate([event("event-1", "192.0.2.10")]);
  const result = await engine.evaluate([event("event-2", "192.0.2.10")]);

  assert.equal(result.alerts.length, 0);
});

test("retains a last-known-good count rule when its update is invalid", async () => {
  const countSource = new FakeCountSource([countSourceRule()]);
  const engine = createEngine(new InMemoryCountWindowStore(), countSource);
  await engine.reloadRules();

  countSource.records = [{
    ...countSource.records[0],
    yamlContent: countRuleYaml().replace("threshold: 3", "threshold: 0"),
  }];
  await engine.reloadRules();

  assert.equal(engine.getLastCountReloadReport()?.rejectedRules, 1);
  assert.equal(engine.getLastCountReloadReport()?.reusedLastKnownGoodRules, 1);
  assert.equal(engine.getStats().rulesByType.count, 1);
});

class EmptyMatchSource implements IActiveMatchRuleSource {
  public async listActiveMatchRules() {
    return [];
  }
}

class FakeCountSource implements IActiveCountRuleSource {
  public constructor(public records: readonly ActiveCountRuleSourceRecord[]) {}

  public async listActiveCountRules(organizationId: string) {
    assert.equal(organizationId, ORG_ID);
    return this.records;
  }
}

class InMemoryCountWindowStore implements ICountWindowStore {
  private readonly windows = new Map<string, Map<string, number>>();

  public async recordMatch(
    input: RecordCountWindowMatchInput,
  ): Promise<CountWindowSnapshot> {
    const key = [
      input.organizationId,
      input.ruleId,
      input.ruleStateVersion,
      input.entityKey,
    ].join("|");
    const entries = this.windows.get(key) ?? new Map<string, number>();
    const cutoff = input.occurredAtEpochMs - input.windowSeconds * 1_000;

    for (const [eventId, timestamp] of entries) {
      if (timestamp <= cutoff) entries.delete(eventId);
    }

    const inserted = !entries.has(input.eventId);
    if (inserted) entries.set(input.eventId, input.occurredAtEpochMs);
    this.windows.set(key, entries);

    return {
      inserted,
      count: entries.size,
      eventIds: [...entries.entries()]
        .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
        .map(([eventId]) => eventId),
    };
  }
}

class FakeRedisEval {
  public readonly calls: Array<readonly (string | number)[]> = [];

  public async eval(
    _script: string,
    _numberOfKeys: number,
    ...arguments_: (string | number)[]
  ): Promise<unknown> {
    this.calls.push(arguments_);
    return [1, String(arguments_[4])];
  }
}

function createEngine(
  windowStore: ICountWindowStore,
  countSource = new FakeCountSource([countSourceRule()]),
) {
  return new ReloadableOrganizationSigmaRuleEngine({
    organizationId: ORG_ID,
    source: new EmptyMatchSource(),
    countSource,
    countWindowStore: windowStore,
    now: () => new Date("2026-09-15T10:00:00.000Z"),
    generateAlertId: () => "count-alert",
    monotonicNow: () => 1,
  });
}

function countSourceRule(): ActiveCountRuleSourceRecord {
  return {
    databaseId: "database-count-rule",
    organizationId: ORG_ID,
    name: "SSH Brute Force",
    severity: "high",
    weight: 0.8,
    classUid: 3002,
    categoryUid: 3,
    yamlContent: countRuleYaml(),
  };
}

function databaseCountRule(): RuleRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "SSH Brute Force",
    description: null,
    status: "active",
    type: "count",
    severity: "high",
    weight: 0.8,
    yamlContent: countRuleYaml(),
    compiledHash: null,
    classUid: 3002,
    categoryUid: 3,
    tags: [],
    falsePositives: [],
    ruleReferences: [],
    version: 1,
    isBuiltin: false,
    createdBy: null,
    updatedBy: null,
    createdAt: new Date("2026-09-15T00:00:00.000Z"),
    updatedAt: new Date("2026-09-15T00:00:00.000Z"),
    orgId: ORG_ID,
  };
}

function countRuleYaml(): string {
  return `
title: SSH Brute Force
id: sigma-ssh-brute-force
status: active
level: high
weight: 0.8
priority: 800
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
tags:
  - attack.t1110
`;
}

function event(eventId: string, sourceIp: string) {
  return {
    event_id: eventId,
    class_uid: 3002,
    category_uid: 3,
    message: "Failed password for root",
    src_endpoint: { ip: sourceIp },
  } as const;
}

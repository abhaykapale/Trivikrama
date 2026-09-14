import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type {
  PageResult,
} from "../../../src/database/repositories/common/repository.types.js";
import type {
  RuleListFilters,
  RuleRecord,
} from "../../../src/database/repositories/rules/rule.repository.js";
import {
  PostgresActiveMatchRuleSource,
  ReloadableOrganizationSigmaRuleEngine,
  type ActiveMatchRuleSourceRecord,
  type IActiveMatchRuleSource,
} from "../../../src/modules/detection/index.js";

const ORG_ID = "be-det-01b-org";

test("PostgreSQL adapter requests every active organization-scoped match page", async () => {
  const records = [databaseRule("Database A", "db-a"), databaseRule("Database B", "db-b")];
  const calls: RuleListFilters[] = [];
  const repository = {
    async list(filters: RuleListFilters = {}): Promise<PageResult<RuleRecord>> {
      calls.push(filters);
      const offset = filters.offset ?? 0;
      return {
        items: records.slice(offset, offset + 1),
        limit: 1,
        offset,
        hasMore: offset + 1 < records.length,
      };
    },
  };

  const loaded = await new PostgresActiveMatchRuleSource(repository, 1)
    .listActiveMatchRules(ORG_ID);

  assert.equal(loaded.length, 2);
  assert.deepEqual(calls, [
    { orgId: ORG_ID, status: "active", type: "match", limit: 1, offset: 0 },
    { orgId: ORG_ID, status: "active", type: "match", limit: 1, offset: 1 },
  ]);
});

test("reloads, class-indexes and evaluates only one organization's active rules", async () => {
  const source = new FakeSource([
    sourceRule("db-low", "Low Priority", "low-priority", 100),
    sourceRule("db-high", "High Priority", "high-priority", 900),
  ]);
  let alertNumber = 0;
  const engine = new ReloadableOrganizationSigmaRuleEngine({
    organizationId: ORG_ID,
    source,
    now: () => new Date("2026-09-14T12:00:00.000Z"),
    generateAlertId: () => `alert-${++alertNumber}`,
    monotonicNow: () => 10,
  });

  await assert.rejects(() => engine.evaluate([matchingEvent()]));
  await engine.reloadRules();
  const result = await engine.evaluate([matchingEvent()]);

  assert.deepEqual(result.alerts.map((alert) => alert.ruleId), ["db-high", "db-low"]);
  assert.deepEqual(
    result.alerts.map((alert) => alert.metadata.sigmaId),
    ["high-priority", "low-priority"],
  );
  assert.equal(result.stats.rulesEvaluated, 2);
  assert.equal(engine.getStats().activeRules, 2);
  assert.equal(source.requestedOrganizations[0], ORG_ID);
});

test("retains the last-known-good compiled rule when an update becomes invalid", async () => {
  const valid = sourceRule("db-rule", "Stable Rule", "stable-rule", 500);
  const source = new FakeSource([valid]);
  const engine = new ReloadableOrganizationSigmaRuleEngine({ organizationId: ORG_ID, source });

  await engine.reloadRules();
  source.records = [{ ...valid, yamlContent: valid.yamlContent.replace("condition: selection", "condition: missing") }];
  await engine.reloadRules();

  const report = engine.getLastReloadReport();
  assert.equal(report?.rejectedRules, 1);
  assert.equal(report?.reusedLastKnownGoodRules, 1);
  assert.equal((await engine.evaluate([matchingEvent()])).alerts.length, 1);
});

test("removes rules that are no longer active in the source", async () => {
  const source = new FakeSource([sourceRule("db-rule", "Removed Rule", "removed-rule", 500)]);
  const engine = new ReloadableOrganizationSigmaRuleEngine({ organizationId: ORG_ID, source });

  await engine.reloadRules();
  source.records = [];
  await engine.reloadRules();

  assert.equal(engine.getLastReloadReport()?.removedRules, 1);
  assert.equal(engine.getStats().activeRules, 0);
  assert.equal((await engine.evaluate([matchingEvent()])).alerts.length, 0);
});

test("does not publish a partial snapshot when the source reload fails", async () => {
  const source = new FakeSource([sourceRule("db-rule", "Available Rule", "available-rule", 500)]);
  const engine = new ReloadableOrganizationSigmaRuleEngine({ organizationId: ORG_ID, source });

  await engine.reloadRules();
  source.failure = new Error("database unavailable");
  await assert.rejects(() => engine.reloadRules(), /database unavailable/u);

  assert.equal(engine.getStats().activeRules, 1);
  assert.equal((await engine.evaluate([matchingEvent()])).alerts.length, 1);
});

test("rejects a source that crosses the organization boundary", async () => {
  const crossing = {
    ...sourceRule("db-crossing", "Crossing Rule", "crossing-rule", 500),
    organizationId: "another-org",
  };
  const engine = new ReloadableOrganizationSigmaRuleEngine({
    organizationId: ORG_ID,
    source: new FakeSource([crossing]),
  });

  await assert.rejects(() => engine.reloadRules(), /organization boundary/u);
  await assert.rejects(() => engine.evaluate([matchingEvent()]), /initial reload/u);
});

class FakeSource implements IActiveMatchRuleSource {
  public requestedOrganizations: string[] = [];
  public failure: Error | undefined;

  public constructor(public records: readonly ActiveMatchRuleSourceRecord[]) {}

  public async listActiveMatchRules(
    organizationId: string,
  ): Promise<readonly ActiveMatchRuleSourceRecord[]> {
    this.requestedOrganizations.push(organizationId);

    if (this.failure !== undefined) {
      throw this.failure;
    }

    return this.records;
  }
}

function sourceRule(
  databaseId: string,
  name: string,
  sigmaId: string,
  priority: number,
): ActiveMatchRuleSourceRecord {
  return {
    databaseId,
    organizationId: ORG_ID,
    name,
    severity: "high",
    weight: 0.8,
    classUid: 3002,
    categoryUid: 3,
    yamlContent: ruleYaml(name, sigmaId, priority),
  };
}

function databaseRule(name: string, suffix: string): RuleRecord {
  return {
    id: randomUUID(),
    name,
    description: null,
    status: "active",
    type: "match",
    severity: "high",
    weight: 0.8,
    yamlContent: ruleYaml(name, suffix, 500),
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
    createdAt: new Date(),
    updatedAt: new Date(),
    orgId: ORG_ID,
  };
}

function ruleYaml(name: string, sigmaId: string, priority: number): string {
  return `
title: ${name}
id: ${sigmaId}
status: active
level: high
weight: 0.8
priority: ${priority}
logsource:
  class_uid: 3002
  category_uid: 3
detection:
  selection:
    message|contains: Failed password
  condition: selection
`;
}

function matchingEvent() {
  return {
    event_id: "event-01b",
    class_uid: 3002,
    category_uid: 3,
    message: "Failed password for root",
  } as const;
}

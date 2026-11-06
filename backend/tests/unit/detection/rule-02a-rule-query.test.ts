import assert from "node:assert/strict";
import test from "node:test";

import { GetRuleDetailUseCase } from "../../../src/modules/detection/application/get-rule-detail.use-case.js";
import { ListRulesUseCase } from "../../../src/modules/detection/application/list-rules.use-case.js";
import type { RuleQueryRecord } from "../../../src/modules/detection/domain/rule-query.contracts.js";

test("RULE-02A list builds pagination and excludes sensitive detail-only fields", async () => {
  const record = ruleRecord();
  const useCase = new ListRulesUseCase({
    async list(input) {
      assert.equal(input.orgId, "org-alpha");
      return { items: [record], total: 26 };
    },
  });

  const result = await useCase.execute({
    orgId: "org-alpha",
    page: 2,
    limit: 25,
    sort: "name",
    order: "asc",
  });

  assert.deepEqual(result.pagination, {
    page: 2,
    limit: 25,
    total: 26,
    totalPages: 2,
    hasNext: false,
    hasPrev: true,
  });
  assert.equal(result.data[0]?.alertsGenerated, 7);
  assert.equal("yamlContent" in result.data[0]!, false);
  assert.equal("compiledHash" in result.data[0]!, false);
  assert.equal("createdBy" in result.data[0]!, false);
});

test("RULE-02A detail returns full Sigma source but never an organization identifier", async () => {
  const record = ruleRecord();
  const useCase = new GetRuleDetailUseCase({
    async findById(input) {
      assert.deepEqual(input, { orgId: "org-alpha", ruleId: record.id });
      return record;
    },
  });

  const detail = await useCase.execute({ orgId: "org-alpha", ruleId: record.id });
  assert.equal(detail?.yamlContent, record.yamlContent);
  assert.deepEqual(detail?.falsePositives, ["Automated test"]);
  assert.equal(detail === null ? true : "orgId" in detail, false);
  assert.equal(detail === null ? true : "alertsGenerated" in detail, false);
});

function ruleRecord(): RuleQueryRecord {
  return {
    id: "00000000-0000-4000-8000-000000000101",
    name: "SSH Brute Force",
    description: "Detects repeated failed logins",
    status: "active",
    type: "count",
    severity: "high",
    weight: 0.8,
    priority: 800,
    classUid: 3002,
    categoryUid: 3,
    tags: ["attack.t1110"],
    falsePositives: ["Automated test"],
    references: ["https://attack.mitre.org/techniques/T1110/"],
    yamlContent: "title: SSH Brute Force\npriority: 800\n",
    compiledHash: "hash",
    isBuiltin: true,
    version: 1,
    createdBy: null,
    updatedBy: null,
    alertsGenerated: 7,
    lastTriggeredAt: new Date("2026-10-22T08:00:00.000Z"),
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-02T00:00:00.000Z"),
  };
}

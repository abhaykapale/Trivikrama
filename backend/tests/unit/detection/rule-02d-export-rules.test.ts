import assert from "node:assert/strict";
import test from "node:test";

import { ExportRulesUseCase } from "../../../src/modules/detection/application/export-rules.use-case.js";
import { RuleExportLimitExceededError } from "../../../src/modules/detection/domain/rule-operational.contracts.js";
import type { RuleQueryRecord } from "../../../src/modules/detection/domain/rule-query.contracts.js";

test("RULE-02D exports tenant/status-filtered YAML in stable paged order", async () => {
  const inputs: unknown[] = [];
  const first = Array.from({ length: 200 }, (_, index) => record(`Rule ${String(index).padStart(3, "0")}`));
  const last = [record("Rule 200")];
  const useCase = new ExportRulesUseCase({
    async list(input) {
      inputs.push(input);
      return { items: input.page === 1 ? first : last, total: 201 };
    },
  }, {
    now: () => new Date("2026-10-26T12:00:00.000Z"),
    monotonicNow: () => 0,
  });

  const result = await useCase.execute({ orgId: "tenant-a", status: "active" });
  assert.equal(result.count, 201);
  assert.equal(result.filename, "rules_export_20261026.yaml");
  assert.equal((result.content.match(/^---$/gmu) ?? []).length, 200);
  assert.deepEqual(inputs, [
    { orgId: "tenant-a", status: "active", page: 1, limit: 200, sort: "name", order: "asc" },
    { orgId: "tenant-a", status: "active", page: 2, limit: 200, sort: "name", order: "asc" },
  ]);
});

test("RULE-02D refuses an unbounded export", async () => {
  const useCase = new ExportRulesUseCase({
    async list() { return { items: [], total: 10_001 }; },
  });
  await assert.rejects(
    () => useCase.execute({ orgId: "tenant-a", status: "active" }),
    RuleExportLimitExceededError,
  );
});

test("RULE-02D terminates safely when a concurrent change makes the reported total stale", async () => {
  let calls = 0;
  const useCase = new ExportRulesUseCase({
    async list() {
      calls += 1;
      return calls === 1
        ? { items: [record("Rule 001")], total: 2 }
        : { items: [], total: 2 };
    },
  });

  const result = await useCase.execute({ orgId: "tenant-a", status: "active" });
  assert.equal(calls, 2);
  assert.equal(result.count, 1);
});

function record(name: string): RuleQueryRecord {
  return {
    id: `id-${name}`,
    name,
    description: null,
    status: "active",
    type: "match",
    severity: "high",
    weight: 0.8,
    priority: 800,
    classUid: 3002,
    categoryUid: null,
    tags: [],
    falsePositives: [],
    references: [],
    yamlContent: `title: ${name}\nid: rule-${name.replaceAll(" ", "-").toLowerCase()}`,
    compiledHash: "a".repeat(64),
    isBuiltin: false,
    version: 1,
    createdBy: null,
    updatedBy: null,
    alertsGenerated: 0,
    lastTriggeredAt: null,
    createdAt: new Date("2026-10-23T00:00:00.000Z"),
    updatedAt: new Date("2026-10-23T00:00:00.000Z"),
  };
}

import assert from "node:assert/strict";
import test from "node:test";
import { ruleDetailSchema, rulePageSchema } from "../src/services/api/rule-schemas";
import { ruleQuery, safeRuleReference } from "../src/utils/rule-query";
const rule = { id: "00000000-0000-4000-8000-000000000101", name: "SSH Brute Force", description: null, status: "active", type: "count", severity: "high", weight: .8, priority: 1, classUid: 3002, categoryUid: 3, tags: ["attack.t1110"], isBuiltin: true, version: 2, createdAt: "2026-11-11T06:00:00.000Z", updatedAt: "2026-11-11T06:00:00.000Z" };
test("FE-04A allowlists tenant-independent rule query parameters", () => {
  assert.deepEqual(ruleQuery(new URLSearchParams("orgId=other&status=active&page=2&isBuiltin=true")), { page: 2, limit: 25, sort: "name", order: "asc", status: "active", isBuiltin: "true" });
  assert.deepEqual(ruleQuery(new URLSearchParams("page=-1&status=deleted&sort=org_id&order=random")), { page: 1, limit: 25, sort: "name", order: "asc" });
});
test("FE-04A list and detail contracts stay distinct and strip private fields", () => {
  const page = rulePageSchema.parse({ data: [{ ...rule, alertsGenerated: 5, lastTriggeredAt: null, yamlContent: "hidden", orgId: "hidden" }], pagination: { page: 1, limit: 25, total: 1, totalPages: 1, hasNext: false, hasPrev: false } });
  assert.equal("yamlContent" in page.data[0]!, false); assert.equal("orgId" in page.data[0]!, false);
  const detail = ruleDetailSchema.parse({ ...rule, yamlContent: "title: SSH Brute Force", compiledHash: null, falsePositives: [], references: [], createdBy: null, updatedBy: null });
  assert.equal(detail.yamlContent, "title: SSH Brute Force");
  assert.equal(ruleDetailSchema.safeParse({ ...detail, weight: 2 }).success, false);
});
test("FE-04A reference links reject executable and credential-bearing URLs", () => {
  assert.equal(safeRuleReference("javascript:alert(1)"), null); assert.equal(safeRuleReference("data:text/html,hi"), null); assert.equal(safeRuleReference("https://user:pass@example.com"), null); assert.equal(safeRuleReference("https://example.com/reference"), "https://example.com/reference");
});

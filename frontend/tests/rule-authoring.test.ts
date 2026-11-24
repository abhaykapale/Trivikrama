import assert from "node:assert/strict";
import test from "node:test";
import { createdRuleSchema, dryRunSchema, validationSchema, yamlByteLength } from "../src/services/api/rule-command-schemas";
test("FE-04B counts UTF-8 bytes rather than characters", () => { assert.equal(yamlByteLength("é".repeat(25601)) > 51200, true); });
test("FE-04B validates compiler preview and creation contracts", () => {
  assert.equal(validationSchema.parse({ valid: true, sigmaId: "r1", name: "Rule", type: "match", severity: "high", compiledHash: "abc", orgId: "discard" }).valid, true);
  assert.equal(createdRuleSchema.safeParse({ id: "invalid", status: "disabled" }).success, false);
});
test("FE-04B bounded dry runs retain real event evidence", () => {
  const result = dryRunSchema.parse({ ruleId: "00000000-0000-4000-8000-000000000101", sigmaId: "r1", ruleName: "Rule", totalEvaluated: 100, matches: 0, matchedEventIds: [], executionTimeMs: 2, sampleMatches: [] });
  assert.equal(result.matches, 0); assert.equal(dryRunSchema.safeParse({ ...result, executionTimeMs: -1 }).success, false);
});

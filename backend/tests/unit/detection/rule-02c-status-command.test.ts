import assert from "node:assert/strict";
import test from "node:test";

import type { RuleRecord } from "../../../src/database/repositories/rules/rule.repository.js";
import { ChangeRuleStatusUseCase } from "../../../src/modules/detection/application/change-rule-status.use-case.js";
import { RuleCommandNotFoundError, RuleStatusConflictError } from "../../../src/modules/detection/domain/rule-command.contracts.js";

const ORG_ID = "rule-02c-org";
const RULE_ID = "11111111-1111-4111-8111-111111111111";

test("RULE-02C atomically disables a tenant rule and signals reload after commit", async () => {
  const events: string[] = [];
  const current = ruleRecord({ status: "active" });
  const updated = ruleRecord({ status: "disabled", updatedAt: new Date("2026-10-26T01:00:00.000Z") });
  const useCase = new ChangeRuleStatusUseCase({
    unitOfWork: {
      async execute(operation) {
        events.push("transaction:start");
        const result = await operation({
          rules: {
            async findByIdForUpdate(id, orgId) {
              assert.equal(id, RULE_ID);
              assert.equal(orgId, ORG_ID);
              return current;
            },
            async findByName() { return null; },
            async updateForOrg(id, orgId, input) {
              events.push("rule:update");
              assert.equal(id, RULE_ID);
              assert.equal(orgId, ORG_ID);
              assert.equal(input.status, "disabled");
              return updated;
            },
          },
          audit: {
            async create(input) {
              events.push("audit:create");
              assert.equal(input.action, "rule_disable");
              assert.equal(input.previousState?.status, "active");
              assert.equal(input.newState?.status, "disabled");
              return {} as never;
            },
          },
        });
        events.push("transaction:commit");
        return result;
      },
    },
    reloadSignals: {
      async publish(signal) {
        events.push("reload:publish");
        assert.equal(signal.operation, "disabled");
        return true;
      },
    },
  }, "disable");

  const result = await useCase.execute(command());
  assert.equal(result.status, "disabled");
  assert.equal(result.reloadSignaled, true);
  assert.deepEqual(events, [
    "transaction:start",
    "rule:update",
    "audit:create",
    "transaction:commit",
    "reload:publish",
  ]);
});

test("RULE-02C treats an already-applied status command as an idempotent no-op", async () => {
  let wrote = false;
  let audited = false;
  let signaled = false;
  const current = ruleRecord({ status: "active" });
  const useCase = new ChangeRuleStatusUseCase({
    unitOfWork: {
      execute: (operation) => operation({
        rules: {
          async findByIdForUpdate() { return current; },
          async findByName() { return null; },
          async updateForOrg() { wrote = true; return current; },
        },
        audit: { async create() { audited = true; return {} as never; } },
      }),
    },
    reloadSignals: { async publish() { signaled = true; return true; } },
  }, "enable");

  const result = await useCase.execute(command());
  assert.equal(result.status, "active");
  assert.equal(result.reloadSignaled, false);
  assert.equal(wrote, false);
  assert.equal(audited, false);
  assert.equal(signaled, false);
});

test("RULE-02C conceals cross-tenant rules and refuses to restore archived rules", async () => {
  const createUseCase = (record: RuleRecord | null) => new ChangeRuleStatusUseCase({
    unitOfWork: {
      execute: (operation) => operation({
        rules: {
          async findByIdForUpdate() { return record; },
          async findByName() { return null; },
          async updateForOrg() { return null; },
        },
        audit: { async create() { return {} as never; } },
      }),
    },
    reloadSignals: { async publish() { return true; } },
  }, "enable");

  await assert.rejects(() => createUseCase(null).execute(command()), RuleCommandNotFoundError);
  await assert.rejects(
    () => createUseCase(ruleRecord({ status: "archived" })).execute(command()),
    RuleStatusConflictError,
  );
});

function command() {
  return {
    orgId: ORG_ID,
    ruleId: RULE_ID,
    actor: {
      id: "550e8400-e29b-41d4-a716-446655440001",
      username: "engineer",
      role: "security_engineer" as const,
      ipAddress: "127.0.0.1",
    },
  };
}

function ruleRecord(overrides: Partial<RuleRecord> = {}): RuleRecord {
  return {
    id: RULE_ID,
    sigmaId: "rule-login-001",
    name: "Suspicious Login",
    description: "Detects suspicious login messages",
    status: "active",
    type: "match",
    severity: "high",
    weight: 0.7,
    yamlContent: "title: Suspicious Login",
    compiledHash: "a".repeat(64),
    classUid: 3002,
    categoryUid: 3,
    tags: ["attack.initial_access"],
    falsePositives: [],
    ruleReferences: [],
    version: 2,
    isBuiltin: false,
    createdBy: null,
    updatedBy: null,
    createdAt: new Date("2026-10-23T00:00:00.000Z"),
    updatedAt: new Date("2026-10-23T00:00:00.000Z"),
    orgId: ORG_ID,
    ...overrides,
  };
}

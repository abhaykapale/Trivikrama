import assert from "node:assert/strict";
import test from "node:test";

import type { RuleRecord } from "../../../src/database/repositories/rules/rule.repository.js";
import { UpdateRuleUseCase } from "../../../src/modules/detection/application/update-rule.use-case.js";
import {
  CannotModifyBuiltinRuleError,
  DuplicateSigmaRuleError,
  RuleIdentityImmutableError,
  RuleStatusConflictError,
} from "../../../src/modules/detection/domain/rule-command.contracts.js";

const ORG_ID = "rule-02c-org";
const RULE_ID = "11111111-1111-4111-8111-111111111111";

test("RULE-02C recompiles and atomically versions a custom rule before reload", async () => {
  const events: string[] = [];
  const current = ruleRecord({ status: "disabled", version: 4 });
  const updated = ruleRecord({ name: "Suspicious Login Updated", status: "disabled", version: 5, updatedAt: new Date("2026-10-26T01:00:00.000Z") });
  const useCase = new UpdateRuleUseCase({
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
              assert.equal(input.version, 5);
              assert.equal(input.status, undefined);
              assert.equal(input.compiledHash?.length, 64);
              return updated;
            },
          },
          audit: {
            async create(input) {
              events.push("audit:create");
              assert.equal(input.action, "rule_update");
              assert.equal(input.details?.version, 5);
              assert.equal(input.previousState?.status, "disabled");
              assert.equal(input.newState?.status, "disabled");
              assert.equal("yamlContent" in (input.newState ?? {}), false);
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
        assert.equal(signal.operation, "updated");
        return true;
      },
    },
  });

  const result = await useCase.execute(command(updateYaml()));
  assert.equal(result.version, 5);
  assert.equal(result.status, "disabled");
  assert.deepEqual(events, [
    "transaction:start",
    "rule:update",
    "audit:create",
    "transaction:commit",
    "reload:publish",
  ]);
});

test("RULE-02C protects built-ins, Sigma identity, archived state, and tenant names", async () => {
  const executeAgainst = async (
    current: RuleRecord,
    yaml = updateYaml(),
    duplicateName: RuleRecord | null = null,
  ) => new UpdateRuleUseCase({
    unitOfWork: {
      execute: (operation) => operation({
        rules: {
          async findByIdForUpdate() { return current; },
          async findByName() { return duplicateName; },
          async updateForOrg() { return current; },
        },
        audit: { async create() { return {} as never; } },
      }),
    },
    reloadSignals: { async publish() { return true; } },
  }).execute(command(yaml));

  await assert.rejects(
    () => executeAgainst(ruleRecord({ isBuiltin: true })),
    CannotModifyBuiltinRuleError,
  );
  await assert.rejects(
    () => executeAgainst(ruleRecord(), updateYaml().replace("rule-login-001", "different-id")),
    RuleIdentityImmutableError,
  );
  await assert.rejects(
    () => executeAgainst(ruleRecord({ status: "archived" })),
    RuleStatusConflictError,
  );
  await assert.rejects(
    () => executeAgainst(ruleRecord(), updateYaml(), ruleRecord({ id: "22222222-2222-4222-8222-222222222222" })),
    (error: unknown) => error instanceof DuplicateSigmaRuleError && error.code === "RULE_NAME_EXISTS",
  );
});

function command(yamlContent: string) {
  return {
    orgId: ORG_ID,
    ruleId: RULE_ID,
    yamlContent,
    actor: {
      id: "550e8400-e29b-41d4-a716-446655440001",
      username: "engineer",
      role: "security_engineer" as const,
      ipAddress: "127.0.0.1",
    },
  };
}

function updateYaml(): string {
  return `title: Suspicious Login Updated
id: rule-login-001
description: Updated detector
status: active
level: high
weight: 0.8
priority: 800
logsource:
  class_uid: 3002
detection:
  selection:
    message|contains: suspicious
  condition: selection
tags:
  - attack.initial_access
`;
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
    yamlContent: updateYaml(),
    compiledHash: "a".repeat(64),
    classUid: 3002,
    categoryUid: null,
    tags: ["attack.initial_access"],
    falsePositives: [],
    ruleReferences: [],
    version: 4,
    isBuiltin: false,
    createdBy: null,
    updatedBy: null,
    createdAt: new Date("2026-10-23T00:00:00.000Z"),
    updatedAt: new Date("2026-10-23T00:00:00.000Z"),
    orgId: ORG_ID,
    ...overrides,
  };
}

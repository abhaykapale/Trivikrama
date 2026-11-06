import assert from "node:assert/strict";
import test from "node:test";

import type { RuleRecord } from "../../../src/database/repositories/rules/rule.repository.js";
import { CreateRuleUseCase } from "../../../src/modules/detection/application/create-rule.use-case.js";
import { validateSigmaRuleYaml } from "../../../src/modules/detection/application/validate-sigma-rule.js";
import { DuplicateSigmaRuleError } from "../../../src/modules/detection/domain/rule-command.contracts.js";
import { RuleRepositoryUniqueConflictError } from "../../../src/modules/detection/domain/rule-command.contracts.js";
import { RuleValidationError } from "../../../src/modules/detection/domain/rule-validation.error.js";

const ORG_ID = "rule-02b-org";

test("RULE-02B validates and compiles supported match and count Sigma rules", () => {
  const match = validateSigmaRuleYaml(matchYaml());
  assert.equal(match.type, "match");
  assert.equal(match.sigmaId, "rule-login-001");
  assert.equal(match.priority, 700);
  assert.equal(match.compiledHash.length, 64);
  assert.deepEqual(match.falsePositives, ["Automated test"]);

  const count = validateSigmaRuleYaml(countYaml());
  assert.equal(count.type, "count");
  assert.equal(count.classUid, 3002);
});

test("RULE-02B rejects unsupported operators, sequence rules, and oversized source", () => {
  assert.throws(
    () => validateSigmaRuleYaml(matchYaml().replace("message|contains", "message|fuzzy")),
    RuleValidationError,
  );
  assert.throws(
    () => validateSigmaRuleYaml(matchYaml().replace("condition: selection", "sequence:\n    timewindow: 5m\n  condition: selection")),
    /sequence rules are not supported/u,
  );
  assert.throws(
    () => validateSigmaRuleYaml(`${matchYaml()}#${"é".repeat(30_000)}`),
    /must not exceed/u,
  );
});

test("RULE-02B atomically creates the tenant rule and immutable audit before signaling reload", async () => {
  const events: string[] = [];
  const created = createdRule();
  const useCase = new CreateRuleUseCase({
    unitOfWork: {
      async execute(operation) {
        events.push("transaction:start");
        const result = await operation({
          rules: {
            async findBySigmaId(sigmaId, orgId) {
              assert.equal(sigmaId, "rule-login-001");
              assert.equal(orgId, ORG_ID);
              return null;
            },
            async findByName(name, orgId) {
              assert.equal(name, "Suspicious Login");
              assert.equal(orgId, ORG_ID);
              return null;
            },
            async create(input) {
              events.push("rule:create");
              assert.equal(input.orgId, ORG_ID);
              assert.equal(input.sigmaId, "rule-login-001");
              assert.equal(input.isBuiltin, false);
              return created;
            },
          },
          audit: {
            async create(input) {
              events.push("audit:create");
              assert.equal(input.action, "rule_create");
              assert.equal(input.orgId, ORG_ID);
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
        assert.equal(signal.organizationId, ORG_ID);
        assert.equal(signal.ruleId, created.id);
        return true;
      },
    },
  });

  const result = await useCase.execute({
    orgId: ORG_ID,
    yamlContent: matchYaml(),
    actor: {
      id: "550e8400-e29b-41d4-a716-446655440001",
      username: "engineer",
      role: "security_engineer",
      ipAddress: "127.0.0.1",
    },
  });

  assert.equal(result.id, created.id);
  assert.equal(result.reloadSignaled, true);
  assert.deepEqual(events, [
    "transaction:start",
    "rule:create",
    "audit:create",
    "transaction:commit",
    "reload:publish",
  ]);
});

test("RULE-02B rejects same-tenant Sigma IDs before inserts or reload signals", async () => {
  let inserted = false;
  let signaled = false;
  const useCase = new CreateRuleUseCase({
    unitOfWork: {
      execute: (operation) => operation({
        rules: {
          async findBySigmaId() { return createdRule(); },
          async findByName() { return null; },
          async create() { inserted = true; return createdRule(); },
        },
        audit: { async create() { return {} as never; } },
      }),
    },
    reloadSignals: { async publish() { signaled = true; return true; } },
  });

  await assert.rejects(
    () => useCase.execute({
      orgId: ORG_ID,
      yamlContent: matchYaml(),
      actor: { id: "actor", username: "engineer", role: "security_engineer", ipAddress: null },
    }),
    (error: unknown) => error instanceof DuplicateSigmaRuleError && error.code === "RULE_ID_EXISTS",
  );
  assert.equal(inserted, false);
  assert.equal(signaled, false);
});

test("RULE-02B maps only its known uniqueness constraints to public conflicts", async () => {
  const executeWithConstraint = async (constraint: string | null) => {
    const useCase = new CreateRuleUseCase({
      unitOfWork: {
        async execute() {
          throw new RuleRepositoryUniqueConflictError(constraint);
        },
      },
      reloadSignals: { async publish() { return true; } },
    });
    return useCase.execute({
      orgId: ORG_ID,
      yamlContent: matchYaml(),
      actor: { id: "actor", username: "engineer", role: "security_engineer", ipAddress: null },
    });
  };

  await assert.rejects(
    () => executeWithConstraint("uq_rules_org_name_ci"),
    (error: unknown) => error instanceof DuplicateSigmaRuleError && error.code === "RULE_NAME_EXISTS",
  );
  await assert.rejects(
    () => executeWithConstraint("uq_rules_org_sigma_id"),
    (error: unknown) => error instanceof DuplicateSigmaRuleError && error.code === "RULE_ID_EXISTS",
  );
  await assert.rejects(
    () => executeWithConstraint("rules_pkey"),
    RuleRepositoryUniqueConflictError,
  );
});

function matchYaml(): string {
  return `title: Suspicious Login
id: rule-login-001
description: Detects suspicious login messages
status: active
level: high
weight: 0.7
priority: 700
logsource:
  class_uid: 3002
  category_uid: 3
detection:
  selection:
    message|contains: "suspicious login"
  condition: selection
tags:
  - attack.initial_access
falsepositives:
  - Automated test
references:
  - https://attack.mitre.org/
`;
}

function countYaml(): string {
  return matchYaml()
    .replace("id: rule-login-001", "id: rule-login-count-001")
    .replace("  condition: selection", "  count:\n    field: src_endpoint.ip\n    threshold: 5\n    timewindow: 5m\n  condition: selection");
}

function createdRule(): RuleRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    sigmaId: "rule-login-001",
    name: "Suspicious Login",
    description: "Detects suspicious login messages",
    status: "active",
    type: "match",
    severity: "high",
    weight: 0.7,
    yamlContent: matchYaml(),
    compiledHash: "a".repeat(64),
    classUid: 3002,
    categoryUid: 3,
    tags: ["attack.initial_access"],
    falsePositives: ["Automated test"],
    ruleReferences: ["https://attack.mitre.org/"],
    version: 1,
    isBuiltin: false,
    createdBy: "550e8400-e29b-41d4-a716-446655440001",
    updatedBy: "550e8400-e29b-41d4-a716-446655440001",
    createdAt: new Date("2026-10-23T00:00:00.000Z"),
    updatedAt: new Date("2026-10-23T00:00:00.000Z"),
    orgId: ORG_ID,
  };
}

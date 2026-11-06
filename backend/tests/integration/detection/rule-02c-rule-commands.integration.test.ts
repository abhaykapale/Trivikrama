import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { closePostgres, createPostgresClient } from "../../../src/database/postgres/client.js";
import { createPostgresRepositories } from "../../../src/database/repositories/postgres-repository.factory.js";
import { createPostgresUnitOfWork } from "../../../src/database/transactions/postgres-unit-of-work.js";
import { ChangeRuleStatusUseCase } from "../../../src/modules/detection/application/change-rule-status.use-case.js";
import { UpdateRuleUseCase } from "../../../src/modules/detection/application/update-rule.use-case.js";
import { DuplicateSigmaRuleError, RuleCommandNotFoundError } from "../../../src/modules/detection/domain/rule-command.contracts.js";
import { PostgresRuleCommandUnitOfWork } from "../../../src/modules/detection/infrastructure/postgres-rule-creation-unit-of-work.js";

test("RULE-02C transactionally updates and toggles a tenant rule with audit history", async (context) => {
  if (process.env.NODE_ENV === "production") throw new Error("RULE-02C integration tests refuse to run in production.");
  const postgres = createPostgresClient({
    connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/trivikrama",
    poolMin: 0,
    poolMax: 2,
  });
  const suffix = randomUUID();
  const orgId = `rule-02c-${suffix}`;
  const otherOrgId = `rule-02c-other-${suffix}`;
  const actorId = randomUUID();
  const ruleId = randomUUID();
  const conflictRuleId = randomUUID();
  const repositories = createPostgresRepositories(postgres);
  const transaction = new PostgresRuleCommandUnitOfWork(createPostgresUnitOfWork(postgres));

  context.after(async () => {
    try {
      // Audit history is immutable. Remove only disposable rule fixtures;
      // retain audit records and their referenced actor.
      await postgres("public.rules").where("org_id", orgId).delete();
    } finally {
      await closePostgres(postgres);
    }
  });

  await postgres("public.users").insert({
    id: actorId,
    username: `rule-editor-${suffix}`,
    email: `rule-editor-${suffix}@example.test`,
    password_hash: "not-a-real-password-hash",
    role: "security_engineer",
    display_name: "RULE-02C Engineer",
    org_id: orgId,
  });
  await postgres("public.rules").insert([
    storedRule(ruleId, orgId, "rule-02c-primary", "Original Rule", actorId),
    storedRule(conflictRuleId, orgId, "rule-02c-conflict", "Conflicting Rule", actorId),
  ]);

  const signals: string[] = [];
  const reloadSignals = {
    async publish(signal: { operation: string }) {
      signals.push(signal.operation);
      return true;
    },
  };
  const actor = {
    id: actorId,
    username: `rule-editor-${suffix}`,
    role: "security_engineer" as const,
    ipAddress: "127.0.0.1",
  };
  const update = new UpdateRuleUseCase({ unitOfWork: transaction, reloadSignals });
  const disable = new ChangeRuleStatusUseCase({ unitOfWork: transaction, reloadSignals }, "disable");
  const enable = new ChangeRuleStatusUseCase({ unitOfWork: transaction, reloadSignals }, "enable");

  const updated = await update.execute({
    orgId,
    ruleId,
    yamlContent: ruleYaml("rule-02c-primary", "Updated Rule"),
    actor,
  });
  assert.equal(updated.version, 2);
  assert.equal(updated.name, "Updated Rule");
  assert.equal((await repositories.rules.findById(ruleId))?.version, 2);

  assert.equal((await disable.execute({ orgId, ruleId, actor })).status, "disabled");
  assert.equal((await enable.execute({ orgId, ruleId, actor })).status, "active");
  assert.deepEqual(signals, ["updated", "disabled", "enabled"]);

  const rollbackDisable = new ChangeRuleStatusUseCase({
    unitOfWork: {
      async execute(operation) {
        return transaction.execute(async (transactionContext) => {
          await operation(transactionContext);
          throw new Error("force rollback after status and audit writes");
        });
      },
    },
    reloadSignals,
  }, "disable");
  await assert.rejects(
    () => rollbackDisable.execute({ orgId, ruleId, actor }),
    /force rollback/u,
  );
  assert.equal((await repositories.rules.findById(ruleId))?.status, "active");
  assert.deepEqual(signals, ["updated", "disabled", "enabled"]);

  const audits = await repositories.audit.list({ orgId, targetId: ruleId, limit: 10 });
  assert.deepEqual(
    audits.items.map((item) => item.action).sort(),
    ["rule_disable", "rule_enable", "rule_update"],
  );

  await assert.rejects(
    () => update.execute({
      orgId,
      ruleId,
      yamlContent: ruleYaml("rule-02c-primary", "Conflicting Rule"),
      actor,
    }),
    (error: unknown) => error instanceof DuplicateSigmaRuleError && error.code === "RULE_NAME_EXISTS",
  );
  assert.equal((await repositories.rules.findById(ruleId))?.version, 2);

  await assert.rejects(
    () => disable.execute({ orgId: otherOrgId, ruleId, actor }),
    RuleCommandNotFoundError,
  );
});

function storedRule(
  id: string,
  orgId: string,
  sigmaId: string,
  name: string,
  actorId: string,
) {
  return {
    id,
    sigma_id: sigmaId,
    name,
    description: "RULE-02C integration fixture",
    status: "active",
    type: "match",
    severity: "high",
    weight: 0.7,
    yaml_content: ruleYaml(sigmaId, name),
    compiled_hash: "a".repeat(64),
    class_uid: 3002,
    category_uid: 3,
    tags: JSON.stringify(["attack.t1110"]),
    false_positives: JSON.stringify([]),
    rule_references: JSON.stringify([]),
    version: 1,
    is_builtin: false,
    created_by: actorId,
    updated_by: actorId,
    org_id: orgId,
  };
}

function ruleYaml(sigmaId: string, title: string): string {
  return `title: ${title}
id: ${sigmaId}
description: RULE-02C PostgreSQL integration fixture
status: active
level: high
weight: 0.8
priority: 800
logsource:
  class_uid: 3002
  category_uid: 3
detection:
  selection:
    message|contains: RULE-02C
  condition: selection
tags:
  - attack.t1110
`;
}

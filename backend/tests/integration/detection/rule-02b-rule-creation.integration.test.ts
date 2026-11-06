import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { closePostgres, createPostgresClient } from "../../../src/database/postgres/client.js";
import { createPostgresRepositories } from "../../../src/database/repositories/postgres-repository.factory.js";
import { createPostgresUnitOfWork } from "../../../src/database/transactions/postgres-unit-of-work.js";
import { CreateRuleUseCase } from "../../../src/modules/detection/application/create-rule.use-case.js";
import { DuplicateSigmaRuleError } from "../../../src/modules/detection/domain/rule-command.contracts.js";
import { PostgresRuleCreationUnitOfWork } from "../../../src/modules/detection/infrastructure/postgres-rule-creation-unit-of-work.js";

test("RULE-02B commits a tenant rule with audit, enforces uniqueness, and rolls back failed transactions", async (context) => {
  if (process.env.NODE_ENV === "production") throw new Error("RULE-02B integration tests refuse to run in production.");
  const postgres = createPostgresClient({
    connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/trivikrama",
    poolMin: 0,
    poolMax: 2,
  });
  const suffix = randomUUID();
  const orgId = `rule-02b-${suffix}`;
  const actorId = randomUUID();
  const repositories = createPostgresRepositories(postgres);
  const transaction = new PostgresRuleCreationUnitOfWork(createPostgresUnitOfWork(postgres));

  context.after(async () => {
    try {
      // Audit records are immutable by design. Remove only the disposable rule;
      // retain the audit record and its referenced actor.
      await postgres("public.rules").where("org_id", orgId).delete();
    } finally {
      await closePostgres(postgres);
    }
  });

  await postgres("public.users").insert({
    id: actorId,
    username: `rule-engineer-${suffix}`,
    email: `rule-engineer-${suffix}@example.test`,
    password_hash: "not-a-real-password-hash",
    role: "security_engineer",
    display_name: "RULE-02B Engineer",
    org_id: orgId,
  });

  const signals: string[] = [];
  const useCase = new CreateRuleUseCase({
    unitOfWork: transaction,
    reloadSignals: {
      async publish(signal) {
        signals.push(signal.ruleId);
        return true;
      },
    },
  });
  const result = await useCase.execute({
    orgId,
    yamlContent: ruleYaml("rule-02b-created", "RULE-02B Created Rule"),
    actor: {
      id: actorId,
      username: `rule-engineer-${suffix}`,
      role: "security_engineer",
      ipAddress: "127.0.0.1",
    },
  });

  const stored = await repositories.rules.findBySigmaId("rule-02b-created", orgId);
  assert.equal(stored?.id, result.id);
  assert.equal(stored?.orgId, orgId);
  assert.equal(stored?.isBuiltin, false);
  assert.deepEqual(signals, [result.id]);
  const audit = await repositories.audit.list({
    orgId,
    action: "rule_create",
    targetId: result.id,
    limit: 10,
  });
  assert.equal(audit.items.length, 1);
  assert.equal(audit.items[0]?.actorId, actorId);
  assert.equal(audit.items[0]?.details.sigmaId, "rule-02b-created");

  await assert.rejects(
    () => useCase.execute({
      orgId,
      yamlContent: ruleYaml("rule-02b-created", "Different Name"),
      actor: { id: actorId, username: "engineer", role: "security_engineer", ipAddress: null },
    }),
    (error: unknown) => error instanceof DuplicateSigmaRuleError && error.code === "RULE_ID_EXISTS",
  );
  assert.equal(signals.length, 1);

  await assert.rejects(
    () => transaction.execute(async ({ rules }) => {
      await rules.create({
        sigmaId: "rule-02b-rollback",
        name: "Rollback Rule",
        status: "active",
        type: "match",
        severity: "low",
        weight: 0.2,
        yamlContent: ruleYaml("rule-02b-rollback", "Rollback Rule"),
        compiledHash: "b".repeat(64),
        classUid: 3002,
        version: 1,
        isBuiltin: false,
        createdBy: actorId,
        updatedBy: actorId,
        orgId,
      });
      throw new Error("force rollback after rule insert");
    }),
    /force rollback/u,
  );
  assert.equal(await repositories.rules.findBySigmaId("rule-02b-rollback", orgId), null);
});

function ruleYaml(sigmaId: string, title: string): string {
  return `title: ${title}
id: ${sigmaId}
description: RULE-02B PostgreSQL integration fixture
status: active
level: high
weight: 0.8
priority: 800
logsource:
  class_uid: 3002
  category_uid: 3
detection:
  selection:
    message|contains: "RULE-02B"
  condition: selection
tags:
  - attack.t1110
`;
}

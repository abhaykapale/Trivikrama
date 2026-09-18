import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  closePostgres,
  createPostgresClient,
  pingPostgres,
} from "../../../src/database/postgres/client.js";
import { PostgresAlertRepository } from "../../../src/database/repositories/alerts/postgres-alert.repository.js";
import { PostgresRuleRepository } from "../../../src/database/repositories/rules/postgres-rule.repository.js";
import {
  PersistRuleAlertsService,
  PostgresActiveMatchRuleSource,
  ReloadableOrganizationSigmaRuleEngine,
} from "../../../src/modules/detection/index.js";

test("persists one PostgreSQL alert across an exact job retry", async (context) => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("BE-DET-01E integration tests refuse to run in production.");
  }

  const suffix = randomUUID();
  const orgId = `be-det-01e-${suffix}`;
  const postgres = createPostgresClient({
    connectionString:
      process.env.TEST_DATABASE_URL ??
      process.env.DATABASE_URL ??
      "postgresql://trivikrama_app:trivikrama_app_password@localhost:5432/trivikrama",
    poolMin: 0,
    poolMax: 2,
    acquireConnectionTimeoutMs: 5_000,
  });
  const rules = new PostgresRuleRepository(postgres);
  const alerts = new PostgresAlertRepository(postgres);

  context.after(async () => {
    try {
      await postgres("public.alerts").where("org_id", orgId).delete();
      await postgres("public.rules").where("org_id", orgId).delete();
    } finally {
      await closePostgres(postgres);
    }
  });

  await pingPostgres(postgres);
  const rule = await rules.create({
    name: "BE-DET-01E Failed Login",
    type: "match",
    severity: "high",
    weight: 0.8,
    yamlContent: matchRuleYaml(`failed-login-${suffix}`),
    classUid: 3002,
    categoryUid: 3,
    orgId,
  });
  const engine = new ReloadableOrganizationSigmaRuleEngine({
    organizationId: orgId,
    source: new PostgresActiveMatchRuleSource(rules),
  });
  await engine.reloadRules();
  const evaluation = await engine.evaluate([{
    event_id: `event-${suffix}`,
    class_uid: 3002,
    category_uid: 3,
    message: "Failed password for root",
  }]);
  const persistence = new PersistRuleAlertsService({ alerts });

  const first = await persistence.execute(orgId, evaluation.alerts);
  const retry = await persistence.execute(orgId, evaluation.alerts);
  const stored = await alerts.list({ orgId });

  assert.equal(evaluation.alerts.length, 1);
  assert.equal(evaluation.alerts[0].ruleId, rule.id);
  assert.deepEqual(
    [first.insertedCount, first.alreadyPresentCount],
    [1, 0],
  );
  assert.deepEqual(
    [retry.insertedCount, retry.alreadyPresentCount],
    [0, 1],
  );
  assert.equal(stored.items.length, 1);
  assert.equal(stored.items[0].id, evaluation.alerts[0].alertId);
  assert.equal(stored.items[0].incidentId, null);
});

function matchRuleYaml(sigmaId: string): string {
  return `
title: BE-DET-01E Failed Login
id: ${sigmaId}
status: active
level: high
weight: 0.8
logsource:
  class_uid: 3002
  category_uid: 3
detection:
  selection:
    message|contains: Failed password
  condition: selection
`;
}

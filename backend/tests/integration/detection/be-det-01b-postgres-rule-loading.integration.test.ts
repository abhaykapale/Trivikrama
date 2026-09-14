import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  closePostgres,
  createPostgresClient,
  pingPostgres,
} from "../../../src/database/postgres/client.js";
import { PostgresRuleRepository } from "../../../src/database/repositories/rules/postgres-rule.repository.js";
import {
  PostgresActiveMatchRuleSource,
  ReloadableOrganizationSigmaRuleEngine,
} from "../../../src/modules/detection/index.js";

test("loads only active PostgreSQL match rules for the bound organization", async (context) => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("BE-DET-01B integration tests refuse to run in production.");
  }

  const suffix = randomUUID();
  const visibleOrg = `be-det-01b-${suffix}`;
  const hiddenOrg = `be-det-01b-hidden-${suffix}`;
  const postgres = createPostgresClient({
    connectionString:
      process.env.TEST_DATABASE_URL ??
      process.env.DATABASE_URL ??
      "postgresql://trivikrama_app:trivikrama_app_password@localhost:5432/trivikrama",
    poolMin: 0,
    poolMax: 2,
    acquireConnectionTimeoutMs: 5_000,
  });
  const repository = new PostgresRuleRepository(postgres);

  context.after(async () => {
    try {
      await postgres("public.rules").whereIn("org_id", [visibleOrg, hiddenOrg]).delete();
    } finally {
      await closePostgres(postgres);
    }
  });

  await pingPostgres(postgres);

  const visible = await repository.create({
    name: "Visible PostgreSQL Rule",
    description: "BE-DET-01B integration rule",
    type: "match",
    severity: "high",
    weight: 0.8,
    yamlContent: ruleYaml("Visible PostgreSQL Rule", `visible-${suffix}`, "active"),
    classUid: 3002,
    categoryUid: 3,
    orgId: visibleOrg,
  });
  await repository.create({
    name: "Hidden PostgreSQL Rule",
    type: "match",
    severity: "high",
    weight: 0.8,
    yamlContent: ruleYaml("Hidden PostgreSQL Rule", `hidden-${suffix}`, "active"),
    classUid: 3002,
    categoryUid: 3,
    orgId: hiddenOrg,
  });
  await repository.create({
    name: "Disabled PostgreSQL Rule",
    status: "disabled",
    type: "match",
    severity: "high",
    weight: 0.8,
    yamlContent: ruleYaml("Disabled PostgreSQL Rule", `disabled-${suffix}`, "disabled"),
    classUid: 3002,
    categoryUid: 3,
    orgId: visibleOrg,
  });

  const engine = new ReloadableOrganizationSigmaRuleEngine({
    organizationId: visibleOrg,
    source: new PostgresActiveMatchRuleSource(repository, 1),
  });
  await engine.reloadRules();
  const result = await engine.evaluate([
    {
      event_id: `event-${suffix}`,
      class_uid: 3002,
      category_uid: 3,
      message: "Failed password for root",
    },
  ]);

  assert.equal(engine.getStats().activeRules, 1);
  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].ruleId, visible.id);
  assert.equal(result.alerts[0].metadata.sigmaId, `visible-${suffix}`);
});

function ruleYaml(
  name: string,
  sigmaId: string,
  status: "active" | "disabled",
): string {
  return `
title: ${name}
id: ${sigmaId}
status: ${status}
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

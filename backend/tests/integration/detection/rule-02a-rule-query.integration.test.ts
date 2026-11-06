import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { closePostgres, createPostgresClient } from "../../../src/database/postgres/client.js";
import { PostgresRuleQueryRepository } from "../../../src/modules/detection/infrastructure/postgres-rule-query.repository.js";

test("RULE-02A performs tenant-safe PostgreSQL listing, filtering, statistics, and detail lookup", async (context) => {
  if (process.env.NODE_ENV === "production") throw new Error("RULE-02A integration tests refuse to run in production.");
  const postgres = createPostgresClient({
    connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/trivikrama",
    poolMin: 0,
    poolMax: 2,
  });
  const suffix = randomUUID();
  const orgId = `rule-02a-${suffix}`;
  const otherOrgId = `rule-02a-other-${suffix}`;
  const visibleId = randomUUID();
  const hiddenId = randomUUID();

  context.after(async () => {
    try {
      await postgres("public.alerts").whereIn("org_id", [orgId, otherOrgId]).delete();
      await postgres("public.rules").whereIn("org_id", [orgId, otherOrgId]).delete();
    } finally {
      await closePostgres(postgres);
    }
  });

  await postgres("public.rules").insert([
    ruleRow(visibleId, orgId, "SSH Brute Force", "high", ["attack.t1110"], 850),
    ruleRow(hiddenId, otherOrgId, "Hidden SSH Rule", "critical", ["attack.t1110"], 999),
  ]);
  const firstTriggeredAt = new Date("2026-10-22T08:00:00.000Z");
  const lastTriggeredAt = new Date("2026-10-22T09:00:00.000Z");
  await postgres("public.alerts").insert([
    alertRow(randomUUID(), visibleId, orgId, firstTriggeredAt),
    alertRow(randomUUID(), visibleId, orgId, lastTriggeredAt),
  ]);

  const repository = new PostgresRuleQueryRepository(postgres);
  const page = await repository.list({
    orgId,
    status: "active",
    type: "count",
    severity: "high",
    search: "attack.t1110",
    tag: "attack.t1110",
    isBuiltin: true,
    page: 1,
    limit: 25,
    sort: "severity",
    order: "desc",
  });
  assert.equal(page.total, 1);
  assert.equal(page.items[0]?.id, visibleId);
  assert.equal(page.items[0]?.priority, 850);
  assert.equal(page.items[0]?.alertsGenerated, 2);
  assert.equal(page.items[0]?.lastTriggeredAt?.toISOString(), lastTriggeredAt.toISOString());

  assert.equal((await repository.findById({ orgId, ruleId: visibleId }))?.yamlContent.includes("priority: 850"), true);
  assert.equal(await repository.findById({ orgId, ruleId: hiddenId }), null);
});

function ruleRow(id: string, orgId: string, name: string, severity: string, tags: string[], priority: number) {
  return {
    id,
    name,
    description: `${name} description`,
    status: "active",
    type: "count",
    severity,
    weight: 0.8,
    yaml_content: `title: ${name}\nid: ${id}\npriority: ${priority}\n`,
    compiled_hash: "a".repeat(64),
    class_uid: 3002,
    category_uid: 3,
    tags: JSON.stringify(tags),
    false_positives: JSON.stringify(["Test activity"]),
    rule_references: JSON.stringify(["https://attack.mitre.org/techniques/T1110/"]),
    version: 1,
    is_builtin: true,
    org_id: orgId,
  };
}

function alertRow(id: string, ruleId: string, orgId: string, createdAt: Date) {
  return {
    id,
    alert_type: "rule",
    rule_id: ruleId,
    rule_name: "SSH Brute Force",
    matched_condition: "selection",
    severity: "high",
    weight: 0.8,
    tags: JSON.stringify(["attack.t1110"]),
    metadata: JSON.stringify({ source: "rule-02a-test" }),
    matched_event_ids: JSON.stringify([]),
    created_at: createdAt,
    org_id: orgId,
  };
}

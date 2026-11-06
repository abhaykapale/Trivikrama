import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { closeMongoDb, connectMongoDb, createMongoDbClient } from "../../../src/database/mongodb/client.js";
import { closePostgres, createPostgresClient } from "../../../src/database/postgres/client.js";
import { createPostgresRepositories } from "../../../src/database/repositories/postgres-repository.factory.js";
import { MongoNormalizedEventRepository } from "../../../src/database/repositories/mongodb/mongo-normalized-event.repository.js";
import type { NormalizedEventDocument } from "../../../src/database/repositories/mongodb/normalized-event.repository.js";
import { createPostgresUnitOfWork } from "../../../src/database/transactions/postgres-unit-of-work.js";
import { ArchiveRuleUseCase } from "../../../src/modules/detection/application/archive-rule.use-case.js";
import { DryRunRuleUseCase } from "../../../src/modules/detection/application/dry-run-rule.use-case.js";
import { ExportRulesUseCase } from "../../../src/modules/detection/application/export-rules.use-case.js";
import { ImportRulesUseCase } from "../../../src/modules/detection/application/import-rules.use-case.js";
import { RuleCommandNotFoundError } from "../../../src/modules/detection/domain/rule-command.contracts.js";
import { MongoRuleDryRunEventRepository } from "../../../src/modules/detection/infrastructure/mongo-rule-dry-run-event.repository.js";
import { PostgresRuleCommandUnitOfWork, PostgresRuleCreationUnitOfWork } from "../../../src/modules/detection/infrastructure/postgres-rule-creation-unit-of-work.js";
import { PostgresRuleQueryRepository } from "../../../src/modules/detection/infrastructure/postgres-rule-query.repository.js";

test("RULE-02D archives, imports, exports, and dry-runs through real tenant stores", async (context) => {
  if (process.env.NODE_ENV === "production") throw new Error("RULE-02D integration tests refuse to run in production.");
  const postgres = createPostgresClient({
    connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/trivikrama",
    poolMin: 0,
    poolMax: 2,
  });
  const mongo = createMongoDbClient();
  await connectMongoDb(mongo, {
    uri: process.env.TEST_MONGODB_URI ?? process.env.MONGODB_URI ?? "mongodb://localhost:27017/trivikrama",
    maxPoolSize: 2,
    serverSelectionTimeoutMs: 5_000,
  });

  const suffix = randomUUID();
  const orgId = `rule-02d-${suffix}`;
  const otherOrgId = `rule-02d-other-${suffix}`;
  const actorId = randomUUID();
  const archiveRuleId = randomUUID();
  const dryRunRuleId = randomUUID();
  const now = new Date();
  const eventsCollection = mongo.db!.collection<NormalizedEventDocument>("normalized_events");

  context.after(async () => {
    try {
      await eventsCollection.deleteMany({
        org_id: { $in: [orgId, otherOrgId] },
      });

      // Audit history is immutable. Remove only disposable rule fixtures;
      // retain audit records and their referenced actor.
      await postgres("public.rules").where("org_id", orgId).delete();
    } finally {
      await Promise.allSettled([
        closeMongoDb(mongo),
        closePostgres(postgres),
      ]);
    }
  });

  await postgres("public.users").insert({
    id: actorId,
    username: `rule-admin-${suffix}`,
    email: `rule-admin-${suffix}@example.test`,
    password_hash: "not-a-real-password-hash",
    role: "admin",
    display_name: "RULE-02D Admin",
    org_id: orgId,
  });
  await postgres("public.rules").insert([
    storedRule(archiveRuleId, orgId, "rule-02d-archive", "Archive Fixture", actorId),
    storedRule(dryRunRuleId, orgId, "rule-02d-dry-run", "Dry Run Fixture", actorId),
  ]);
  await new MongoNormalizedEventRepository(mongo).createManyIfAbsent([
    eventDocument(`event-match-${suffix}`, orgId, now, "RULE-02D suspicious activity"),
    eventDocument(`event-no-match-${suffix}`, orgId, now, "normal activity"),
    eventDocument(`event-other-${suffix}`, otherOrgId, now, "RULE-02D suspicious activity"),
  ]);

  const baseUnit = createPostgresUnitOfWork(postgres);
  const signals: string[] = [];
  const reloadSignals = {
    async publish(signal: { operation: string }) {
      signals.push(signal.operation);
      return true;
    },
  };
  const actor = {
    id: actorId,
    username: `rule-admin-${suffix}`,
    role: "admin" as const,
    ipAddress: "127.0.0.1",
  };

  const archived = await new ArchiveRuleUseCase({
    unitOfWork: new PostgresRuleCommandUnitOfWork(baseUnit),
    reloadSignals,
  }).execute({ orgId, ruleId: archiveRuleId, actor });
  assert.equal(archived.status, "archived");
  assert.equal((await createPostgresRepositories(postgres).rules.findById(archiveRuleId))?.status, "archived");

  const imported = await new ImportRulesUseCase({
    unitOfWork: new PostgresRuleCreationUnitOfWork(baseUnit),
    reloadSignals,
  }).execute({
    orgId,
    yamlContent: ruleYaml("rule-02d-imported", "Imported Fixture"),
    actor,
  });
  assert.equal(imported.imported, 1);
  assert.deepEqual(signals, ["archived", "imported"]);

  const queryRepository = new PostgresRuleQueryRepository(postgres);
  const exported = await new ExportRulesUseCase(queryRepository).execute({ orgId, status: "active" });
  assert.equal(exported.count, 2);
  assert.match(exported.content, /Dry Run Fixture/u);
  assert.match(exported.content, /Imported Fixture/u);
  assert.doesNotMatch(exported.content, /Archive Fixture/u);

  const dryRun = new DryRunRuleUseCase({
    rules: queryRepository,
    events: new MongoRuleDryRunEventRepository(mongo),
    clock: { now: () => new Date(now.getTime() + 1_000), monotonicNow: () => 0 },
  });
  const dryRunResult = await dryRun.execute({
    orgId,
    ruleId: dryRunRuleId,
    timeRangeSeconds: 3_600,
    limit: 100,
  });
  assert.equal(dryRunResult.totalEvaluated, 2);
  assert.equal(dryRunResult.matches, 1);
  assert.deepEqual(dryRunResult.matchedEventIds, [`event-match-${suffix}`]);
  await assert.rejects(
    () => dryRun.execute({ orgId: otherOrgId, ruleId: dryRunRuleId, timeRangeSeconds: 3_600, limit: 100 }),
    RuleCommandNotFoundError,
  );

  const audit = await createPostgresRepositories(postgres).audit.list({ orgId, limit: 20 });
  assert.ok(audit.items.some((item) => item.action === "rule_delete" && item.targetId === archiveRuleId));
  assert.ok(audit.items.some((item) => item.action === "rule_import"));
});

function storedRule(id: string, orgId: string, sigmaId: string, name: string, actorId: string) {
  return {
    id,
    sigma_id: sigmaId,
    name,
    description: "RULE-02D integration fixture",
    status: "active",
    type: "match",
    severity: "high",
    weight: 0.8,
    yaml_content: ruleYaml(sigmaId, name),
    compiled_hash: "a".repeat(64),
    class_uid: 3002,
    category_uid: 3,
    tags: JSON.stringify([]),
    false_positives: JSON.stringify([]),
    rule_references: JSON.stringify([]),
    version: 1,
    is_builtin: false,
    created_by: actorId,
    updated_by: actorId,
    org_id: orgId,
  };
}

function ruleYaml(id: string, title: string): string {
  return `title: ${title}
id: ${id}
description: RULE-02D integration fixture
status: active
level: high
weight: 0.8
logsource:
  class_uid: 3002
  category_uid: 3
detection:
  selection:
    message|contains: RULE-02D
  condition: selection
`;
}

function eventDocument(eventId: string, orgId: string, time: Date, message: string): NormalizedEventDocument {
  return {
    event_id: eventId,
    class_uid: 3002,
    category_uid: 3,
    severity_id: 4,
    time,
    message,
    metadata: { version: "1.1.0" },
    ingestion: {
      batch_id: `batch-${eventId}`,
      collector_id: "collector-rule-02d",
      ingested_at: time,
    },
    org_id: orgId,
  };
}

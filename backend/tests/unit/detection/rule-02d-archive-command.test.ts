import assert from "node:assert/strict";
import test from "node:test";

import type { RuleRecord } from "../../../src/database/repositories/rules/rule.repository.js";
import { ArchiveRuleUseCase } from "../../../src/modules/detection/application/archive-rule.use-case.js";
import { CannotDeleteBuiltinRuleError, RuleCommandNotFoundError } from "../../../src/modules/detection/domain/rule-command.contracts.js";

const ORG_ID = "rule-02d-org";
const RULE_ID = "11111111-1111-4111-8111-111111111111";

test("RULE-02D atomically archives a custom rule before signaling reload", async () => {
  const events: string[] = [];
  const current = ruleRecord();
  const archived = ruleRecord({ status: "archived", updatedAt: new Date("2026-10-26T02:00:00.000Z") });
  const useCase = new ArchiveRuleUseCase({
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
              events.push("rule:archive");
              assert.equal(id, RULE_ID);
              assert.equal(orgId, ORG_ID);
              assert.equal(input.status, "archived");
              return archived;
            },
          },
          audit: {
            async create(input) {
              events.push("audit:create");
              assert.equal(input.action, "rule_delete");
              assert.equal(input.details?.softDelete, true);
              assert.equal(input.previousState?.status, "active");
              assert.equal(input.newState?.status, "archived");
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
        assert.equal(signal.operation, "archived");
        return true;
      },
    },
  });

  const result = await useCase.execute(command());
  assert.equal(result.status, "archived");
  assert.equal(result.reloadSignaled, true);
  assert.deepEqual(events, [
    "transaction:start",
    "rule:archive",
    "audit:create",
    "transaction:commit",
    "reload:publish",
  ]);
});

test("RULE-02D archive is idempotent and protects built-in or cross-tenant rules", async () => {
  let wrote = false;
  let signaled = false;
  const createUseCase = (record: RuleRecord | null) => new ArchiveRuleUseCase({
    unitOfWork: {
      execute: (operation) => operation({
        rules: {
          async findByIdForUpdate() { return record; },
          async findByName() { return null; },
          async updateForOrg() { wrote = true; return record; },
        },
        audit: { async create() { return {} as never; } },
      }),
    },
    reloadSignals: { async publish() { signaled = true; return true; } },
  });

  const idempotent = await createUseCase(ruleRecord({ status: "archived" })).execute(command());
  assert.equal(idempotent.reloadSignaled, false);
  assert.equal(wrote, false);
  assert.equal(signaled, false);
  await assert.rejects(
    () => createUseCase(ruleRecord({ isBuiltin: true })).execute(command()),
    CannotDeleteBuiltinRuleError,
  );
  await assert.rejects(() => createUseCase(null).execute(command()), RuleCommandNotFoundError);
});

function command() {
  return {
    orgId: ORG_ID,
    ruleId: RULE_ID,
    actor: {
      id: "550e8400-e29b-41d4-a716-446655440001",
      username: "admin",
      role: "admin" as const,
      ipAddress: "127.0.0.1",
    },
  };
}

function ruleRecord(overrides: Partial<RuleRecord> = {}): RuleRecord {
  return {
    id: RULE_ID,
    sigmaId: "rule-archive-001",
    name: "Archive Rule",
    description: "Archive fixture",
    status: "active",
    type: "match",
    severity: "high",
    weight: 0.7,
    yamlContent: "title: Archive Rule",
    compiledHash: "a".repeat(64),
    classUid: 3002,
    categoryUid: null,
    tags: [],
    falsePositives: [],
    ruleReferences: [],
    version: 1,
    isBuiltin: false,
    createdBy: null,
    updatedBy: null,
    createdAt: new Date("2026-10-23T00:00:00.000Z"),
    updatedAt: new Date("2026-10-23T00:00:00.000Z"),
    orgId: ORG_ID,
    ...overrides,
  };
}

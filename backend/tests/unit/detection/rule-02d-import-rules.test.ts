import assert from "node:assert/strict";
import test from "node:test";

import type { RuleRecord } from "../../../src/database/repositories/rules/rule.repository.js";
import { ImportRulesUseCase } from "../../../src/modules/detection/application/import-rules.use-case.js";
import { MAX_SIGMA_IMPORT_DOCUMENTS, parseSigmaRuleImport } from "../../../src/modules/detection/application/sigma-rule-import.parser.js";
import { MAX_SIGMA_IMPORT_BYTES } from "../../../src/modules/detection/domain/rule-command.contracts.js";
import { RuleValidationError } from "../../../src/modules/detection/domain/rule-validation.error.js";

const ORG_ID = "rule-02d-org";

test("RULE-02D imports valid documents, skips duplicates, and reports invalid rules", async () => {
  const events: string[] = [];
  const useCase = new ImportRulesUseCase({
    unitOfWork: {
      async execute(operation) {
        return operation({
          rules: {
            async findBySigmaId(sigmaId, orgId) {
              assert.equal(orgId, ORG_ID);
              return sigmaId === "rule-import-duplicate" ? ruleRecord(sigmaId) : null;
            },
            async findByName() { return null; },
            async create(input) {
              events.push(`create:${input.sigmaId}`);
              return ruleRecord(input.sigmaId ?? "missing", { name: input.name });
            },
          },
          audit: {
            async create(input) {
              events.push(`audit:${input.action}`);
              assert.equal(input.action, "rule_import");
              assert.equal("yamlContent" in (input.newState ?? {}), false);
              return {} as never;
            },
          },
        });
      },
    },
    reloadSignals: {
      async publish(signal) {
        events.push(`reload:${signal.operation}`);
        return true;
      },
    },
  });

  const result = await useCase.execute({
    orgId: ORG_ID,
    yamlContent: [
      yaml("rule-import-valid", "Imported Valid"),
      yaml("rule-import-duplicate", "Imported Duplicate"),
      yaml("rule-import-invalid", "Imported Invalid").replace("message|contains", "message|fuzzy"),
    ].join("\n---\n"),
    actor: {
      id: "550e8400-e29b-41d4-a716-446655440001",
      username: "engineer",
      role: "security_engineer",
      ipAddress: null,
    },
  });

  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.reloadSignaled, true);
  assert.deepEqual(result.results.map((item) => item.status), ["imported", "skipped", "failed"]);
  assert.deepEqual(events, [
    "create:rule-import-valid",
    "audit:rule_import",
    "reload:imported",
  ]);
});

test("RULE-02D bounds total import bytes and document count", () => {
  assert.throws(
    () => parseSigmaRuleImport("x".repeat(MAX_SIGMA_IMPORT_BYTES + 1)),
    RuleValidationError,
  );
  assert.throws(
    () => parseSigmaRuleImport(
      Array.from({ length: MAX_SIGMA_IMPORT_DOCUMENTS + 1 }, (_, index) => `title: R${index}`).join("\n---\n"),
    ),
    RuleValidationError,
  );
});

function yaml(id: string, title: string): string {
  return `title: ${title}
id: ${id}
status: active
level: high
weight: 0.8
logsource:
  class_uid: 3002
detection:
  selection:
    message|contains: failed
  condition: selection
`;
}

function ruleRecord(id: string, overrides: Partial<RuleRecord> = {}): RuleRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    sigmaId: id,
    name: "Imported Rule",
    description: null,
    status: "active",
    type: "match",
    severity: "high",
    weight: 0.8,
    yamlContent: yaml(id, "Imported Rule"),
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
    createdAt: new Date("2026-10-26T00:00:00.000Z"),
    updatedAt: new Date("2026-10-26T00:00:00.000Z"),
    orgId: ORG_ID,
    ...overrides,
  };
}

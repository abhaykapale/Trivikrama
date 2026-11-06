import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import type { IUnitOfWork } from "../../../src/database/transactions/transaction.types.js";
import { PostgresRuleCommandUnitOfWork } from "../../../src/modules/detection/infrastructure/postgres-rule-creation-unit-of-work.js";

test("RULE-02C repository commands lock and write through tenant predicates", async () => {
  const source = await readFile(
    resolve(process.cwd(), "src/database/repositories/rules/postgres-rule.repository.ts"),
    "utf8",
  );
  const lockMethod = source.slice(
    source.indexOf("public async findByIdForUpdate"),
    source.indexOf("public async findByName"),
  );
  const updateMethod = source.slice(
    source.indexOf("public async updateForOrg"),
    source.indexOf("private async updateWhere"),
  );
  assert.match(lockMethod, /andWhere\("org_id"/u);
  assert.match(lockMethod, /\.forUpdate\(\)/u);
  assert.match(updateMethod, /org_id:/u);
});

test("RULE-02C command adapter uses the retrying SERIALIZABLE boundary", async () => {
  let options: unknown;
  const base: IUnitOfWork = {
    async execute(operation, receivedOptions) {
      options = receivedOptions;
      return operation({
        repositories: { rules: {} as never, audit: {} as never } as never,
        transaction: {} as never,
        attempt: 1,
      });
    },
  };
  await new PostgresRuleCommandUnitOfWork(base).execute(async (transaction) => {
    assert.ok(transaction.rules);
    assert.ok(transaction.audit);
  });
  assert.deepEqual(options, {
    isolationLevel: "serializable",
    statementTimeoutMs: 10_000,
    lockTimeoutMs: 5_000,
    retry: { maxAttempts: 3, baseDelayMs: 25, maxDelayMs: 200 },
  });
});

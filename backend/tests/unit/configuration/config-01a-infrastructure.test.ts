import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { IUnitOfWork, TransactionOptions } from "../../../src/database/transactions/transaction.types.js";
import { PostgresConfigurationCommandUnitOfWork } from "../../../src/modules/configuration/infrastructure/postgres-configuration-command-unit-of-work.js";

test("CONFIG-01A repository command path uses a row lock and key-scoped update", async () => {
  const source = await readFile("src/database/repositories/configuration/postgres-configuration.repository.ts", "utf8");
  assert.match(source, /findByKeyForUpdate[\s\S]*?\.where\("key"[\s\S]*?\.forUpdate\(\)/u);
  assert.match(source, /updateValue[\s\S]*?\.where\("key"/u);
});

test("CONFIG-01A command adapter requests bounded retrying SERIALIZABLE transactions", async () => {
  let options: TransactionOptions | undefined;
  const fake = { async execute(operation: (context: never) => Promise<unknown>, supplied?: TransactionOptions) { options = supplied; return "ok"; } } as unknown as IUnitOfWork;
  const result = await new PostgresConfigurationCommandUnitOfWork(fake).execute(async () => "ok");
  assert.equal(result, "ok");
  assert.deepEqual(options, { isolationLevel: "serializable", statementTimeoutMs: 10_000, lockTimeoutMs: 5_000, retry: { maxAttempts: 3, baseDelayMs: 25, maxDelayMs: 200 } });
});

test("CONFIG-01A migration and runtime composition are wired", async () => {
  const [migration, app, main] = await Promise.all([
    readFile("migrations/postgres/20261028000200_configuration_query_index.js", "utf8"), readFile("src/app.ts", "utf8"), readFile("src/main.ts", "utf8"),
  ]);
  assert.match(migration, /ON public\.configuration \(key ASC\)[\s\S]*WHERE is_sensitive = FALSE/u);
  assert.ok(app.includes('app.use(`${appConfig.server.apiPrefix}/config`, createConfigurationRouter(configuration));'));
  assert.match(main, /createConfigurationDependencies\(repositories\.configuration, unitOfWork\)/u);
});

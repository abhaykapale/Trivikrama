import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { closePostgres, createPostgresClient } from "../../../src/database/postgres/client.js";
import { createTransactionalPostgresRepositories } from "../../../src/database/repositories/postgres-repository.factory.js";
import type { IUnitOfWork, TransactionContext } from "../../../src/database/transactions/transaction.types.js";
import { createConfigurationDependencies } from "../../../src/modules/configuration/composition/configuration.dependencies.js";

test("CONFIG-01A updates public configuration and immutable audit in one real transaction", async (context) => {
  if (process.env.NODE_ENV === "production") throw new Error("CONFIG-01A integration tests refuse to run in production.");
  const postgres = createPostgresClient({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/trivikrama", poolMin: 0, poolMax: 2 });
  const transaction = await postgres.transaction(); const repositories = createTransactionalPostgresRepositories(transaction);
  const suffix = randomUUID(); const actorId = randomUUID(); const orgId = `config-01a-${suffix}`;
  context.after(async () => { try { await transaction.rollback(); } finally { await closePostgres(postgres); } });
  await transaction("public.users").insert({ id: actorId, username: `config-admin-${suffix}`, email: `config-admin-${suffix}@example.test`, password_hash: "not-real", role: "admin", org_id: orgId });
  await transaction("public.configuration").insert({ key: "ai.anomaly_threshold", value: JSON.stringify(0.65), description: "AI threshold", is_sensitive: false }).onConflict("key").ignore();
  await transaction("public.configuration").insert({ key: `secret.${suffix.replaceAll("-", "")}`, value: JSON.stringify("hidden"), is_sensitive: true });
  const unitOfWork: IUnitOfWork = {
    async execute<TResult>(operation: (context: TransactionContext) => Promise<TResult>): Promise<TResult> {
      return operation({ transaction, repositories, attempt: 1 });
    },
  };
  const dependencies = createConfigurationDependencies(repositories.configuration, unitOfWork);
  const current = await repositories.configuration.findByKey<number>("ai.anomaly_threshold");
  const next = current?.value === 0.77 ? 0.66 : 0.77;
  const updated = await dependencies.updateConfigurationUseCase.execute({ key: "ai.anomaly_threshold", value: next, actor: { id: actorId, username: `config-admin-${suffix}`, role: "admin", ipAddress: "127.0.0.1", orgId } });
  assert.equal(updated?.value, next); assert.equal(updated?.previousValue, current?.value);
  const audits = await repositories.audit.list({ orgId, action: "config_change", targetType: "config", targetId: "ai.anomaly_threshold", limit: 10 });
  assert.equal(audits.items.length, 1); assert.deepEqual(audits.items[0]?.newState, { value: next });
  const listed = await dependencies.listConfigurationUseCase.execute();
  assert.ok(listed.data.some((item) => item.key === "ai.anomaly_threshold"));
  assert.ok(listed.data.every((item) => item.isSensitive === false && !item.key.startsWith("secret.")));
});

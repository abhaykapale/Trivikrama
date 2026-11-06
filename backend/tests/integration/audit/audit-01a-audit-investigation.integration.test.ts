import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createPostgresClient, closePostgres } from "../../../src/database/postgres/client.js";
import { ListAuditLogsUseCase } from "../../../src/modules/audit/application/list-audit-logs.use-case.js";
import { PostgresAuditQueryRepository } from "../../../src/modules/audit/infrastructure/postgres-audit-query.repository.js";

test("AUDIT-01A investigates real immutable audit rows without cross-tenant leakage", async (context) => {
  if (process.env.NODE_ENV === "production") throw new Error("AUDIT-01A integration tests refuse to run in production.");
  const postgres = createPostgresClient({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/trivikrama", poolMin: 0, poolMax: 2 });
  const transaction = await postgres.transaction();
  const now = new Date(); const orgId = `audit-01a-${randomUUID()}`; const otherOrgId = `audit-01a-other-${randomUUID()}`;
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  context.after(async () => { try { await transaction.rollback(); } finally { await closePostgres(postgres); } });
  await transaction("audit.audit_logs").insert([
    { id: ids[0], action: "login", actor_username: "admin", actor_role: "admin", ip_address: "10.0.0.5", details: { userAgent: "integration" }, created_at: new Date(now.getTime() - 60_000), org_id: orgId },
    { id: ids[1], action: "rule_update", actor_username: "engineer", actor_role: "security_engineer", target_type: "rule", target_id: "rule-1", details: { version: 2 }, created_at: new Date(now.getTime() - 30_000), org_id: orgId },
    { id: ids[2], action: "login", actor_username: "foreign", actor_role: "admin", ip_address: "10.0.0.5", details: {}, created_at: new Date(now.getTime() - 10_000), org_id: otherOrgId },
  ]);
  const useCase = new ListAuditLogsUseCase(new PostgresAuditQueryRepository(transaction), { now: () => now });
  const all = await useCase.execute({ orgId, page: 1, limit: 50, sort: "createdAt", order: "desc" });
  assert.equal(all.pagination.total, 2);
  assert.deepEqual(all.data.map((row) => row.action), ["rule_update", "login"]);
  assert.ok(all.data.every((row) => !("orgId" in row) && !("previousState" in row)));
  const filtered = await useCase.execute({ orgId, action: "login", ipAddress: "10.0.0.5", page: 1, limit: 50, sort: "createdAt", order: "desc" });
  assert.equal(filtered.pagination.total, 1);
  assert.equal(filtered.data[0]?.actorUsername, "admin");
});

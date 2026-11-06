import assert from "node:assert/strict";
import test from "node:test";
import type { QueryExecutor } from "../../../src/database/repositories/common/index.js";
import { PostgresAuditQueryRepository } from "../../../src/modules/audit/infrastructure/postgres-audit-query.repository.js";

test("AUDIT-01A PostgreSQL reads are parameterized, tenant/time scoped, and safely projected", async () => {
  const calls: { sql: string; bindings: readonly unknown[] }[] = [];
  const db = { raw(sql: string, bindings: readonly unknown[]) {
    calls.push({ sql, bindings });
    if (sql.includes("COUNT(*)")) return Promise.resolve({ rows: [{ total: "1" }] });
    return Promise.resolve({ rows: [{
      id: "550e8400-e29b-41d4-a716-446655440090", action: "incident_status_change",
      actor_id: "550e8400-e29b-41d4-a716-446655440001", actor_username: "analyst", actor_role: "soc_analyst",
      ip_address: "10.0.0.50", target_type: "incident", target_id: "inc-1", target_name: "Case",
      details: { previousStatus: "open", newStatus: "investigating" }, created_at: "2026-10-28T10:00:00.000Z",
      org_id: "should-not-be-selected", previous_state: { secret: true }, new_state: { secret: true },
    }] });
  } } as unknown as QueryExecutor;
  const result = await new PostgresAuditQueryRepository(db).list({
    orgId: "tenant-a", action: "incident_status_change", actorId: "550e8400-e29b-41d4-a716-446655440001",
    targetType: "incident", targetId: "inc-1", ipAddress: "10.0.0.50",
    from: new Date("2026-10-27T00:00:00.000Z"), to: new Date("2026-10-28T12:00:00.000Z"),
    page: 1, limit: 25, offset: 0, sort: "action", order: "asc",
  });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.match(call.sql, /org_id = \?/u);
    assert.match(call.sql, /created_at >= \?.*created_at <= \?/su);
    assert.doesNotMatch(call.sql, /tenant-a|incident_status_change|10\.0\.0\.50/u);
    assert.equal(call.bindings[0], "tenant-a");
  }
  assert.match(calls[0]!.sql, /ORDER BY action ASC NULLS LAST, created_at DESC, id ASC/u);
  assert.doesNotMatch(calls[0]!.sql, /previous_state|new_state|org_id,/u);
  assert.equal(result.total, 1);
  assert.equal(result.items[0]?.createdAt.toISOString(), "2026-10-28T10:00:00.000Z");
  assert.equal("orgId" in result.items[0]!, false);
  assert.equal("previousState" in result.items[0]!, false);
});

test("AUDIT-01A migration declares tenant-first investigation indexes", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile("migrations/postgres/20261028000100_audit_investigation_indexes.js", "utf8"));
  assert.match(source, /\(org_id, created_at DESC, id ASC\)/u);
  assert.match(source, /\(org_id, action, created_at DESC\)/u);
  assert.match(source, /\(org_id, actor_id, created_at DESC\)/u);
  assert.match(source, /\(org_id, target_type, target_id, created_at DESC\)/u);
  assert.match(source, /\(org_id, ip_address, created_at DESC\)/u);
});

test("AUDIT-01A runtime composition mounts the audit module", async () => {
  const { readFile } = await import("node:fs/promises");
  const [app, main] = await Promise.all([readFile("src/app.ts", "utf8"), readFile("src/main.ts", "utf8")]);
  assert.ok(app.includes('app.use(`${appConfig.server.apiPrefix}/audit`, createAuditQueryRouter(audit));'));
  assert.match(main, /createAuditQueryDependencies\(databaseClients\.postgres\)/u);
  assert.match(main, /audit:\s*\{\s*authentication: authenticationDependencies,\s*\.\.\.auditQueryDependencies/su);
});

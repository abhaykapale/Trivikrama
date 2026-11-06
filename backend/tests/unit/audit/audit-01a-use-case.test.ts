import assert from "node:assert/strict";
import test from "node:test";
import { ListAuditLogsUseCase } from "../../../src/modules/audit/application/list-audit-logs.use-case.js";
import { InvalidAuditTimeRangeError, type AuditRepositoryQuery, type IAuditQueryRepository } from "../../../src/modules/audit/domain/audit-query.contracts.js";

const NOW = new Date("2026-10-28T12:00:00.000Z");

test("AUDIT-01A applies the default 24-hour window and pagination metadata", async () => {
  const calls: AuditRepositoryQuery[] = [];
  const repository: IAuditQueryRepository = {
    async list(input) {
      calls.push(input);
      return { items: [entry()], total: 51 };
    },
  };
  const result = await new ListAuditLogsUseCase(repository, { now: () => NOW }).execute({
    orgId: "tenant-a", page: 2, limit: 25, sort: "createdAt", order: "desc",
  });
  assert.equal(calls[0]?.orgId, "tenant-a");
  assert.equal(calls[0]?.from.toISOString(), "2026-10-27T12:00:00.000Z");
  assert.equal(calls[0]?.to.toISOString(), NOW.toISOString());
  assert.equal(calls[0]?.offset, 25);
  assert.deepEqual(result.pagination, { page: 2, limit: 25, total: 51, totalPages: 3, hasNext: true, hasPrev: true });
});

test("AUDIT-01A uses a to-only query as the end of its default 24-hour window", async () => {
  let query: AuditRepositoryQuery | undefined;
  const repository: IAuditQueryRepository = { async list(input) { query = input; return { items: [], total: 0 }; } };
  await new ListAuditLogsUseCase(repository, { now: () => NOW }).execute({
    orgId: "tenant-a", to: new Date("2026-09-15T10:00:00.000Z"), page: 1, limit: 50, sort: "createdAt", order: "desc",
  });
  assert.equal(query?.from.toISOString(), "2026-09-14T10:00:00.000Z");
  assert.equal(query?.to.toISOString(), "2026-09-15T10:00:00.000Z");
});

test("AUDIT-01A rejects inverted and beyond-retention windows before database access", async () => {
  let calls = 0;
  const repository: IAuditQueryRepository = { async list() { calls += 1; return { items: [], total: 0 }; } };
  const useCase = new ListAuditLogsUseCase(repository, { now: () => NOW });
  await assert.rejects(() => useCase.execute({ orgId: "tenant-a", from: NOW, to: new Date(NOW.getTime() - 1), page: 1, limit: 50, sort: "createdAt", order: "desc" }), InvalidAuditTimeRangeError);
  await assert.rejects(() => useCase.execute({ orgId: "tenant-a", from: new Date("2024-01-01T00:00:00.000Z"), to: NOW, page: 1, limit: 50, sort: "createdAt", order: "desc" }), InvalidAuditTimeRangeError);
  assert.equal(calls, 0);
});

function entry() {
  return { id: "550e8400-e29b-41d4-a716-446655440090", action: "login" as const, actorId: null, actorUsername: "admin", actorRole: "admin" as const, ipAddress: "10.0.0.1", targetType: null, targetId: null, targetName: null, details: {}, createdAt: NOW };
}

import assert from "node:assert/strict";
import test from "node:test";

import type { AssetRecord } from "../../../src/database/repositories/assets/asset.repository.js";
import type { CreateAuditLogInput } from "../../../src/database/repositories/audit/audit.repository.js";
import { CreateAssetUseCase } from "../../../src/modules/assets/application/create-asset.use-case.js";
import { DeactivateAssetUseCase } from "../../../src/modules/assets/application/deactivate-asset.use-case.js";
import { GetAssetUseCase } from "../../../src/modules/assets/application/get-asset.use-case.js";
import { ListAssetsUseCase } from "../../../src/modules/assets/application/list-assets.use-case.js";
import { UpdateAssetUseCase } from "../../../src/modules/assets/application/update-asset.use-case.js";
import type { AssetCommandTransaction, AssetCommandUnitOfWork } from "../../../src/modules/assets/domain/asset.contracts.js";

const ASSET_ID = "550e8400-e29b-41d4-a716-446655440101";
const actor = { id: "user-1", username: "admin", role: "admin" as const, ipAddress: "127.0.0.1" };

test("ASSET-01A lists and reads only through tenant-scoped repository inputs", async () => {
  const listInputs: unknown[] = [];
  const detailInputs: unknown[] = [];
  const repository = {
    async list(input: unknown) { listInputs.push(input); return { items: [record()], limit: 10, offset: 10, hasMore: false }; },
    async count(input: unknown) { listInputs.push(input); return 11; },
    async findByIdForOrg(id: string, orgId: string) { detailInputs.push({ id, orgId }); return record(); },
  };
  const listed = await new ListAssetsUseCase(repository).execute({
    orgId: "tenant-a", assetType: "server", search: "web", isActive: true, page: 2, limit: 10,
  });
  assert.equal(listed.data.length, 1);
  assert.deepEqual(listed.pagination, { page: 2, limit: 10, total: 11, totalPages: 2, hasNext: false, hasPrev: true });
  assert.deepEqual(listInputs, [
    { orgId: "tenant-a", assetType: "server", search: "web", isActive: true, limit: 10, offset: 10 },
    { orgId: "tenant-a", assetType: "server", search: "web", isActive: true, limit: 10, offset: 10 },
  ]);
  const detail = await new GetAssetUseCase(repository).execute({ orgId: "tenant-a", assetId: ASSET_ID });
  assert.equal(detail?.id, ASSET_ID);
  assert.equal("orgId" in (detail ?? {}), false);
  assert.deepEqual(detailInputs, [{ id: ASSET_ID, orgId: "tenant-a" }]);
});

test("ASSET-01A creates an asset and audit record in one transaction", async () => {
  const audit: CreateAuditLogInput[] = [];
  const unit = unitOfWork({
    async create(input) { return record({ ...input, orgId: input.orgId ?? "default" }); },
    async findByIdForUpdate() { return null; },
    async updateForOrg() { return null; },
    async deactivateForOrg() { return null; },
  }, audit);
  const result = await new CreateAssetUseCase(unit).execute({
    orgId: "tenant-a",
    asset: { name: "web-01", assetType: "server", criticality: 0.9, tags: ["production"] },
    actor,
  });
  assert.equal(result.name, "web-01");
  assert.equal(audit[0]?.action, "asset_create");
  assert.equal(audit[0]?.orgId, "tenant-a");
  assert.equal("metadata" in (audit[0]?.newState ?? {}), false);
});

test("ASSET-01A updates and deactivates with row locking, tenant scope, and immutable audit", async () => {
  let current = record();
  const calls: unknown[] = [];
  const audit: CreateAuditLogInput[] = [];
  const assets: AssetCommandTransaction["assets"] = {
    async create() { throw new Error("not used"); },
    async findByIdForUpdate(id, orgId) { calls.push(["lock", id, orgId]); return current; },
    async updateForOrg(id, orgId, changes) {
      calls.push(["update", id, orgId, changes]);
      current = record({ ...current, ...changes, updatedAt: new Date("2026-10-27T02:00:00.000Z") });
      return current;
    },
    async deactivateForOrg(id, orgId) {
      calls.push(["deactivate", id, orgId]);
      current = record({ ...current, isActive: false, updatedAt: new Date("2026-10-27T03:00:00.000Z") });
      return current;
    },
  };
  const unit = unitOfWork(assets, audit);
  const updated = await new UpdateAssetUseCase(unit).execute({
    orgId: "tenant-a", assetId: ASSET_ID, changes: { criticality: 1, tags: ["critical"] }, actor,
  });
  assert.equal(updated?.criticality, 1);
  assert.equal(audit[0]?.action, "asset_update");
  assert.deepEqual(audit[0]?.details?.changedFields, ["criticality", "tags"]);
  const deactivated = await new DeactivateAssetUseCase(unit).execute({ orgId: "tenant-a", assetId: ASSET_ID, actor });
  assert.equal(deactivated?.isActive, false);
  assert.equal(audit[1]?.action, "asset_delete");
  assert.deepEqual(calls.map((call) => (call as unknown[])[0]), ["lock", "update", "lock", "deactivate"]);

  const auditCount = audit.length;
  await new DeactivateAssetUseCase(unit).execute({ orgId: "tenant-a", assetId: ASSET_ID, actor });
  assert.equal(audit.length, auditCount, "idempotent deactivation must not duplicate audit records");
});

test("ASSET-01A conceals cross-tenant command targets", async () => {
  const audit: CreateAuditLogInput[] = [];
  const unit = unitOfWork({
    async create() { throw new Error("not used"); },
    async findByIdForUpdate() { return null; },
    async updateForOrg() { throw new Error("must not update"); },
    async deactivateForOrg() { throw new Error("must not deactivate"); },
  }, audit);
  assert.equal(await new UpdateAssetUseCase(unit).execute({ orgId: "other", assetId: ASSET_ID, changes: { criticality: 1 }, actor }), null);
  assert.equal(await new DeactivateAssetUseCase(unit).execute({ orgId: "other", assetId: ASSET_ID, actor }), null);
  assert.equal(audit.length, 0);
});

function unitOfWork(assets: AssetCommandTransaction["assets"], auditInputs: CreateAuditLogInput[]): AssetCommandUnitOfWork {
  return {
    async execute(operation) {
      return operation({
        assets,
        audit: { async create(input) { auditInputs.push(input); return auditRecord(input); } },
      });
    },
  };
}

function record(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id: ASSET_ID, name: "web-01", assetType: "server", ipAddress: "10.0.0.5", hostname: "web-01",
    criticality: 0.9, owner: "DevOps", department: "Engineering", tags: ["production"], metadata: { os: "linux" },
    isActive: true, createdAt: new Date("2026-10-27T00:00:00.000Z"), updatedAt: new Date("2026-10-27T00:00:00.000Z"),
    orgId: "tenant-a", ...overrides,
  };
}

function auditRecord(input: CreateAuditLogInput) {
  return {
    id: "audit-1", action: input.action, actorId: input.actorId ?? null, actorUsername: input.actorUsername ?? null,
    actorRole: input.actorRole ?? null, ipAddress: input.ipAddress ?? null, targetType: input.targetType ?? null,
    targetId: input.targetId ?? null, targetName: input.targetName ?? null, details: input.details ?? {},
    previousState: input.previousState ?? null, newState: input.newState ?? null,
    createdAt: new Date("2026-10-27T00:00:00.000Z"), orgId: input.orgId ?? "default",
  };
}

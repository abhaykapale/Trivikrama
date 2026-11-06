import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { closePostgres, createPostgresClient } from "../../../src/database/postgres/client.js";
import { createPostgresRepositories } from "../../../src/database/repositories/postgres-repository.factory.js";
import { createPostgresUnitOfWork } from "../../../src/database/transactions/postgres-unit-of-work.js";
import { createAssetDependencies } from "../../../src/modules/assets/composition/asset.dependencies.js";

test("ASSET-01A provides tenant-isolated transactional asset inventory operations", async (context) => {
  if (process.env.NODE_ENV === "production") throw new Error("ASSET-01A integration tests refuse to run in production.");
  const postgres = createPostgresClient({
    connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/trivikrama",
    poolMin: 0,
    poolMax: 2,
  });
  const suffix = randomUUID();
  const orgId = `asset-01a-${suffix}`;
  const otherOrgId = `asset-01a-other-${suffix}`;
  const actorId = randomUUID();
  const repositories = createPostgresRepositories(postgres);

  context.after(async () => {
    try {
      // Audit history is immutable. Remove only disposable asset fixtures;
      // retain audit records and their referenced actor.
      await postgres("public.assets")
        .whereIn("org_id", [orgId, otherOrgId])
        .delete();
    } finally {
      await closePostgres(postgres);
    }
  });

  await postgres("public.users").insert({
    id: actorId,
    username: `asset-admin-${suffix}`,
    email: `asset-admin-${suffix}@example.test`,
    password_hash: "not-a-real-password-hash",
    role: "admin",
    display_name: "ASSET-01A Admin",
    org_id: orgId,
  });
  const foreign = await repositories.assets.create({ name: "foreign-host", assetType: "server", orgId: otherOrgId });
  const dependencies = createAssetDependencies(repositories.assets, createPostgresUnitOfWork(postgres));
  const actor = { id: actorId, username: `asset-admin-${suffix}`, role: "admin" as const, ipAddress: "127.0.0.1" };

  const created = await dependencies.createAssetUseCase.execute({
    orgId,
    asset: {
      name: "web-server-01",
      assetType: "server",
      ipAddress: "10.0.0.5",
      hostname: "web-server-01",
      criticality: 0.9,
      owner: "DevOps",
      department: "Engineering",
      tags: ["production", "web"],
      metadata: { os: "linux" },
    },
    actor,
  });
  assert.equal(created.isActive, true);

  const listed = await dependencies.listAssetsUseCase.execute({ orgId, assetType: "server", search: "10.0.0.5", isActive: true, page: 1, limit: 25 });
  assert.equal(listed.pagination.total, 1);
  assert.equal(listed.data[0]?.id, created.id);
  assert.equal(await dependencies.getAssetUseCase.execute({ orgId, assetId: foreign.id }), null);

  const updated = await dependencies.updateAssetUseCase.execute({ orgId, assetId: created.id, changes: { criticality: 1, tags: ["critical"] }, actor });
  assert.equal(updated?.criticality, 1);
  assert.deepEqual(updated?.tags, ["critical"]);
  assert.equal(await dependencies.updateAssetUseCase.execute({ orgId, assetId: foreign.id, changes: { criticality: 1 }, actor }), null);

  const deactivated = await dependencies.deactivateAssetUseCase.execute({ orgId, assetId: created.id, actor });
  assert.equal(deactivated?.isActive, false);
  const auditBeforeReplay = await repositories.audit.list({ orgId, targetType: "asset", targetId: created.id, limit: 20 });
  await dependencies.deactivateAssetUseCase.execute({ orgId, assetId: created.id, actor });
  const auditAfterReplay = await repositories.audit.list({ orgId, targetType: "asset", targetId: created.id, limit: 20 });
  assert.equal(auditAfterReplay.items.length, auditBeforeReplay.items.length);
  assert.deepEqual(new Set(auditAfterReplay.items.map((item) => item.action)), new Set(["asset_create", "asset_update", "asset_delete"]));
});

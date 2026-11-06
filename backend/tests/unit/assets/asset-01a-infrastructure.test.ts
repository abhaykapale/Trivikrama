import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("ASSET-01A repository enforces tenant predicates for detail and mutations", async () => {
  const source = await readFile(resolve(process.cwd(), "src/database/repositories/assets/postgres-asset.repository.ts"), "utf8");
  for (const method of ["findByIdForOrg", "findByIdForUpdate", "updateForOrg", "deactivateForOrg"]) {
    assert.match(source, new RegExp(`public async ${method}\\b`, "u"));
  }
  assert.match(source, /andWhere\("org_id", ensureNonBlank\(orgId, "orgId"\)\)/u);
  assert.match(source, /\.forUpdate\(\)/u);
  assert.match(source, /ip_address::text ILIKE \?/u);
});

test("ASSET-01A migration and runtime composition are wired", async () => {
  const migration = await readFile(resolve(process.cwd(), "migrations/postgres/20261027000100_asset_inventory_audit_and_indexes.js"), "utf8");
  assert.match(migration, /asset_create/u);
  assert.match(migration, /asset_update/u);
  assert.match(migration, /asset_delete/u);
  assert.match(migration, /idx_assets_org_active_criticality_name/u);

  const app = await readFile(resolve(process.cwd(), "src/app.ts"), "utf8");
  const main = await readFile(resolve(process.cwd(), "src/main.ts"), "utf8");
  assert.match(app, /\/assets/u);
  assert.match(main, /createAssetDependencies/u);
});

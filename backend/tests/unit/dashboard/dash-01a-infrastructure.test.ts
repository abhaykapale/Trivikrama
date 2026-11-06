import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("DASH-01A PostgreSQL aggregations are tenant/time bounded and parameterized", async () => {
  const source = await readFile(resolve(process.cwd(), "src/modules/dashboard/infrastructure/postgres-dashboard.repository.ts"), "utf8");
  assert.match(source, /WHERE org_id = \?/u);
  assert.match(source, /created_at >= \?/u);
  assert.match(source, /created_at < \?/u);
  assert.match(source, /PERCENTILE_CONT\(0\.5\)/u);
  assert.doesNotMatch(source, /\$\{orgId\}|\$\{input\./u);
});

test("DASH-01A MongoDB aggregations require tenant/time filters and bounded source groups", async () => {
  const source = await readFile(resolve(process.cwd(), "src/modules/dashboard/infrastructure/mongo-dashboard-event.repository.ts"), "utf8");
  assert.match(source, /org_id: requireOrgId\(orgId\)/u);
  assert.match(source, /time: \{ \$gte: window\.from, \$lt: window\.to \}/u);
  assert.match(source, /\{ \$limit: 100 \}/u);
  assert.match(source, /ingestion\.collector_id/u);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("RULE-02A migration declares tenant-first rule and alert-statistic indexes", async () => {
  const source = await readFile(
    resolve(
      process.cwd(),
      "migrations/postgres/20261022000100_rule_02a_query_indexes.js",
    ),
    "utf8",
  );
  assert.match(source, /rules \(org_id, name ASC, id ASC\)/u);
  assert.match(source, /rules \(org_id, status, type, severity, is_builtin\)/u);
  assert.match(source, /rules USING gin \(tags\)/u);
  assert.match(source, /alerts \(org_id, rule_id, created_at DESC\)/u);
});

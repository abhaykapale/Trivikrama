import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { seedBuiltinRules, SSH_BRUTE_FORCE_RULE_YAML } from "../../../src/database/seeds/builtin-rules.seed.js";
import type { SeedContext } from "../../../src/database/seeds/seed.types.js";
import { compileSigmaCountRuleYaml } from "../../../src/modules/detection/index.js";

const migration = require("../../../migrations/postgres/20261029000100_sys_01a_collector_builtin_rule.js");
const RULE_ID = "00000000-0000-4000-8000-000000000101";
const LEGACY_YAML = SSH_BRUTE_FORCE_RULE_YAML.replace(
  '    status_id: 2\n    message|startswith: "Failed login for "',
  '    message|contains: "Failed password"',
);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

test("built-in upgrade is tenant-scoped, audited, hash-consistent, and idempotent", async () => {
  const db = fakeDatabase([legacyRule(), legacyRule({ id: "operator-rule", org_id: "other-tenant" })]);
  assert.equal(migration.config.transaction, true, "update and immutable audit must be atomic");
  await migration.up(db.knex);
  const upgraded = db.rules[0];
  assert.equal(upgraded.yaml_content, SSH_BRUTE_FORCE_RULE_YAML);
  assert.equal(upgraded.compiled_hash, compileSigmaCountRuleYaml(SSH_BRUTE_FORCE_RULE_YAML).compiledHash);
  assert.equal(upgraded.version, 2);
  assert.equal(upgraded.org_id, "tenant-blue");
  assert.equal(upgraded.is_builtin, true);
  assert.equal(upgraded.status, "disabled", "preserve operator activation choice");
  assert.equal(db.rules[1].yaml_content, LEGACY_YAML);
  assert.equal(db.audits.length, 1);
  assert.equal(db.audits[0].action, "rule_update");
  assert.equal(db.audits[0].org_id, "tenant-blue");
  assert.equal(db.audits[0].target_id, RULE_ID);
  assert.equal(db.audits[0].previous_state.version, 1);
  assert.equal(db.audits[0].new_state.version, 2);
  assert.equal(db.audits[0].previous_state.yaml_content, LEGACY_YAML);
  await migration.up(db.knex);
  assert.equal(db.audits.length, 1);
  assert.equal(upgraded.version, 2);
});

for (const [name, changes] of [
  ["custom rule", { is_builtin: false }],
  ["same name with another ID", { id: "operator-rule" }],
  ["another name", { name: "Operator detection" }],
  ["operator-edited YAML", { yaml_content: `${LEGACY_YAML}\n# operator change` }],
  ["changed compiled hash", { compiled_hash: "operator-hash" }],
  ["newer revision", { version: 3 }],
  ["another rule type", { type: "match" }],
] as const) {
  test(`built-in upgrade preserves ${name}`, async () => {
    const row = legacyRule(changes);
    const before = structuredClone(row);
    const db = fakeDatabase([row]);
    await migration.up(db.knex);
    assert.deepEqual(db.rules, [before]);
    assert.equal(db.audits.length, 0);
  });
}

test("built-in upgrade does nothing before a fresh installation is seeded", async () => {
  const db = fakeDatabase([]);
  await migration.up(db.knex);
  assert.equal(db.audits.length, 0);
});

test("fresh core seeds publish version two and preserve it on rerun", async () => {
  let stored: Record<string, any> | undefined;
  const audits: Record<string, any>[] = [];
  const trx = (table: string) => {
    const query = {
      select() { return query; },
      where() { return query; },
      andWhere() { return query; },
      orderBy() { return query; },
      async first() { return table === "public.rules" ? stored : undefined; },
      async insert(row: Record<string, any>) {
        if (table === "public.rules") stored = structuredClone(row);
        else if (table === "audit.audit_logs") audits.push(row);
        else throw new Error(`Unexpected seed table ${table}`);
      },
    };
    return query;
  };
  const context = { trx, initialAdmin: { orgId: "tenant-blue" } } as unknown as SeedContext;
  assert.equal((await seedBuiltinRules(context)).inserted, 1);
  assert.equal(stored?.version, 2);
  assert.equal(stored?.is_builtin, true);
  assert.equal(stored?.yaml_content, SSH_BRUTE_FORCE_RULE_YAML);
  assert.equal(stored?.compiled_hash, hash(SSH_BRUTE_FORCE_RULE_YAML));
  assert.equal(stored?.org_id, "tenant-blue");
  assert.equal(audits[0].new_state.version, 2);
  assert.equal((await seedBuiltinRules(context)).skipped, 1);
  assert.equal(audits.length, 1);
});

function legacyRule(changes: Record<string, unknown> = {}) {
  return { id: RULE_ID, name: "SSH Brute Force", is_builtin: true,
    org_id: "tenant-blue", yaml_content: LEGACY_YAML, compiled_hash: hash(LEGACY_YAML),
    version: 1, type: "count", class_uid: 3002, category_uid: 3, status: "disabled", ...changes };
}

function fakeDatabase(rules: Record<string, any>[]) {
  const audits: Record<string, any>[] = [];
  const knex = (table: string) => {
    let filter: Record<string, unknown> = {};
    const matches = (row: Record<string, unknown>) => Object.entries(filter)
      .every(([key, value]) => row[key] === value);
    const query = {
      where(value: Record<string, unknown>) { filter = value; return query; },
      forUpdate() { return query; },
      async first() { return structuredClone(rules.find(matches)); },
      async update(changes: Record<string, unknown>) {
        assert.equal(table, "public.rules");
        assert.equal(filter.org_id, "tenant-blue", "write must retain tenant isolation");
        const rows = rules.filter(matches);
        rows.forEach((row) => Object.assign(row, changes));
        return rows.length;
      },
      async insert(audit: Record<string, unknown>) {
        assert.equal(table, "audit.audit_logs");
        audits.push(audit);
      },
    };
    return query;
  };
  return { knex, rules, audits };
}

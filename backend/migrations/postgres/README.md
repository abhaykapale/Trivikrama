# PostgreSQL Migrations

Only `.js` files in this directory are executable migrations.

The migration runner uses:

```ts
loadExtensions: [".js"]
```

## Format

This backend package is configured as CommonJS:

```json
{
  "type": "commonjs"
}
```

Therefore PostgreSQL migration files must use CommonJS exports:

```js
async function up(knex) {
  // migration body
}

async function down(knex) {
  // rollback body
}

const config = {
  transaction: true,
};

module.exports = { up, down, config };
```

Do not use ESM migration exports such as `export async function up(...)`.
That style may work through `tsx` in development, but it fails when production
runs compiled code with `node dist/scripts/migrate.js`.

## Migration history rules

- Do not rename an applied migration file.
- Do not edit an applied migration to change its schema behavior.
- If a schema fix is needed, create a new corrective migration.
- Keep migrations idempotent where practical when they repair historical state.
- Run migrations on a clean database before marking a database milestone complete.

Migrations that use `CREATE INDEX CONCURRENTLY` must export
`config = { transaction: false }`. INC-02A uses this form for tenant-scoped
incident list/sort indexes and trigram search indexes.
INC-02D also uses this form for the incident-entity GIN index and partial,
tenant-aware active-asset lookup indexes.

PostgreSQL enum-value additions are forward-only. INC-03D adds
`incident_resolve` to `public.audit_action`; its `down` migration intentionally
does not rebuild the enum because doing so could invalidate immutable audit
history.

`20261029000100_sys_01a_collector_builtin_rule.js` upgrades only the unchanged
version-1 built-in SSH count rule (`00000000-0000-4000-8000-000000000101`).
It requires the exact historical YAML/hash and built-in identity, locks the
row, retains its tenant and activation status, and atomically writes version 2,
the corrected YAML/hash, and an immutable tenant-scoped `rule_update` audit.
Custom rules and operator-modified revisions are preserved. Reruns are no-ops;
fresh installs receive the corrected version from the core seed. This data
correction is forward-only. Restart the ingestion processing worker after
migration so its in-memory rule cache reloads; changed hashes also isolate new
Redis count/cooldown state from the old rule.

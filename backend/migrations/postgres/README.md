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

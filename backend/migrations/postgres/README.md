# PostgreSQL Migrations

Only `.js` files in this directory are executable migrations.

The migration runner uses:

```ts
loadExtensions: [".js"]

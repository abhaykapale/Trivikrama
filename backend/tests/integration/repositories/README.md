# DB-09 Repository Integration Tests

These tests exercise the DB-07/DB-08 repository and unit-of-work layer against real PostgreSQL and MongoDB instances.

They are intentionally opt-in because they write and clean deterministic test rows in a migrated development/test database.

## Safety controls

- Tests refuse to run when `NODE_ENV=production`.
- Tests require `ALLOW_DB09_INTEGRATION_TESTS=true`.
- PostgreSQL cleanup is scoped to `org_id = 'db09-test'`, `test.db09.*` configuration keys, and `db09-test-*` queue/event identifiers.
- MongoDB cleanup is scoped to `org_id = 'db09-test'`.
- Audit rows are append-only by design and are not deleted because `audit.audit_logs` is immutable.

## Required environment

Use dedicated test database URLs when possible:

```powershell
$env:ALLOW_DB09_INTEGRATION_TESTS="true"
$env:TEST_DATABASE_URL=$env:DATABASE_URL
$env:TEST_MONGODB_URI=$env:MONGODB_URI
```

Then run:

```powershell
npx tsx tests/integration/repositories/run-repository-integration-tests.ts
```

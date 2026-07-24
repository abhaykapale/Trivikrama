# Database Migrations

Migration execution order:

1. 001_initial_schema.sql
2. 002_indexes.sql
3. 003_triggers.sql

Rules:

- Never modify an executed migration.
- Every schema change gets a new migration file.
- Migrations must be idempotent whenever possible.

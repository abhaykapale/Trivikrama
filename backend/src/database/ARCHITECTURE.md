# Database Architecture

The database layer is the infrastructure boundary that owns client lifecycle, repository factories, transaction boundaries, and availability checks for Postgres, MongoDB, and Redis. It is consumed by the application modules but intentionally kept behind repository and unit-of-work abstractions.

## Responsibility

- Create and validate database clients for Postgres, MongoDB, and Redis.
- Expose repository factories for relational and Mongo collections.
- Provide a PostgreSQL `IUnitOfWork` implementation for multi-step operations.
- Support maintenance, verification, and bootstrap scripts for operational readiness.
- Persist ordered Collector heartbeat state and atomically expire stale Collectors.

## Boundary Map

```mermaid
flowchart TD
    INDEX["database/index.ts"]
    POSTGRES["database/postgres/"]
    MONGO["database/mongodb/"]
    REDIS["database/redis/"]
    REPOS["database/repositories/"]
    TX["database/transactions/"]
    VERIFY["database/verification/"]
    MAINT["database/maintenance/"]
    SEEDS["database/seeds/"]
    HEALTH["database/health.ts"]

    INDEX --> POSTGRES
    INDEX --> MONGO
    INDEX --> REDIS
    INDEX --> REPOS
    INDEX --> TX
    INDEX --> VERIFY
    INDEX --> MAINT
    INDEX --> SEEDS
    INDEX --> HEALTH

    REPOS --> POSTGRES
    REPOS --> MONGO
    TX --> POSTGRES
```

## Startup and Shutdown Flow

```mermaid
flowchart TD
    START["initializeDatabases(config)"]
    CREATE["createPostgresClient(), createMongoDbClient(), createRedisClient()"]
    CHECK["Promise.allSettled() with ping/connect checks"]
    OK{"all clients ready?"}
    FAIL["closeDatabases() + throw Database startup failed"]
    READY["return DatabaseClients"]
    SHUTDOWN["closeDatabases(clients)"]

    START --> CREATE --> CHECK --> OK
    OK -->|no| FAIL
    OK -->|yes| READY
    READY --> SHUTDOWN
```

## Runtime Sequence

```mermaid
sequenceDiagram
    participant Main as main.ts
    participant DB as database/index.ts
    participant PG as Postgres client
    participant MG as MongoDB client
    participant RD as Redis client
    participant Repo as createPostgresRepositories()
    participant UOW as createPostgresUnitOfWork()

    Main->>DB: initializeDatabases({ postgres, mongodb, redis })
    DB->>PG: create and ping
    DB->>MG: create and connect
    DB->>RD: create and connect
    alt startup OK
        DB-->>Main: DatabaseClients
        Main->>Repo: build relational repositories
        Main->>UOW: build transactional wrapper
    else startup fails
        DB->>PG: close
        DB->>MG: close
        DB->>RD: close
        DB-->>Main: throw startup error
    end
```

## Dependency Injection and Consumption

The database layer is created in the backend composition root and then injected as shared infrastructure into feature modules.

```mermaid
flowchart TD
    MAIN["main.ts"]
    CLIENTS["DatabaseClients"]
    REPOS["createPostgresRepositories(databaseClients.postgres)"]
    UOW["createPostgresUnitOfWork(databaseClients.postgres)"]
    AUTH["createAuthApplicationDependencies({ knex, repositories, unitOfWork })"]
    USERS["createUserManagementDependencies({ userRepository, passwordHasher, unitOfWork })"]
    HEALTH["new HealthService(databaseClients)"]

    MAIN --> CLIENTS
    CLIENTS --> REPOS
    CLIENTS --> UOW
    REPOS --> AUTH
    UOW --> AUTH
    REPOS --> USERS
    UOW --> USERS
    CLIENTS --> HEALTH
```

## Concrete Data Stores

- Postgres is the primary relational store for users, sessions, audit records, roles, incidents, configuration, and queue metrics.
- MongoDB is used for event-style or document-oriented storage.
- Redis is used for rate limiting, queueing, and cache-like short-lived data.
- Higher-level modules depend on repository abstractions and the unit-of-work contract instead of directly constructing raw database clients.

## Collector Heartbeat Persistence

`PostgresCollectorStatusRepository.upsertHeartbeat()` prevents an older `last_heartbeat_at` from overwriting newer state at the database conflict boundary. Fields omitted by a heartbeat, such as `files_processed`, retain their existing values. `markStaleOffline()` atomically changes only stale `online` and `degraded` rows to `offline`, with optional organization scoping, so concurrent fresh writes remain protected by their timestamps.

## Important Components

- [`index.ts`](./index.ts): bootstrap, startup verification, and shutdown orchestration.
- [`postgres/`](./postgres): Postgres client configuration and health checks.
- [`mongodb/`](./mongodb): MongoDB client bootstrap and helpers.
- [`redis/`](./redis): Redis client and verification helpers.
- [`repositories/`](./repositories): repository abstractions and Postgres/Mongo adapters.
- [`transactions/`](./transactions): `PostgresUnitOfWork` and transaction primitives.
- [`verification/`](./verification): database readiness checks used during startup.
- [`maintenance/`](./maintenance): maintenance tasks for Postgres operations.
- [`seeds/`](./seeds): baseline and development data seeding. Development
  seeding commits the PostgreSQL transaction first and then idempotently
  reconciles the matching MongoDB normalized events and AI results. A rerun
  safely repairs a partial cross-store seed, and status reports whether all
  deterministic MongoDB demo records are present.
- [`health.ts`](./health.ts): aggregated health summary for database services.

## Incident query indexes

INC-02A adds concurrent PostgreSQL indexes that begin with `org_id` for each
allowlisted incident-list sort, plus GIN trigram indexes for title,
description, and primary-entity search. The incident query adapter always
combines these paths with a trusted organization predicate. The migration is
non-transactional only because PostgreSQL requires that for
`CREATE INDEX CONCURRENTLY`.

INC-02D adds a GIN `jsonb_path_ops` index for exact incident-entity containment
and partial active-asset indexes prefixed by `org_id` for IP address and
case-insensitive hostname/name matching. Its migration is likewise
non-transactional because every index is created concurrently.

## Sigma rule query indexes

RULE-02A adds tenant-first B-tree indexes for stable rule-name and updated-time
pagination, a composite organization/filter index, a GIN index for exact tag
containment, and an organization/rule/time index for alert statistics. These
support `PostgresRuleQueryRepository` without weakening its mandatory
`org_id` predicates.

RULE-02B adds `rules.sigma_id`, backfills recognizable existing YAML IDs, and
enforces tenant-unique Sigma identities plus case-insensitive tenant-unique
rule names. Custom creation persists the rule row and immutable audit row in
one retrying SERIALIZABLE transaction.

RULE-02C adds tenant-scoped command repository methods rather than new schema.
`findByIdForUpdate(id, orgId)` locks only a rule visible to the trusted tenant,
and `updateForOrg(id, orgId, patch)` repeats the tenant predicate on the write.
Rule content/version updates and enable/disable status changes commit with
their immutable audit records in retrying SERIALIZABLE transactions.

RULE-02D reuses the same locked tenant mutation boundary for soft archive and
the same creation boundary for each imported document. No schema migration is
required: `archived`, `rule_delete`, and `rule_import` already exist in the
status/action enums. Historical dry-run reads MongoDB through an explicit
tenant, OCSF class/category, time-range, and limit filter; export pages
PostgreSQL with mandatory organization and status predicates.

## Asset inventory boundaries

ASSET-01A adds explicit tenant-scoped asset detail, row-lock, update, and
deactivation methods. The command unit of work atomically persists each asset
mutation with its immutable audit event. Migration
`20261027000100_asset_inventory_audit_and_indexes.js` adds the three asset
audit actions and a tenant/active/criticality/name index for stable inventory
listing. Asset search includes name, hostname, and textual IP representation.

## Dashboard analytics indexes

DASH-01A uses the existing MongoDB `org_id`/`time` normalized-event indexes and
adds PostgreSQL tenant/time indexes for alerts, incident status/severity
aggregation, and affected-entity grouping. Migration
`20261027000200_dashboard_analytics_indexes.js` creates these indexes
concurrently to avoid blocking operational writes.

## Audit investigation indexes

AUDIT-01A preserves the existing insert/select-only audit boundary and adds no
mutation path. Migration `20261028000100_audit_investigation_indexes.js` adds
tenant-first parent indexes for time, action, actor, target, and IP queries so
the partitioned audit trail can be investigated without cross-tenant scans.
The API projection omits organization and internal before/after state columns.

## Configuration management boundary

CONFIG-01A keeps `public.configuration` global, matching its schema, and never
exposes rows marked sensitive. `findByKeyForUpdate()` takes a key-scoped row
lock inside a retrying SERIALIZABLE transaction; `updateValue()` repeats the
key predicate. A real value change and its immutable `config_change` audit row
commit or roll back together. Migration
`20261028000200_configuration_query_index.js` adds a partial key index for the
bounded non-sensitive list path.

## Real-time subscription boundary

WS-01A duplicates the shared Redis client into a dedicated subscriber because
Redis subscriber mode cannot serve ordinary commands. It subscribes to three
exact incident channels and closes before the shared database clients. The
transactional incident outbox remains the source of published payloads;
WebSocket delivery is an ephemeral, tenant-filtered projection.

## Incident command repository boundaries

Incident mutations use tenant-scoped repository methods even after a
tenant-scoped row lock. `transitionStatusForOrg()` and `assignForOrg()` both
include `org_id` in the update predicate as defense in depth. Assignment user
validation uses `findByIdAndOrg()` on the transaction-bound user repository,
so the incident update, user check, and immutable audit insertion share one
PostgreSQL transaction and cannot cross organization boundaries.

INC-03C creates incident notes only after `findByIdForUpdate()` confirms the
incident belongs to the trusted organization. The transaction-bound note and
audit repositories then commit together. Migration
`20261020000100_inc_03c_incident_notes.js` adds the timeline-compatible
`incident_note_added` audit action and enforces the 10,000-character content
limit at the database boundary.

INC-03D resolves incidents through the same locked, tenant-scoped command
boundary. The status update, optional `incident_notes` insert, and immutable
reason-bearing audit share one transaction. Migration
`20261020000200_inc_03d_incident_resolution.js` extends the audit action enum
with `incident_resolve`; because the incident table has no resolution-reason
column, this immutable audit event is the authoritative classification source
and is projected into the incident timeline as a status change.


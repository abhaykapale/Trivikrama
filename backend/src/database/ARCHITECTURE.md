# Database Architecture

The database layer is the infrastructure boundary that owns client lifecycle, repository factories, transaction boundaries, and availability checks for Postgres, MongoDB, and Redis. It is consumed by the application modules but intentionally kept behind repository and unit-of-work abstractions.

## Responsibility

- Create and validate database clients for Postgres, MongoDB, and Redis.
- Expose repository factories for relational and Mongo collections.
- Provide a PostgreSQL `IUnitOfWork` implementation for multi-step operations.
- Support maintenance, verification, and bootstrap scripts for operational readiness.

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

## Important Components

- [`index.ts`](./index.ts): bootstrap, startup verification, and shutdown orchestration.
- [`postgres/`](./postgres): Postgres client configuration and health checks.
- [`mongodb/`](./mongodb): MongoDB client bootstrap and helpers.
- [`redis/`](./redis): Redis client and verification helpers.
- [`repositories/`](./repositories): repository abstractions and Postgres/Mongo adapters.
- [`transactions/`](./transactions): `PostgresUnitOfWork` and transaction primitives.
- [`verification/`](./verification): database readiness checks used during startup.
- [`maintenance/`](./maintenance): maintenance tasks for Postgres operations.
- [`seeds/`](./seeds): baseline and development data seeding.
- [`health.ts`](./health.ts): aggregated health summary for database services.


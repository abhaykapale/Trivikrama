# Backend Architecture

The backend is a modular Express service with a single composition root in `src/main.ts`. It creates shared database clients and repository factories, builds module-level dependency graphs, mounts HTTP routes, and closes resources through a shutdown coordinator. The current implementation also includes a collector-ingestion security boundary that is configured from runtime trust settings.

## Responsibility

- Initialize configuration, Postgres, MongoDB, and Redis before the service listens for traffic.
- Assemble module dependencies for auth, users, health, ingestion, and incidents.
- Mount routes in `app.ts` and start the HTTP listener in `server.ts`.
- Apply global security middleware and centralized error handling.
- Handle graceful shutdown through `ShutdownCoordinator`.

## Layer Map

```mermaid
flowchart TD
    MAIN["src/main.ts"]
    APP["src/app.ts"]
    SERVER["src/server.ts"]
    CONFIG["src/config/"]
    DB["src/database/"]
    AUTH["src/modules/auth/"]
    USERS["src/modules/users/"]
    INGEST["src/modules/ingestion/"]
    HEALTH["src/modules/health/"]
    MW["src/middleware/"]
    SHARED["src/shared/"]

    MAIN --> CONFIG
    MAIN --> DB
    MAIN --> AUTH
    MAIN --> USERS
    MAIN --> INGEST
    MAIN --> HEALTH
    MAIN --> APP
    MAIN --> SERVER
    MAIN --> SHARED

    APP --> MW
    APP --> AUTH
    APP --> USERS
    APP --> HEALTH

    AUTH --> DB
    USERS --> DB
    INGEST --> FS["collector handoff filesystem"]
```

## Startup Flow

```mermaid
flowchart TD
    START["bootstrap()"]
    ENV["load env config"]
    INIT["initializeDatabases()"]
    HEALTH["new HealthService(databaseClients)"]
    AUTH["createAuthApplicationDependencies({ knex, repositories, unitOfWork })"]
    USERS["createUserManagementDependencies({ userRepository, passwordHasher, unitOfWork })"]
    APP["createApp({ healthService, auth, users })"]
    SERVER["startServer({ ... })"]
    SIG["registerSignalHandlers()"]
    SHUTDOWN["ShutdownCoordinator.shutdown()"]
    CLOSE["closeDatabases() + closeHttpServer()"]

    START --> ENV --> INIT --> HEALTH --> AUTH --> USERS --> APP --> SERVER --> SIG
    SIG --> SHUTDOWN --> CLOSE
```

## Request Flow

```mermaid
sequenceDiagram
    participant Client
    participant App as createApp()
    participant Security as applySecurityMiddleware()
    participant Health as createHealthRouter()
    participant Auth as createAuthRouter()
    participant Users as createUsersRouter()
    participant Error as errorMiddleware

    Client->>App: HTTP request
    App->>Security: install helmet/cors/compression/rate-limit/CSRF guards
    alt GET /
        App->>Health: health route
    else /api/v1/auth/*
        App->>Auth: auth endpoints
    else /api/v1/users/*
        App->>Users: user-management endpoints
    end
    App->>Error: central error handling
```

## Dependency Injection Architecture

The actual composition root is `src/main.ts`. It creates database clients, repository objects, and module builders and then passes them into the Express app.

```mermaid
flowchart TD
    MAIN["src/main.ts"]
    PG["postgres client"]
    MG["mongodb client"]
    RD["redis client"]
    REPOS["createPostgresRepositories(databaseClients.postgres)"]
    UOW["createPostgresUnitOfWork(databaseClients.postgres)"]
    AUTHD["createAuthApplicationDependencies(...)"]
    USERD["createUserManagementDependencies(...)"]
    APP["createApp({ healthService, auth, users })"]
    AUTHROUTER["createAuthRouter(auth)"]
    USERSROUTER["createUsersRouter(users)"]

    MAIN --> PG
    MAIN --> MG
    MAIN --> RD
    PG --> REPOS
    PG --> UOW
    REPOS --> AUTHD
    UOW --> AUTHD
    AUTHD --> APP
    USERD --> APP
    AUTHD --> AUTHROUTER
    USERD --> USERSROUTER
```

## Data and Security Flow

- `applySecurityMiddleware()` in `src/middleware/security/index.ts` runs before routes are mounted.
- Auth routes use Redis-backed rate limiting and then `authenticateRequest()` from the auth module to verify cookies or bearer tokens.
- User routes require a valid authenticated principal and `users.manage` permission via `requirePermission()`.
- Incident status and assignment mutations run through retrying SERIALIZABLE
  units of work. Assignment additionally requires `incidents.assign`, validates
  an active same-tenant user, and commits the mutation with immutable audit.
- Incident notes use the same tenant-scoped transaction boundary; the raw
  Markdown note and its timeline-compatible immutable audit record commit or
  roll back together.
- Incident resolution requires an investigating incident and a classified
  reason. Its status update, optional note, and immutable reason-bearing audit
  record commit through the same tenant-scoped SERIALIZABLE boundary.
- SYS-01A adds a read-only end-to-end evidence boundary. It cross-checks one
  real event across verified raw archive, normalized event, feature vector, AI
  result, alerts, incident, audit, notification outbox, Redis publication, and
  Collector heartbeat records. It emits text and JSON reports but never writes
  operational data or converts missing evidence into success.
- `initializeDatabases()` verifies Postgres, MongoDB, and Redis connectivity concurrently and aborts startup if any dependency fails.
- `env.collector.trust` now carries the collector identity, HMAC key ID, and HMAC secret used to seed the ingestion trust store.
- `ShutdownCoordinator` makes shutdown best-effort: each registered resource receives a close attempt, and failures are reported explicitly.

## Important Components

- [`src/main.ts`](./src/main.ts): bootstrap and dependency assembly.
- [`src/app.ts`](./src/app.ts): Express app creation and route mounting.
- [`src/server.ts`](./src/server.ts): HTTP listener startup.
- [`src/database/ARCHITECTURE.md`](./src/database/ARCHITECTURE.md): database lifecycle and repositories.
- [`src/modules/auth/ARCHITECTURE.md`](./src/modules/auth/ARCHITECTURE.md): authentication, tokens, and RBAC.
- [`src/modules/users/ARCHITECTURE.md`](./src/modules/users/ARCHITECTURE.md): user management and transactional mutations.
- [`src/modules/incidents/ARCHITECTURE.md`](./src/modules/incidents/ARCHITECTURE.md): incident correlation, query, and transactional command invariants.
- [`src/modules/system-proof/ARCHITECTURE.md`](./src/modules/system-proof/ARCHITECTURE.md): fail-closed end-to-end evidence verification.
- [`src/modules/ingestion/ARCHITECTURE.md`](./src/modules/ingestion/ARCHITECTURE.md): collector integrity verification.

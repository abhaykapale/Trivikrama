# Backend Source Architecture

`src/` is the executable service root for the backend. The entrypoint is `main.ts`, request assembly is in `app.ts`/`server.ts`, persistence is in `database/`, feature behavior is in `modules/`, and shared functions live in `config/`, `middleware/`, `runtime/`, and `shared/`. `index.ts` is the public barrel that re-exports module APIs, including the ingestion verifier and collector trust helpers. The ingestion module also consumes collector trust settings from `config/env.ts` and a filesystem handoff boundary inside `modules/ingestion/`.

## Responsibility

- Define the backend source-tree architecture and its runtime boundaries.
- Show how bootstrap code wires modules into the Express application.
- Separate infrastructure (`database/`), request handling (`middleware/`), runtime lifecycle (`runtime/`), and business features (`modules/`).

## Folder Map

```mermaid
flowchart TD
    ROOT["src/"]
    INDEX["index.ts"]
    MAIN["main.ts"]
    APP["app.ts"]
    SERVER["server.ts"]
    CONFIG["config/"]
    DB["database/"]
    MODULES["modules/"]
    MIDDLEWARE["middleware/"]
    RUNTIME["runtime/"]
    SHARED["shared/"]
    SCRIPTS["scripts/"]

    ROOT --> MAIN
    ROOT --> INDEX
    ROOT --> APP
    ROOT --> SERVER
    ROOT --> CONFIG
    ROOT --> DB
    ROOT --> MODULES
    ROOT --> MIDDLEWARE
    ROOT --> RUNTIME
    ROOT --> SHARED
    ROOT --> SCRIPTS

    MAIN --> DB
    MAIN --> MODULES
    MAIN --> APP
    MAIN --> SERVER
    INDEX --> MODULES
    APP --> MIDDLEWARE
    APP --> MODULES
    MODULES --> DB
    MODULES --> SHARED
    MODULES --> CONFIG
```

## Runtime Startup Flow

```mermaid
flowchart TD
    MAIN["main.ts"]
    INDEX["index.ts"]
    ENV["config/env.ts"]
    INIT["initializeDatabases()"]
    REPOS["createPostgresRepositories()"]
    UOW["createPostgresUnitOfWork()"]
    AUTH["createAuthApplicationDependencies()"]
    USERS["createUserManagementDependencies()"]
    HEALTH["new HealthService(databaseClients)"]
    APP["createApp({ healthService, auth, users })"]
    SERVER["startServer(...)"]
    SIGNAL["registerSignalHandlers()"]
    INGEST["modules/ingestion/"]

    MAIN --> ENV --> INIT --> REPOS --> AUTH
    INIT --> HEALTH
    REPOS --> USERS
    INDEX --> INGEST
    AUTH --> APP
    USERS --> APP
    HEALTH --> APP
    APP --> SERVER
    SERVER --> SIGNAL
```

## Request Path

```mermaid
sequenceDiagram
    participant Client
    participant App as app.ts
    participant Auth as auth router
    participant Users as users router
    participant Health as health router
    participant Error as errorMiddleware

    Client->>App: HTTP request
    App->>Auth: /api/v1/auth/*
    App->>Users: /api/v1/users/*
    App->>Health: /
    App->>Error: map unhandled failure
```

## Dependency Injection and Wiring

The composition root is `main.ts`, not a framework container. Runtime objects are created explicitly and passed as constructor or factory dependencies.

```mermaid
flowchart TD
    MAIN["main.ts"]
    DB["DatabaseClients"]
    REPOS["RelationalRepositories"]
    UOW["IUnitOfWork"]
    AUTHD["createAuthApplicationDependencies()"]
    USERD["createUserManagementDependencies()"]
    AUTHROUTER["createAuthRouter()"]
    USERSROUTER["createUsersRouter()"]
    APP["createApp()"]

    MAIN --> DB
    DB --> REPOS
    DB --> UOW
    REPOS --> AUTHD
    UOW --> AUTHD
    REPOS --> USERD
    UOW --> USERD
    AUTHD --> AUTHROUTER
    USERD --> USERSROUTER
    AUTHROUTER --> APP
    USERSROUTER --> APP
```

## Important Components

- [`main.ts`](./main.ts): runtime composition root and graceful shutdown wiring.
- [`app.ts`](./app.ts): Express assembly and route mounting.
- [`server.ts`](./server.ts): application listener startup.
- [`config/`](./config): environment and runtime settings.
- [`database/`](./database/ARCHITECTURE.md): shared persistence and repository lifecycle.
- [`modules/auth/`](./modules/auth): JWT-session authentication and RBAC.
- [`modules/users/`](./modules/users): user management and transactional mutations.
- [`modules/ingestion/`](./modules/ingestion): collector verification and trust checks.
- [`middleware/`](./middleware): security and error middleware.
- [`runtime/`](./runtime): process shutdown orchestration.
- [`shared/`](./shared): logging and common utilities.

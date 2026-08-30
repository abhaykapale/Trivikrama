# Repository Architecture

This repository is organized around a backend runtime, a versioned collector contract package, and supporting documentation. The executable service lives in `backend/`, while the `contracts/` package defines the ingestion payloads that the backend verifies before accepting collector traffic.

## Responsibility

- Keep the runtime service, persistence layer, and feature modules in one backend boundary.
- Show how the bootstrap path wires database clients, modules, and HTTP routes.
- Keep the collector ingress contract separate from the service code so it can be versioned and validated independently.

## Boundary Map

```mermaid
flowchart TD
    ROOT["Trivikrama repository"]
    BACKEND["backend/"]
    CONTRACTS["contracts/collector-ingress/v1/"]
    FRONTEND["frontend/"]
    DOCS["docs/"]
    ARCH["architecture/"]

    ROOT --> BACKEND
    ROOT --> CONTRACTS
    ROOT --> FRONTEND
    ROOT --> DOCS
    ROOT --> ARCH

    BACKEND --> B_SRC["backend/src/"]
    BACKEND --> B_ARCH["backend/ARCHITECTURE.md"]
    BACKEND --> AUTH["backend/src/modules/auth/ARCHITECTURE.md"]
    BACKEND --> USERS["backend/src/modules/users/ARCHITECTURE.md"]
    BACKEND --> INGEST["backend/src/modules/ingestion/ARCHITECTURE.md"]
    BACKEND --> DB["backend/src/database/ARCHITECTURE.md"]

    CONTRACTS --> CONTRACT_DOC["collector contract schemas and fixtures"]
```

## Startup and Runtime Wiring

```mermaid
flowchart TD
    MAIN["backend/src/main.ts"]
    DB["backend/src/database/"]
    AUTH["backend/src/modules/auth/"]
    USERS["backend/src/modules/users/"]
    INGEST["backend/src/modules/ingestion/"]
    HEALTH["backend/src/modules/health/"]
    APP["backend/src/app.ts"]
    SERVER["backend/src/server.ts"]

    MAIN --> DB
    MAIN --> AUTH
    MAIN --> USERS
    MAIN --> INGEST
    MAIN --> HEALTH
    MAIN --> APP
    MAIN --> SERVER

    APP --> AUTH
    APP --> USERS
    APP --> HEALTH

    AUTH --> DB
    USERS --> DB
    INGEST --> DB
```

## Composition Root

`backend/src/main.ts` is the real composition root. It is the only place in the bootstrap path that creates database clients, repository factories, unit-of-work wiring, and module-specific dependency objects before creating the HTTP app.

```mermaid
sequenceDiagram
    participant Main as main.ts
    participant DB as initializeDatabases()
    participant Auth as createAuthApplicationDependencies()
    participant Users as createUserManagementDependencies()
    participant App as createApp()
    participant Server as startServer()

    Main->>DB: build Postgres + Mongo + Redis clients
    DB-->>Main: DatabaseClients
    Main->>Auth: build JWT/session/auth services
    Main->>Users: build user-management use cases
    Main->>App: mount health/auth/users routers
    Main->>Server: listen on configured port
```

## Important Boundaries

- `backend/src/database` owns shared persistence clients and repository factories.
- `backend/src/modules/auth` owns request authentication, session validation, RBAC, and JWT issuance/refresh.
- `backend/src/modules/users` owns organization-scoped user administration and transactional audits.
- `backend/src/modules/ingestion` validates collector payload integrity before the backend trusts the message.
- `contracts/collector-ingress/v1` defines the message schema and verification fixtures consumed by the ingestion module.

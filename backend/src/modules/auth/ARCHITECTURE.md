# Auth Module Architecture

The auth module owns the authentication boundary for the backend: it verifies incoming credentials, creates JWT-backed sessions, validates request tokens, and enforces role/permission checks for protected routes.

## Responsibility

- Authenticate username/password requests through `AuthService` and the login use case.
- Issue, verify, refresh, and revoke JWT-backed sessions.
- Attach an `AuthenticatedPrincipal` to valid requests via `authenticateRequest()`.
- Enforce RBAC through `requirePermission()` and `requireRole()`.
- Grant `incidents.view` to the three documented operational roles while
  retaining explicit route-level authorization for incident reads.
- Grant `events.view` to Admin, Security Engineer, and SOC Analyst for the
  tenant-scoped LOG-01A search, detail, and export routes.
- Grant `rules.view` to Admin, Security Engineer, and SOC Analyst for the
  tenant-scoped RULE-02A Sigma rule list and detail routes.
- Retain `rules.create` for Admin and Security Engineer only; RULE-02B enforces
  it after authentication and before parsing or compiling submitted YAML.
- Grant `rules.edit` and `rules.enable` to Admin and Security Engineer only;
  RULE-02C denies SOC Analysts before update or status-command execution.
- RULE-02D keeps `rules.delete` Admin-only, grants `rules.import` to Admin and
  Security Engineer, and grants `rules.test`/`rules.export` to all three
  authenticated operational roles.
- Record auth activity in the shared audit repository.

## Folder and Runtime Map

```mermaid
flowchart TD
    ROUTES["http/auth.routes.ts"]
    MIDDLEWARE["http/auth.middleware.ts"]
    RBAC["http/rbac.middleware.ts"]
    COOKIE["http/auth-cookie.ts"]
    APPDEP["composition/auth-application-dependencies.ts"]
    SERVICE["application/services/auth.service.ts"]
    USECASES["application/use-cases/"]
    DOMAIN["domain/auth.contracts.ts"]
    INFRA["infrastructure/"]
    REPOS["database repositories"]

    ROUTES --> MIDDLEWARE
    ROUTES --> COOKIE
    ROUTES --> SERVICE
    MIDDLEWARE --> DOMAIN
    MIDDLEWARE --> REPOS
    APPDEP --> SERVICE
    APPDEP --> USECASES
    APPDEP --> INFRA
    SERVICE --> USECASES
    USECASES --> DOMAIN
    USECASES --> REPOS
```

## Composition Root and DI

`createAuthApplicationDependencies()` is the module composition root. It adapts shared database access and infrastructure services into the auth module’s own contracts.

```mermaid
flowchart TD
    MAIN["backend/src/main.ts"]
    APPDEP["createAuthApplicationDependencies({ knex, repositories, unitOfWork, appConfig })"]
    PASSWORD["new BcryptPasswordService()"]
    PASSADAPTER["BcryptPasswordServiceAdapter"]
    JWT["new JwtService({ secret, issuer, clock })"]
    JWTADAPTER["JwtServiceAdapter"]
    CLOCK["new SystemClock()"]
    IDGEN["new UuidIdGenerator()"]
    IDADAPTER["UuidIdGeneratorAdapter"]
    SESSIONVALIDATOR["new PostgresSessionValidator(knex, clock)"]
    SESSIONADAPTER["PostgresSessionValidatorAdapter"]
    LOGIN["new LoginUseCase(...)"]
    LOGOUT["new LogoutUseCase(...)"]
    REFRESH["new RefreshTokenUseCase(...)"]
    ME["new GetCurrentUserUseCase(...)"]
    AUTHSERVICE["new AuthService({ loginUseCase, logoutUseCase, refreshTokenUseCase, getCurrentUserUseCase })"]

    MAIN --> APPDEP
    APPDEP --> PASSWORD
    PASSWORD --> PASSADAPTER
    APPDEP --> JWT
    JWT --> JWTADAPTER
    APPDEP --> CLOCK
    APPDEP --> IDGEN
    IDGEN --> IDADAPTER
    APPDEP --> SESSIONVALIDATOR
    SESSIONVALIDATOR --> SESSIONADAPTER
    APPDEP --> LOGIN
    APPDEP --> LOGOUT
    APPDEP --> REFRESH
    APPDEP --> ME
    LOGIN --> AUTHSERVICE
    LOGOUT --> AUTHSERVICE
    REFRESH --> AUTHSERVICE
    ME --> AUTHSERVICE
```

## Request and Session Flow

```mermaid
sequenceDiagram
    participant Client
    participant Route as auth.routes.ts
    participant RL as Redis fixed-window limiter
    participant Service as AuthService
    participant Login as LoginUseCase
    participant Users as IUserRepository
    participant Sessions as ISessionRepository
    participant JWT as IJwtService
    participant Cookie as auth-cookie.ts

    Client->>Route: POST /auth/login
    Route->>RL: rate limit check
    Route->>Service: login({ username, password, ipAddress, userAgent })
    Service->>Login: execute(input)
    Login->>Users: findByUsername()
    Login->>Sessions: create(session)
    Login->>JWT: sign(claims)
    Login-->>Service: token + expiresAt
    Service-->>Route: response DTO
    Route->>Cookie: set auth + CSRF cookies
    Route-->>Client: 200 response
```

## Protected Request Flow

```mermaid
flowchart TD
    REQUEST["incoming request"]
    EXTRACT["extractToken(request, config)"]
    VERIFY["jwtService.verify(token)"]
    SESSION["sessionRepository.findByJwtId(claims.jti)"]
    ACTIVE["userRepository.findById(claims.sub)"]
    PRINCIPAL["AuthenticatedPrincipal assigned to request.user"]
    RBAC["requirePermission() / requireRole()"]
    NEXT["route handler executes"]
    DENY["401 Unauthorized"]

    REQUEST --> EXTRACT --> VERIFY --> SESSION --> ACTIVE --> PRINCIPAL --> RBAC --> NEXT
    EXTRACT -->|missing| DENY
    VERIFY -->|invalid| DENY
    SESSION -->|revoked/expired/not found| DENY
    ACTIVE -->|missing/inactive| DENY
    RBAC -->|missing role/permission| DENY
```

## Data and Security Flow

- `loginRequestSchema` validates body constraints before calling `AuthService.login()`.
- `authenticateRequest()` checks the auth cookie first and falls back to the `Authorization: Bearer` header.
- A valid JWT is validated by `IJwtService`, and the `jti` is checked against the session repository.
- `AuthenticatedPrincipal` includes `userId`, `orgId`, `role`, `jwtId`, `issuedAt`, and `expiresAt` and is attached to `request.user`.
- Protected routes call `requirePermission()` and/or `requireRole()` after request authentication succeeds.
- Asset permissions mirror the security matrix: every operational role has
  `assets.view`; Admin and Security Engineer have `assets.create` and
  `assets.edit`; only Admin has `assets.delete`.
- Every authenticated operational role has `dashboard.view`; dashboard routes
  still derive `orgId` exclusively from the verified principal.
- Only Admin and Security Engineer roles have `audit.view`; SOC Analysts are
  rejected before the audit query use case executes.
- Only Admin has `config.view` and `config.modify`. Admin and Security Engineer
  have `config.ai_threshold`, which is selected only for the exact
  `ai.anomaly_threshold` key; SOC Analyst has no configuration permission.
- WS-01A reuses JWT, session, and active-user contracts during the HTTP upgrade
  but accepts credentials only from the HttpOnly auth cookie. It additionally
  requires the configured frontend origin and exact session/user ownership.

## Important Components

- [`http/auth.routes.ts`](./http/auth.routes.ts): login, logout, refresh, and `/me` endpoints.
- [`http/auth.middleware.ts`](./http/auth.middleware.ts): token extraction, JWT validation, session verification, and principal attachment.
- [`http/rbac.middleware.ts`](./http/rbac.middleware.ts): permission and role enforcement.
- [`http/auth-cookie.ts`](./http/auth-cookie.ts): cookie parsing and auth/CSRF cookie mutation.
- [`application/services/auth.service.ts`](./application/services/auth.service.ts): service facade over use cases.
- [`application/use-cases/`](./application/use-cases): `LoginUseCase`, `LogoutUseCase`, `RefreshTokenUseCase`, `GetCurrentUserUseCase`.
- [`composition/auth-application-dependencies.ts`](./composition/auth-application-dependencies.ts): module composition root.
- [`infrastructure/`](./infrastructure): `BcryptPasswordService`, `JwtService`, `PostgresSessionValidator`, `SystemClock`, `UuidIdGenerator`.

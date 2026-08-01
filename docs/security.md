# Security Architecture

## AI-Powered Security Analytics Platform

| Field | Value |
|---|---|
| **Document ID** | SEC-001 |
| **Version** | 1.0 |
| **Date** | 2026-07-19 |
| **Status** | Draft |
| **Architecture Reference** | [ADR-001](file:///d:/AI%20SIEM/docs/architecture/decisions/ADR-001-modular-monolith.md) |
| **API Reference** | [API-001](file:///d:/AI%20SIEM/docs/api.md) |
| **Database Reference** | [DB-001](file:///d:/AI%20SIEM/docs/database.md) |
| **Frontend Reference** | [FRONTEND-001](file:///d:/AI%20SIEM/docs/frontend.md) |

---

## Table of Contents

1. [JWT Authentication](#1-jwt-authentication)
2. [RBAC (Role-Based Access Control)](#2-rbac-role-based-access-control)
3. [Rate Limiting](#3-rate-limiting)
4. [Collector Authentication](#4-collector-authentication)
5. [API Security](#5-api-security)
6. [Input Validation](#6-input-validation)
7. [SQL Injection Prevention](#7-sql-injection-prevention)
8. [NoSQL Injection Prevention](#8-nosql-injection-prevention)
9. [Secrets Management](#9-secrets-management)
10. [Audit Logs](#10-audit-logs)

---

## 1. JWT Authentication

### 1.1 Architecture

```mermaid
graph TB
    subgraph AUTH_ARCH["JWT Authentication Architecture"]

        subgraph CLIENT["Client (Browser)"]
            LOGIN_FORM["Login Form"]
            COOKIE_STORE["httpOnly Cookie<br/>(siem_token)"]
        end

        subgraph BACKEND["Node.js Backend"]
            AUTH_MW["Auth Middleware<br/>(verifyToken)"]
            AUTH_CTRL["AuthController"]
            AUTH_SVC["AuthService"]
            JWT_SVC["JWTService<br/>(sign / verify / refresh)"]
            PWD_SVC["PasswordService<br/>(bcrypt hash / compare)"]
            SESSION_REPO["SessionRepository<br/>(PostgreSQL sessions table)"]
        end

        subgraph STORAGE["Storage"]
            PG_USER[("users table")]
            PG_SESSION[("sessions table")]
        end
    end

    LOGIN_FORM -->|"POST /auth/login"| AUTH_CTRL
    AUTH_CTRL --> AUTH_SVC
    AUTH_SVC --> PWD_SVC
    AUTH_SVC --> JWT_SVC
    AUTH_SVC --> SESSION_REPO
    PWD_SVC --> PG_USER
    SESSION_REPO --> PG_SESSION
    JWT_SVC -->|"Set-Cookie: httpOnly"| COOKIE_STORE

    COOKIE_STORE -->|"Cookie header<br/>on every request"| AUTH_MW
    AUTH_MW --> JWT_SVC

    style AUTH_ARCH fill:#1a1a2e,color:#fff
```

### 1.2 JWT Token Structure

```json
{
  "header": {
    "alg": "HS256",
    "typ": "JWT"
  },
  "payload": {
    "sub": "usr-abc123",
    "username": "jsmith",
    "role": "soc_analyst",
    "jti": "sess-unique-id-001",
    "iat": 1752922800,
    "exp": 1752926400,
    "iss": "ai-siem"
  }
}
```

| Claim | Type | Description |
|---|---|---|
| `sub` | string | User ID (UUID) |
| `username` | string | Username for display |
| `role` | string | `admin`, `security_engineer`, `soc_analyst` |
| `jti` | string | JWT ID — references `sessions.jwt_id` for server-side revocation |
| `iat` | number | Issued at (Unix timestamp) |
| `exp` | number | Expires at (Unix timestamp) |
| `iss` | string | Issuer identifier (`ai-siem`) |

### 1.3 Token Lifecycle

```mermaid
stateDiagram-v2
    [*] --> NoToken : App loads

    NoToken --> Authenticating : User submits credentials
    Authenticating --> Active : 200 OK + Set-Cookie
    Authenticating --> NoToken : 401 Invalid credentials

    Active --> Active : Token valid, requests succeed
    Active --> Refreshing : Token expiry < 5 min remaining
    Active --> Revoked : POST /auth/logout

    Refreshing --> Active : POST /auth/refresh → new token
    Refreshing --> NoToken : Refresh fails (session revoked)

    Revoked --> NoToken : Cookie cleared, session deleted
    Active --> NoToken : 401 on any request (token expired or tampered)
```

### 1.4 Token Configuration

| Setting | Value | Description |
|---|---|---|
| `jwt.algorithm` | `HS256` | HMAC SHA-256 signing |
| `jwt.access_token_expiry` | `1h` | Access token validity |
| `jwt.refresh_window` | `5m` | Auto-refresh when expiry < 5 min |
| `jwt.max_session_duration` | `7d` | Absolute session lifetime |
| `jwt.issuer` | `ai-siem` | Token issuer claim |
| `jwt.cookie_name` | `siem_token` | Cookie name |
| `jwt.cookie_httpOnly` | `true` | Not accessible to JavaScript |
| `jwt.cookie_secure` | `true` (production) | HTTPS only |
| `jwt.cookie_sameSite` | `Strict` | No cross-site sending |

### 1.5 Server-Side Session Tracking
very JWT is tracked server-side in the `sessions` table. This enables:

| Feature | Mechanism |
|---|---|
| **Immediate revocation** | Delete session row → next request with that `jti` returns 401 |
| **Single-device enforcement** | Optional: delete previous sessions on new login |
| **Session listing** | Admin can view all active sessions for a user |
| **Forced logout** | Admin can revoke any session by `jti` |

```mermaid
sequenceDiagram
    participant MW as Auth Middleware
    participant JWT as JWTService
    participant DB as sessions table

    MW->>JWT: verify(token)
    JWT->>JWT: Check signature (HS256)
    JWT->>JWT: Check expiry (exp > now)
    JWT->>JWT: Check issuer (iss == "ai-siem")

    alt Token structurally valid
        JWT->>DB: SELECT * FROM sessions WHERE jwt_id = :jti AND revoked_at IS NULL
        alt Session exists and not revoked
            DB-->>JWT: Session row
            JWT-->>MW: Authenticated (attach user to request)
        else Session revoked or not found
            DB-->>JWT: Empty
            JWT-->>MW: 401 Unauthorized (session revoked)
        end
    else Token invalid
        JWT-->>MW: 401 Unauthorized (invalid token)
    end
```

### 1.6 Password Security

| Measure | Implementation |
|---|---|
| **Hashing** | bcrypt with 12 salt rounds |
| **Minimum length** | 12 characters |
| **Complexity** | At least 1 uppercase, 1 lowercase, 1 digit, 1 special character |
| **Account lockout** | Lock after 5 consecutive failed login attempts |
| **Lockout duration** | 15 minutes (auto-unlock) or manual unlock by admin |
| **Password history** | Not tracked in MVP (future enhancement) |

### 1.7 Brute Force Protection

```mermaid
flowchart TD
    LOGIN["POST /auth/login"]
    CHECK_LOCK{"Account<br/>locked?"}
    LOCKED["Return 423<br/>Account Locked"]
    VERIFY["Verify password<br/>(bcrypt.compare)"]
    VALID{"Password<br/>correct?"}
    RESET_COUNT["Reset failed_login_count = 0"]
    INC_COUNT["Increment failed_login_count"]
    THRESHOLD{"failed_login_count<br/>>= 5?"}
    LOCK["Set locked_until = NOW() + 15 min"]
    FAIL["Return 401<br/>Invalid credentials"]
    SUCCESS["Generate JWT<br/>Create session<br/>Return 200"]

    LOGIN --> CHECK_LOCK
    CHECK_LOCK -->|"yes"| LOCKED
    CHECK_LOCK -->|"no"| VERIFY --> VALID
    VALID -->|"yes"| RESET_COUNT --> SUCCESS
    VALID -->|"no"| INC_COUNT --> THRESHOLD
    THRESHOLD -->|"yes"| LOCK --> FAIL
    THRESHOLD -->|"no"| FAIL

    style LOCKED fill:#e74c3c,color:#fff
    style SUCCESS fill:#27ae60,color:#fff
```

### 1.8 WebSocket Security

WebSocket connections require the same level of security as REST API endpoints.

| Security Measure | Implementation |
|---|---|
| **Authentication** | The WebSocket upgrade request (`Upgrade: websocket`) must contain a valid `siem_token` HttpOnly cookie. The server verifies this JWT before accepting the connection. Unauthenticated upgrade requests are rejected with `HTTP 401`. |
| **Authorization** | Messages received over WebSocket are bound to the authenticated user's session. The user's role is checked against the channel's RBAC requirements before allowing subscription or broadcast. |
| **Rate Limiting** | WebSocket message frames are rate-limited independently (e.g., max 100 messages/minute per connection) using a token bucket algorithm to prevent DoS attacks. |
| **Connection Limits** | A single user session can have a maximum of 5 concurrent WebSocket connections to prevent resource exhaustion. |

---

## 2. RBAC (Role-Based Access Control)

### 2.1 Role Hierarchy

```mermaid
graph TB
    ADMIN["Admin<br/>Full system access"]
    ENGINEER["Security Engineer<br/>Detection + Investigation"]
    ANALYST["SOC Analyst<br/>View + Triage"]

    ADMIN --> ENGINEER --> ANALYST

    style ADMIN fill:#e74c3c,color:#fff
    style ENGINEER fill:#f39c12,color:#fff
    style ANALYST fill:#3498db,color:#fff
```

### 2.2 Permission Matrix

| Permission | Admin | Security Engineer | SOC Analyst |
|---|---|---|---|
| **Incidents** | | | |
| View incidents | ✅ | ✅ | ✅ |
| Change incident status | ✅ | ✅ | ✅ |
| Assign incidents | ✅ | ✅ | ❌ |
| Add notes | ✅ | ✅ | ✅ |
| Resolve incidents | ✅ | ✅ | ✅ |
| **Events** | | | |
| Search events | ✅ | ✅ | ✅ |
| Export events | ✅ | ✅ | ✅ |
| **Rules** | | | |
| View rules | ✅ | ✅ | ✅ |
| Create rules | ✅ | ✅ | ❌ |
| Edit rules | ✅ | ✅ | ❌ |
| Delete rules | ✅ | ❌ | ❌ |
| Enable/Disable rules | ✅ | ✅ | ❌ |
| Import rules | ✅ | ✅ | ❌ |
| Export rules | ✅ | ✅ | ✅ |
| Test rules (dry-run) | ✅ | ✅ | ✅ |
| **Users** | | | |
| View users | ✅ | ❌ | ❌ |
| Create/Edit users | ✅ | ❌ | ❌ |
| Deactivate users | ✅ | ❌ | ❌ |
| Reset passwords | ✅ | ❌ | ❌ |
| **Assets** | | | |
| View assets | ✅ | ✅ | ✅ |
| Create/Edit assets | ✅ | ✅ | ❌ |
| Delete assets | ✅ | ❌ | ❌ |
| **Configuration** | | | |
| View config | ✅ | ❌ | ❌ |
| Modify config | ✅ | ❌ | ❌ |
| Modify AI threshold | ✅ | ✅ | ❌ |
| **Audit** | | | |
| View audit log | ✅ | ✅ | ❌ |
| **Collector** | | | |
| View collector status | ✅ | ✅ | ✅ |
| View quarantine | ✅ | ✅ | ❌ |
| Retry quarantine | ✅ | ✅ | ❌ |

### 2.3 RBAC Enforcement Architecture

RBAC is enforced at **two layers** — backend API and frontend UI:

```mermaid
graph TB
    subgraph ENFORCEMENT["Dual-Layer RBAC Enforcement"]

        subgraph FRONTEND_RBAC["Layer 1: Frontend (UI)"]
            ROLE_GUARD["RoleGuard Component<br/>Hides unauthorized UI elements"]
            SIDEBAR_FILTER["Sidebar Filter<br/>Removes unauthorized menu items"]
            BUTTON_HIDE["Button Visibility<br/>Create/Edit/Delete hidden for wrong role"]
        end

        subgraph BACKEND_RBAC["Layer 2: Backend (API)"]
            AUTH_MW2["Auth Middleware<br/>Verify JWT, extract role"]
            RBAC_MW["RBAC Middleware<br/>Check permission for route"]
            REJECT["Return 403 Forbidden"]
        end
    end

    REQUEST["HTTP Request"] --> AUTH_MW2 --> RBAC_MW
    RBAC_MW -->|"has permission"| HANDLER["Route Handler"]
    RBAC_MW -->|"no permission"| REJECT

    style FRONTEND_RBAC fill:#3498db,color:#fff
    style BACKEND_RBAC fill:#e74c3c,color:#fff
```

> [!IMPORTANT]
> Frontend RBAC is **cosmetic only** — it improves UX by hiding buttons an analyst cannot use. The **backend always enforces authorization** regardless of what the frontend sends. Never trust the frontend for access control.

### 2.4 RBAC Middleware Implementation

```typescript
// middleware/rbac.ts

type Permission = string;

const ROUTE_PERMISSIONS: Record<string, Record<string, Permission>> = {
  "POST /api/v1/rules":             { permission: "rules.create" },
  "PUT /api/v1/rules/:id":          { permission: "rules.edit" },
  "DELETE /api/v1/rules/:id":       { permission: "rules.delete" },
  "PUT /api/v1/incidents/:id/assign": { permission: "incidents.assign" },
  "POST /api/v1/users":             { permission: "users.manage" },
  "PUT /api/v1/users/:id":          { permission: "users.manage" },
  "GET /api/v1/audit":              { permission: "audit.view" },
  "GET /api/v1/config":             { permission: "config.view" },
  "PUT /api/v1/config/:key":        { permission: "config.modify" },
};

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  admin: [
    "rules.create", "rules.edit", "rules.delete", "rules.enable",
    "incidents.assign", "users.manage",
    "assets.create", "assets.edit", "assets.delete",
    "audit.view", "config.view", "config.modify",
    "collector.quarantine",
  ],
  security_engineer: [
    "rules.create", "rules.edit", "rules.enable",
    "incidents.assign",
    "assets.create", "assets.edit",
    "audit.view",
    "config.ai_threshold",
    "collector.quarantine",
  ],
  soc_analyst: [],
};

function rbacMiddleware(requiredPermission: Permission) {
  return (req, res, next) => {
    const userRole = req.user.role;  // Set by auth middleware
    const permissions = ROLE_PERMISSIONS[userRole] || [];

    if (!permissions.includes(requiredPermission)) {
      return res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: `Role '${userRole}' does not have permission '${requiredPermission}'`
        }
      });
    }

    next();
  };
}
```

---

## 3. Rate Limiting

### 3.1 Rate Limiting Strategy

Rate limiting protects the API against abuse, brute force, and accidental overload.

```mermaid
graph TB
    subgraph RATE_LIMIT["Rate Limiting Layers"]
        L1["Layer 1: Global<br/>100 req/min per IP"]
        L2["Layer 2: Auth endpoints<br/>10 req/min per IP"]
        L3["Layer 3: Authenticated<br/>300 req/min per user"]
        L4["Layer 4: Export endpoints<br/>5 req/min per user"]
    end

    REQUEST_IN["Incoming Request"]
    REQUEST_IN --> L1
    L1 -->|"pass"| L2
    L2 -->|"pass"| L3
    L3 -->|"pass"| L4
    L4 -->|"pass"| HANDLER2["Route Handler"]

    L1 -->|"blocked"| R429["429 Too Many Requests"]
    L2 -->|"blocked"| R429
    L3 -->|"blocked"| R429
    L4 -->|"blocked"| R429

    style R429 fill:#e74c3c,color:#fff
```

### 3.2 Rate Limit Configuration

| Layer | Scope | Window | Max Requests | Key | Applies To |
|---|---|---|---|---|---|
| **Global** | Per IP | 1 minute | 100 | `rl:global:{ip}` | All endpoints |
| **Auth** | Per IP | 1 minute | 10 | `rl:auth:{ip}` | `/auth/login` only |
| **Authenticated** | Per user | 1 minute | 300 | `rl:user:{userId}` | All authenticated endpoints |
| **Export** | Per user | 1 minute | 5 | `rl:export:{userId}` | `/events/export`, `/rules/export` |
| **Search** | Per user | 1 minute | 30 | `rl:search:{userId}` | `/events/search` |
| **Write** | Per user | 1 minute | 60 | `rl:write:{userId}` | All POST/PUT/DELETE |

### 3.3 Rate Limit Response

When a rate limit is exceeded, the API returns:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 45
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1752923400
```

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Please retry after 45 seconds.",
    "details": {
      "limit": 100,
      "window": "1m",
      "retryAfter": 45
    }
  }
}
```

### 3.4 Rate Limit Storage

Rate limit counters are stored in **Redis** using sliding window counters:

```
Key:    rl:auth:192.168.1.50
Type:   String (counter)
TTL:    60 seconds
Value:  7  (7 login attempts in current window)
```

---

## 4. Collector Authentication

### 4.1 Collector-to-Backend Trust Model

The C++ Collector writes batch files to a shared filesystem directory. The backend reads these files. There is **no direct network communication** between the Collector and the backend — the filesystem is the interface.

```mermaid
graph LR
    subgraph COLLECTOR["C++ Collector (Process 1)"]
        WRITE["Atomic File Write<br/>.tmp → .json"]
    end

    subgraph FILESYSTEM["Shared Volume"]
        DIR["collector/<br/>batch_*.json"]
    end

    subgraph BACKEND_C["Node.js Backend (Process 2)"]
        WATCH["Directory Watcher<br/>(chokidar)"]
        VALIDATE_C["File Validator<br/>(schema + signature)"]
    end

    WRITE -->|"write"| DIR
    DIR -->|"watch"| WATCH --> VALIDATE_C

    style DIR fill:#f39c12,color:#fff
```

### 4.2 Collector Identity

Each collector writes a `collector_id` into every batch file and heartbeat. The backend validates:

| Check | Implementation | Purpose |
|---|---|---|
| **Known collector** | `collector_id` must exist in `monitor.collector_status` table | Reject files from unknown collectors |
| **Schema validation** | Batch file must pass OCSF JSON Schema validation | Reject malformed files |
| **File signature (optional)** | HMAC-SHA256 signature in file metadata | Verify file was written by a trusted collector |

### 4.3 HMAC File Signing

For environments requiring stronger authentication, the Collector signs each batch file:

```mermaid
sequenceDiagram
    participant COL as C++ Collector
    participant FS as Filesystem
    participant BE as Backend Validator

    COL->>COL: Build batch JSON
    COL->>COL: Compute HMAC-SHA256(batch_content, shared_secret)
    COL->>COL: Insert signature into metadata:<br/>{ "metadata": { "signature": "abc123..." } }
    COL->>FS: Atomic write batch_*.json

    FS->>BE: Directory Watcher detects file
    BE->>BE: Read file content
    BE->>BE: Extract signature from metadata
    BE->>BE: Strip signature field from content
    BE->>BE: Compute HMAC-SHA256(content, shared_secret)
    BE->>BE: Compare computed vs extracted

    alt Signatures match
        BE->>BE: File is authentic → process
    else Signatures don't match
        BE->>BE: File tampered → quarantine
    end
```

### 4.4 Collector Secret Distribution

| Approach | Description | MVP Status |
|---|---|---|
| **Shared secret file** | Secret stored in `collector_secret.key` on both Collector and Backend hosts | ✅ MVP |
| **Environment variable** | `COLLECTOR_HMAC_SECRET` set in both processes | ✅ MVP |
| **Vault integration** | Secrets fetched from HashiCorp Vault at startup | ⏳ Post-MVP |

### 4.5 Heartbeat Authentication

Collector heartbeat files are signed with the same HMAC key:

```json
{
  "type": "heartbeat",
  "collector_id": "collector-01",
  "timestamp": "2026-07-19T10:00:00Z",
  "status": "online",
  "metadata": {
    "signature": "e3b0c44298fc1c149afbf4c8996fb924..."
  }
}
```

---

## 5. API Security

### 5.1 Security Headers

Every HTTP response from the backend includes these security headers:

```typescript
// middleware/securityHeaders.ts (using helmet)

import helmet from "helmet";

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "ws://localhost:3000"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: true,
  crossOriginResourcePolicy: { policy: "same-origin" },
  dnsPrefetchControl: true,
  frameguard: { action: "deny" },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  ieNoOpen: true,
  noSniff: true,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  xssFilter: true,
}));
```

| Header | Value | Purpose |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `X-XSS-Protection` | `1; mode=block` | XSS filter |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Force HTTPS |
| `Content-Security-Policy` | `default-src 'self'` | Prevent inline scripts, external loads |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limit referrer leakage |
| `Cross-Origin-Opener-Policy` | `same-origin` | Isolate browsing context |

### 5.2 CORS Configuration

```typescript
// middleware/cors.ts

import cors from "cors";

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3001",
  credentials: true,         // Allow cookies
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,             // Preflight cache: 24h
}));
```

### 5.3 Request Size Limits

| Limit | Value | Applies To |
|---|---|---|
| JSON body | 1 MB | All endpoints |
| YAML body | 5 MB | `/rules/import` |
| URL query string | 2048 characters | All endpoints |
| File upload | Not applicable | No file upload endpoints |

### 5.4 HTTPS Enforcement

| Environment | HTTPS | Configuration |
|---|---|---|
| Development | Optional | HTTP on localhost |
| Production | **Required** | TLS termination at reverse proxy (nginx) or Docker Compose with self-signed certs |

### 5.5 Internal API Isolation

The AI Engine API (`http://ai-engine:8000`) is **never exposed** to external networks:

```mermaid
graph TB
    EXTERNAL["External Network<br/>(Browser)"]
    subgraph DOCKER["Docker Network (siem-net)"]
        NGINX["Nginx Reverse Proxy<br/>:443 (HTTPS)"]
        FE["Frontend<br/>:3001"]
        BE["Backend<br/>:3000"]
        AI["AI Engine<br/>:8000"]
        PG["PostgreSQL<br/>:5432"]
        MDB["MongoDB<br/>:27017"]
        RD["Redis<br/>:6379"]
    end

    EXTERNAL -->|"HTTPS :443"| NGINX
    NGINX --> FE
    NGINX --> BE
    BE --> AI
    BE --> PG
    BE --> MDB
    BE --> RD

    EXTERNAL -.-|"BLOCKED"| AI
    EXTERNAL -.-|"BLOCKED"| PG
    EXTERNAL -.-|"BLOCKED"| MDB
    EXTERNAL -.-|"BLOCKED"| RD

    style AI fill:#f39c12,color:#fff
    style EXTERNAL fill:#e74c3c,color:#fff
```

Only `nginx` ports are exposed to the host. All database and internal service ports are Docker-internal only.

---

## 6. Input Validation

### 6.1 Validation Architecture

Input validation is enforced at **three levels**:

```mermaid
graph TB
    INPUT["User Input"]

    subgraph L1["Level 1: Transport"]
        SIZE["Request size check<br/>(< 1MB)"]
        CONTENT_TYPE["Content-Type check<br/>(application/json)"]
    end

    subgraph L2["Level 2: Schema"]
        SCHEMA["JSON Schema validation<br/>(Joi / Zod)"]
        TYPE_CHECK["Type checking<br/>(string, number, boolean)"]
        RANGE["Range checking<br/>(min, max, enum)"]
        FORMAT["Format validation<br/>(email, UUID, ISO date, IP)"]
    end

    subgraph L3["Level 3: Business"]
        BIZ_RULES["Business rule validation<br/>(status transitions, weight ranges)"]
        REFERENCE["Referential integrity<br/>(user exists, rule exists)"]
        AUTH_CHECK["Authorization<br/>(can this user do this?)"]
    end

    INPUT --> L1 --> L2 --> L3

    style L1 fill:#3498db,color:#fff
    style L2 fill:#f39c12,color:#fff
    style L3 fill:#e74c3c,color:#fff
```

### 6.2 Validation Rules by Endpoint

| Endpoint | Field | Validation |
|---|---|---|
| `POST /auth/login` | `username` | String, 3-100 chars, alphanumeric + underscore |
| | `password` | String, 12-128 chars |
| `POST /rules` | `yamlContent` | String, < 50KB, valid YAML syntax, valid Sigma schema |
| `PUT /incidents/:id/status` | `status` | Enum: `open`, `investigating`, `resolved`, `closed` |
| | `:id` | UUID v4 format |
| `PUT /incidents/:id/resolve` | `resolution` | Enum: `tp_mitigated`, `tp_accepted`, `fp_rule_tuning`, `fp_ai_noise`, `fp_known`, `duplicate`, `informational` |
| `POST /incidents/:id/notes` | `content` | String, 1-10000 chars, sanitized Markdown |
| `GET /events/search` | `srcIp` | Valid IPv4 or IPv6 format |
| | `from`, `to` | ISO 8601 datetime |
| | `limit` | Integer, 1-200 |
| `POST /users` | `email` | Valid email format |
| | `password` | 12+ chars, 1 upper, 1 lower, 1 digit, 1 special |
| | `role` | Enum: `admin`, `security_engineer`, `soc_analyst` |
| `POST /assets` | `criticality` | Number, 0.00-1.00 |
| | `ipAddress` | Valid IPv4 or IPv6, or null |

### 6.3 Schema Validation Implementation

```typescript
// validation/schemas/incident.ts (using Zod)

import { z } from "zod";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const updateStatusSchema = z.object({
  status: z.enum(["open", "investigating", "resolved", "closed"]),
});

export const resolveSchema = z.object({
  resolution: z.enum([
    "tp_mitigated", "tp_accepted",
    "fp_rule_tuning", "fp_ai_noise", "fp_known",
    "duplicate", "informational"
  ]),
  note: z.string().max(10000).optional(),
});

export const addNoteSchema = z.object({
  content: z.string().min(1).max(10000),
});

export const incidentIdParam = z.object({
  id: z.string().regex(UUID_REGEX, "Invalid incident ID format"),
});
```

### 6.4 XSS Prevention

All user-provided text that is rendered in the frontend is **sanitized** on output:

| Layer | Measure |
|---|---|
| **Backend** | Incident notes, rule descriptions stored as-is (raw Markdown). No HTML tags executed |
| **Frontend** | React auto-escapes JSX. Markdown rendered via `react-markdown` with `rehype-sanitize` (strips `<script>`, `<iframe>`, `on*` attributes) |
| **API response** | No HTML in JSON responses — all data is text/JSON |

---

## 7. SQL Injection Prevention

### 7.1 Defense Strategy

```mermaid
graph TB
    subgraph SQL_DEFENSE["SQL Injection Prevention Layers"]
        D1["Parameterized Queries<br/>(ALWAYS — never string concatenation)"]
        D2["ORM / Query Builder<br/>(Knex.js for PostgreSQL)"]
        D3["Input Validation<br/>(Zod schemas before queries)"]
        D4["Least Privilege<br/>(DB user has minimal permissions)"]
        D5["Prepared Statements<br/>(pg driver parameterization)"]
    end

    style D1 fill:#27ae60,color:#fff
```

### 7.2 Parameterized Queries (Mandatory)

Every database query uses parameterized placeholders. **String concatenation of user input into SQL is strictly forbidden.**

```typescript
// ❌ NEVER — Vulnerable to SQL injection
const query = `SELECT * FROM incidents WHERE id = '${req.params.id}'`;

// ✅ ALWAYS — Parameterized (Knex.js)
const incident = await knex("incidents")
  .where("id", req.params.id)
  .first();

// ✅ ALWAYS — Parameterized (raw SQL with pg)
const result = await pool.query(
  "SELECT * FROM incidents WHERE id = $1 AND status = $2",
  [req.params.id, req.query.status]
);
```

### 7.3 Query Builder (Knex.js)

All PostgreSQL access goes through Knex.js, which auto-parameterizes:

```typescript
// Repository Layer — safe by default

class PostgresIncidentRepository implements IIncidentRepository {
  async findByFilters(filters: IncidentFilters): Promise<Incident[]> {
    let query = this.knex("incidents").select("*");

    // All .where() calls are auto-parameterized by Knex
    if (filters.status) {
      query = query.whereIn("status", filters.status);
    }
    if (filters.severity) {
      query = query.whereIn("severity", filters.severity);
    }
    if (filters.search) {
      // Knex parameterizes the LIKE value
      query = query.where("title", "ilike", `%${filters.search}%`);
    }
    if (filters.from) {
      query = query.where("created_at", ">=", filters.from);
    }
    if (filters.assignedTo) {
      query = query.where("assigned_to", filters.assignedTo);
    }

    return query
      .orderBy(filters.sort || "created_at", filters.order || "desc")
      .limit(filters.limit)
      .offset((filters.page - 1) * filters.limit);
  }
}
```

### 7.4 Database User Permissions

The application connects to PostgreSQL with a **restricted user** — not the superuser:

```sql
-- Create application user with minimal privileges
CREATE USER siem_app WITH PASSWORD '${generated_password}';

-- Grant only required permissions
GRANT CONNECT ON DATABASE siem_db TO siem_app;
GRANT USAGE ON SCHEMA public, audit, monitor TO siem_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO siem_app;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA audit TO siem_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA monitor TO siem_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO siem_app;

-- Explicitly deny dangerous operations
REVOKE CREATE ON SCHEMA public FROM siem_app;
-- siem_app CANNOT: DROP tables, CREATE tables, ALTER tables, GRANT roles
```

---

## 8. NoSQL Injection Prevention

### 8.1 MongoDB Injection Vectors

MongoDB queries accept JSON objects. If user input is embedded directly as query objects, attackers can inject operators like `$gt`, `$ne`, `$regex`, `$where`.

```javascript
// ❌ VULNERABLE — user input as query object
const events = await db.collection("normalized_events").find({
  "actor.user.name": req.query.username  // If username = { "$ne": "" } → returns ALL events
});
```

### 8.2 Defense Strategy

```mermaid
graph TB
    subgraph NOSQL_DEFENSE["NoSQL Injection Prevention"]
        N1["String coercion<br/>Always cast input to string before query"]
        N2["Mongoose schema validation<br/>Enforce field types at model level"]
        N3["Operator stripping<br/>Remove $ prefix from user input"]
        N4["Input validation<br/>Zod validates before MongoDB query"]
        N5["mongo-sanitize<br/>npm package to strip $ and . from objects"]
    end

    style N1 fill:#27ae60,color:#fff
```

### 8.3 Sanitization Implementation

```typescript
// middleware/mongoSanitize.ts

import mongoSanitize from "express-mongo-sanitize";

// Strip any keys containing $ or . from req.body, req.query, req.params
app.use(mongoSanitize({
  replaceWith: "_",
  onSanitize: ({ req, key }) => {
    console.warn(`[SECURITY] Sanitized key '${key}' from request`);
  },
}));
```

```typescript
// Repository Layer — explicit string casting

class MongoEventRepository implements ILogRepository {
  async searchEvents(filters: EventSearchFilters): Promise<NormalizedEvent[]> {
    const query: any = {};

    // Always cast user input to string — prevents operator injection
    if (filters.srcIp) {
      query["src_endpoint.ip"] = String(filters.srcIp);
    }
    if (filters.username) {
      query["actor.user.name"] = String(filters.username);
    }
    if (filters.hostname) {
      query["device.hostname"] = String(filters.hostname);
    }

    // Safe: classUid is validated as integer by Zod before reaching here
    if (filters.classUid) {
      query.class_uid = Number(filters.classUid);
    }

    // Time range uses Date objects — not user strings
    if (filters.from || filters.to) {
      query.time = {};
      if (filters.from) query.time.$gte = new Date(filters.from);
      if (filters.to) query.time.$lte = new Date(filters.to);
    }

    // Full-text search uses MongoDB $text (safe, index-backed)
    if (filters.query) {
      query.$text = { $search: String(filters.query) };
    }

    return this.collection
      .find(query)
      .sort({ time: -1 })
      .limit(filters.limit)
      .skip((filters.page - 1) * filters.limit)
      .toArray();
  }
}
```

### 8.4 Mongoose Schema Enforcement

Mongoose models enforce field types at the ODM layer, providing a second defense:

```typescript
// If an attacker sends { "severity_id": { "$gt": 0 } },
// Mongoose will reject it because severity_id expects a Number, not an Object.
```

---

## 9. Secrets Management

### 9.1 Secrets Inventory

| Secret | Used By | Storage Method |
|---|---|---|
| `JWT_SECRET` | Backend (JWTService) | Environment variable |
| `DATABASE_URL` | Backend (Knex.js) | Environment variable |
| `MONGODB_URI` | Backend (Mongoose) | Environment variable |
| `REDIS_URL` | Backend (ioredis, BullMQ) | Environment variable |
| `BCRYPT_SALT_ROUNDS` | Backend (PasswordService) | Environment variable |
| `COLLECTOR_HMAC_SECRET` | Collector + Backend | Environment variable or secret file |
| `ADMIN_INITIAL_PASSWORD` | Backend (first-run seed) | Environment variable (one-time use) |

### 9.2 Secrets Architecture

```mermaid
graph TB
    subgraph SECRETS_ARCH["Secrets Management"]

        subgraph SOURCE["Secret Sources"]
            ENV[".env file<br/>(development only,<br/>never committed)"]
            DOCKER_SEC["Docker Secrets<br/>(docker-compose secrets)"]
            VAULT["HashiCorp Vault<br/>(future: post-MVP)"]
        end

        subgraph CONSUMERS["Secret Consumers"]
            BE_SEC["Backend<br/>(process.env.*)"]
            COL_SEC["Collector<br/>(environment or file)"]
            AI_SEC["AI Engine<br/>(no secrets needed)"]
        end

        subgraph PROTECTION["Protection"]
            GITIGNORE[".gitignore<br/>(.env, *.key, *.pem)"]
            ROTATION["Key Rotation<br/>(manual, documented)"]
            AUDIT_SEC["Audit Log<br/>(config changes logged)"]
        end
    end

    ENV --> BE_SEC
    DOCKER_SEC --> BE_SEC
    DOCKER_SEC --> COL_SEC
    GITIGNORE --> ENV
    ROTATION --> ENV

    style SOURCE fill:#3498db,color:#fff
    style PROTECTION fill:#e74c3c,color:#fff
```

### 9.3 Environment File Template

```env
# .env.example — Committed to git (NO real values)

# JWT
JWT_SECRET=CHANGE_ME_TO_A_RANDOM_64_CHAR_STRING
JWT_ACCESS_TOKEN_EXPIRY=1h
JWT_MAX_SESSION_DURATION=7d

# PostgreSQL
DATABASE_URL=postgresql://siem_app:CHANGE_ME@localhost:5432/siem_db

# MongoDB
MONGODB_URI=mongodb://localhost:27017/siem_events

# Redis
REDIS_URL=redis://localhost:6379

# Password Hashing
BCRYPT_SALT_ROUNDS=12

# Collector
COLLECTOR_HMAC_SECRET=CHANGE_ME_TO_A_RANDOM_64_CHAR_STRING
COLLECTOR_DIR=./collector

# Admin
ADMIN_INITIAL_PASSWORD=CHANGE_ME_ON_FIRST_LOGIN

# Frontend
FRONTEND_URL=http://localhost:3001

# Environment
NODE_ENV=development
```

### 9.4 Secret Protection Rules

| Rule | Implementation |
|---|---|
| Never commit secrets | `.env` in `.gitignore`. Pre-commit hook scans for secrets |
| Never log secrets | Logger filters `password`, `token`, `secret`, `key` from output |
| Never return secrets in API | API responses never include password hashes, JWT secrets, or DB credentials |
| Minimum secret length | JWT_SECRET and HMAC secrets must be ≥ 64 characters |
| Secret rotation | JWT_SECRET rotation invalidates all sessions (users must re-login) |

### 9.5 Secret Validation at Startup

```typescript
// config/validateSecrets.ts

function validateSecrets(): void {
  const required = [
    "JWT_SECRET",
    "DATABASE_URL",
    "MONGODB_URI",
    "REDIS_URL",
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required secret: ${key}`);
    }
  }

  if (process.env.JWT_SECRET!.length < 64) {
    throw new Error("JWT_SECRET must be at least 64 characters");
  }

  if (process.env.JWT_SECRET === "CHANGE_ME_TO_A_RANDOM_64_CHAR_STRING") {
    throw new Error("JWT_SECRET is still the default value. Generate a secure secret.");
  }

  if (process.env.NODE_ENV === "production" && !process.env.COLLECTOR_HMAC_SECRET) {
    throw new Error("COLLECTOR_HMAC_SECRET is required in production");
  }
}
```

---

## 10. Audit Logs

### 10.1 Audit Log Architecture

Every security-relevant action in the system is recorded in an **immutable audit trail**. Audit logs cannot be modified or deleted by any user, including admins.

```mermaid
graph TB
    subgraph AUDIT_ARCH["Audit Log Architecture"]

        subgraph SOURCES["Audit Event Sources"]
            AUTH_EVENTS["Authentication<br/>login, logout,<br/>failed login, session revoked"]
            INC_EVENTS["Incident Actions<br/>create, status change,<br/>assign, resolve, note"]
            RULE_EVENTS["Rule Actions<br/>create, update, delete,<br/>enable, disable, import"]
            USER_EVENTS["User Actions<br/>create, update,<br/>deactivate, password reset"]
            CONFIG_EVENTS["Config Actions<br/>setting changed"]
        end

        subgraph LOGGER["AuditLogger Service"]
            FORMAT["Format Entry<br/>(action, actor, target,<br/>details, timestamp)"]
            WRITE["Write to PostgreSQL<br/>(INSERT only — no UPDATE/DELETE)"]
        end

        subgraph STORAGE_A["PostgreSQL - audit.audit_logs"]
            PARTITIONED["Monthly Partitions<br/>(auto-created)"]
            RETENTION_A["2-year retention<br/>(partition drop)"]
        end
    end

    AUTH_EVENTS --> FORMAT
    INC_EVENTS --> FORMAT
    RULE_EVENTS --> FORMAT
    USER_EVENTS --> FORMAT
    CONFIG_EVENTS --> FORMAT
    FORMAT --> WRITE --> PARTITIONED

    style LOGGER fill:#3498db,color:#fff
```

### 10.2 Audit Event Types

| Action | Trigger | What Is Recorded |
|---|---|---|
| `login` | Successful login | Username, IP, user agent |
| `login_failed` | Failed login attempt | Username attempted, IP, reason |
| `logout` | User logout | Username, session ID |
| `session_revoked` | Admin revokes session | Admin who revoked, target user |
| `incident_create` | Correlator creates incident | Incident ID, title, severity, source |
| `incident_status_change` | Status changed | Incident ID, previous status, new status |
| `incident_assign` | Analyst assigned | Incident ID, assignee |
| `incident_resolve` | Incident resolved | Incident ID, resolution reason |
| `rule_create` | New rule created | Rule ID, name, severity, author |
| `rule_update` | Rule YAML updated | Rule ID, version, previous hash, new hash |
| `rule_delete` | Rule archived | Rule ID, name |
| `rule_enable` | Rule activated | Rule ID |
| `rule_disable` | Rule deactivated | Rule ID |
| `rule_import` | Bulk import | Count imported, count failed |
| `user_create` | New user created | User ID, username, role |
| `user_update` | User modified | User ID, changed fields |
| `user_deactivate` | User deactivated | User ID, admin who deactivated |
| `user_password_reset` | Password reset | User ID, admin who reset |
| `config_change` | Configuration changed | Key, previous value, new value, changed by |
| `collector_config_change` | Collector config updated | Collector ID, change details |

### 10.3 Audit Entry Structure

```json
{
  "id": "aud-a1b2c3d4",
  "action": "incident_status_change",
  "actorId": "usr-abc123",
  "actorUsername": "jsmith",
  "actorRole": "soc_analyst",
  "ipAddress": "10.0.0.50",
  "targetType": "incident",
  "targetId": "inc-0142",
  "targetName": "SSH Brute Force on web-server-01",
  "details": {
    "field": "status",
    "previousValue": "open",
    "newValue": "investigating"
  },
  "previousState": { "status": "open", "assignedTo": null },
  "newState": { "status": "investigating", "assignedTo": null },
  "createdAt": "2026-07-18T10:12:05Z",
  "orgId": "default"
}
```

### 10.4 Immutability Guarantees

| Guarantee | Implementation |
|---|---|
| **No UPDATE** | Application code only calls INSERT. No UPDATE queries exist for `audit.audit_logs` |
| **No DELETE** | DB user `siem_app` has INSERT + SELECT only on `audit` schema — no DELETE privilege |
| **No truncation** | `TRUNCATE` is not granted to `siem_app` |
| **Partition drop only** | Old partitions dropped by retention job after 2 years — never within retention window |
| **Tamper detection** | Each entry has a UUID v4 `id` and `created_at`. Gaps in sequence or time indicate tampering |

```sql
-- Audit schema permissions — INSERT and SELECT only
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA audit TO siem_app;
-- No UPDATE, DELETE, or TRUNCATE
```

### 10.5 AuditLogger Service

```typescript
// services/AuditLogger.ts

class AuditLogger {
  constructor(private readonly knex: Knex) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.knex("audit.audit_logs").insert({
      id: uuidv4(),
      action: entry.action,
      actor_id: entry.actorId,
      actor_username: entry.actorUsername,
      actor_role: entry.actorRole,
      ip_address: entry.ipAddress,
      target_type: entry.targetType,
      target_id: entry.targetId,
      target_name: entry.targetName,
      details: JSON.stringify(entry.details),
      previous_state: entry.previousState ? JSON.stringify(entry.previousState) : null,
      new_state: entry.newState ? JSON.stringify(entry.newState) : null,
      created_at: new Date(),
      org_id: entry.orgId || "default",
    });
  }
}

// Usage in RuleService:
// await this.auditLogger.log({
//   action: "rule_create",
//   actorId: userId,
//   actorUsername: user.username,
//   actorRole: user.role,
//   ipAddress: req.ip,
//   targetType: "rule",
//   targetId: newRule.id,
//   targetName: newRule.name,
//   details: { severity: newRule.severity, type: newRule.type },
// });
```

### 10.6 Audit Log Querying

Audit logs are queryable via the API (`GET /api/v1/audit`) with filters:

| Filter | Purpose |
|---|---|
| `action` | Show only specific action types (e.g., all `login_failed`) |
| `actorId` | All actions by a specific user |
| `targetType` + `targetId` | All actions on a specific incident or rule |
| `from` / `to` | Time range |
| `ipAddress` | All actions from a specific IP (useful for compromised account investigation) |

---

## Security Checklist Summary

| Category | Measure | Status |
|---|---|---|
| **Authentication** | JWT with httpOnly cookies | ✅ MVP |
| | Server-side session tracking (revocation) | ✅ MVP |
| | bcrypt password hashing (12 rounds) | ✅ MVP |
| | Account lockout after 5 failures | ✅ MVP |
| | Token auto-refresh | ✅ MVP |
| **Authorization** | RBAC with 3 roles | ✅ MVP |
| | Backend enforcement (middleware) | ✅ MVP |
| | Frontend UI filtering | ✅ MVP |
| **Rate Limiting** | Per-IP global limit | ✅ MVP |
| | Per-IP auth endpoint limit | ✅ MVP |
| | Per-user authenticated limit | ✅ MVP |
| | Per-user export/search limit | ✅ MVP |
| **Collector** | HMAC file signing | ✅ MVP |
| | Known collector validation | ✅ MVP |
| | Schema validation on ingestion | ✅ MVP |
| **API Security** | Security headers (helmet) | ✅ MVP |
| | CORS restricted to frontend origin | ✅ MVP |
| | HTTPS in production | ✅ MVP |
| | Internal API isolation (Docker network) | ✅ MVP |
| | Request size limits | ✅ MVP |
| **Input Validation** | Zod schema validation on all inputs | ✅ MVP |
| | XSS prevention (React escape + rehype-sanitize) | ✅ MVP |
| **SQL Injection** | Parameterized queries (Knex.js) | ✅ MVP |
| | Restricted DB user permissions | ✅ MVP |
| **NoSQL Injection** | express-mongo-sanitize | ✅ MVP |
| | String coercion of user input | ✅ MVP |
| | Mongoose schema enforcement | ✅ MVP |
| **Secrets** | Environment variables (never committed) | ✅ MVP |
| | Startup validation | ✅ MVP |
| | Docker secrets (production) | ✅ MVP |
| | HashiCorp Vault integration | ⏳ Post-MVP |
| **Audit** | Immutable audit trail (INSERT only) | ✅ MVP |
| | 20 audited action types | ✅ MVP |
| | Monthly partitioning, 2-year retention | ✅ MVP |

---

> **This document is governed by [ADR-001](file:///d:/AI%20SIEM/docs/architecture/decisions/ADR-001-modular-monolith.md). Security controls are enforced across all four processes: C++ Collector (file signing), Node.js Backend (JWT, RBAC, rate limiting, input validation, query safety, audit logging), Python AI Engine (network isolation), and Next.js Frontend (RBAC UI, XSS prevention, CSP headers).**
>
> **Document Version**: 1.0
> **Last Updated**: 2026-07-19

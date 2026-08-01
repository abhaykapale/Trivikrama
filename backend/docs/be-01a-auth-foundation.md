# BE-01A Authentication Foundation

BE-01A prepares the existing backend infrastructure for the later AuthService.
It does not implement authentication endpoints, JWT signing, password hashing,
Redis session caching, RBAC, or rate-limiter middleware.

## Database compatibility

The forward migration
`20260801000100_be_01a_auth_repository_compatibility.js` adds two values to the
existing `public.audit_action` enum:

- `login_failed`
- `session_revoked`

The migration verifies the existing DB-001 indexes for user lookup, active JWT
session lookup, expired-session cleanup, and audit filtering. It does not
recreate tables or replace the established indexes. Enum value removal would
require a destructive enum/table rewrite, so rollback is intentionally blocked
and documented as forward-only.

## Repository additions

The existing PostgreSQL repositories remain the only relational repository
pattern. BE-01A adds:

- User lookup by username and organization.
- Atomic failed-login count increments.
- Explicit reset, last-login, and lock-until operations.
- Active session lookup by JWT ID.
- Session creation alias for auth use cases.
- Active-only JWT ID rotation for later refresh replay protection.
- Audit action typing for failed login and session revocation.

All methods remain transaction-bindable through the existing repository
factory and `PostgresUnitOfWork`.

## Authentication configuration

Authentication configuration is validated by the central `src/config/env.ts`
loader. Required/default values are documented in `.env.example`:

- `JWT_SECRET` (minimum 64 characters; placeholders rejected)
- `JWT_ACCESS_TOKEN_EXPIRY=1h`
- `JWT_REFRESH_WINDOW=5m`
- `JWT_MAX_SESSION_DURATION=7d`
- `JWT_ISSUER=ai-siem`
- `JWT_COOKIE_NAME=siem_token`
- `JWT_COOKIE_SECURE=false` in development and `true` in production
- `BCRYPT_ROUNDS=12`
- `AUTH_LOCKOUT_ATTEMPTS=5`
- `AUTH_LOCKOUT_MINUTES=15`
- `AUTH_RATE_LIMIT_PER_MINUTE=10`

Production startup also requires an explicitly supplied `FRONTEND_URL` CORS
origin. Configuration errors identify invalid fields without echoing secret
values, and the shared logger redacts sensitive metadata and credential-bearing
URLs.

## Transaction readiness

The existing Unit of Work supplies transaction-bound user, session, and audit
repositories. Later authentication services can therefore execute successful
and failed login write sets atomically. Any exception inside the Unit of Work
callback rolls the complete write set back.

## Validation commands

```bash
npm run typecheck
npm run typecheck:be01a-tests
npm run test:migration:be01a
npm run test:auth-config
ALLOW_BE01A_INTEGRATION_TESTS=true npm run test:repositories:be01a
```

Run the repository integration suite only against a migrated non-production
PostgreSQL database. The suite intentionally leaves its audit rows in place
because `audit.audit_logs` is append-only; all test audit records use a unique
organization identifier.

PostgreSQL remains the durable authority for users, sessions, and audit logs.
`ISessionCache` is only a future cache port and has no BE-01A implementation.

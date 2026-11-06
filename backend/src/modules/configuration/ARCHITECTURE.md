# Configuration Management Module

CONFIG-01A exposes global system configuration through `GET /api/v1/config`
and `PUT /api/v1/config/:key`. Configuration is intentionally system-wide
because `public.configuration` has no organization column; actor organization
is recorded only on the immutable audit event.

## Security boundary

- Authentication precedes every operation. Only Admin may list configuration
  or update general keys. Security Engineer may update only
  `ai.anomaly_threshold`; SOC Analyst has no configuration permission.
- List queries always force `includeSensitive: false` and return at most 100
  rows. API DTOs omit database IDs, updater identity, and creation metadata.
- Command reads conceal absent or sensitive records through the same not-found
  result. No API path returns or mutates a sensitive value.
- Keys use a strict dotted-name grammar. Bodies are strict JSON objects with a
  single JSON value bounded to 32 KiB.
- A fail-closed policy registry defines the type and range for each seeded,
  API-managed key. Unknown keys cannot be created or modified through this API.
- Responses use `Cache-Control: private, no-store`.

## Transaction behavior

Updates run in retrying SERIALIZABLE PostgreSQL transactions with bounded
statement and lock timeouts. The repository locks the selected key, repeats
the key predicate on update, and commits the new value and `config_change`
audit row together. Replaying the current value returns success without an
unnecessary write or duplicate audit event.

The API persists configuration values but does not promise runtime hot reload.
Consumers that currently read process environment settings continue to apply
their existing restart/reload semantics.

## Components

- `application/configuration-value.policy.ts`: key allowlist and value domains.
- `application/list-configuration.use-case.ts`: bounded non-sensitive query.
- `application/update-configuration.use-case.ts`: lock, replay detection,
  mutation, and immutable audit orchestration.
- `infrastructure/postgres-configuration-command-unit-of-work.ts`: retrying
  SERIALIZABLE transaction adapter.
- `http/configuration.routes.ts`: authentication, dynamic RBAC, validation,
  stable errors, and cache policy.
- `http/configuration.openapi.yaml`: external contract.

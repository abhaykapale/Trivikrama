# Audit Investigation Module

AUDIT-01A exposes the existing immutable PostgreSQL audit trail through one
read-only investigation endpoint: `GET /api/v1/audit`.

## Security boundary

- Authentication runs before `audit.view`; only Admin and Security Engineer
  roles hold that permission.
- `orgId` is accepted only from the verified authentication principal. Client
  query values cannot select another organization.
- Every SQL statement repeats the tenant and time predicates and uses bound
  values for filters, pagination, and counts. Sort fields and directions map
  through fixed allowlists.
- Responses omit `org_id`, `previous_state`, and `new_state`. The documented
  investigation DTO contains identity, action, actor, IP, target, safe event
  details, and timestamp only.
- Responses use `Cache-Control: private, no-store`.

## Query behavior

The default range is the 24 hours preceding `to` (or the current time). An
explicit range cannot exceed the audit trail's two-year retention horizon.
Pages contain at most 100 entries and expose total/page metadata. Filters cover
action, actor UUID, target type and ID, source IP, and timestamps.

## Storage

The module never updates or deletes audit rows. Database triggers and runtime
grants continue to enforce immutability independently of this API.
`20261028000100_audit_investigation_indexes.js` adds tenant-first indexes for
time, action, actor, target, and IP investigations on the partitioned parent.

## Components

- `application/list-audit-logs.use-case.ts`: default window, retention bound,
  offset calculation, and API pagination.
- `infrastructure/postgres-audit-query.repository.ts`: parameterized,
  tenant-scoped list and count queries with a safe projection.
- `http/audit-query.routes.ts`: authentication, RBAC, validation, cache policy,
  and stable errors.
- `http/audit-query.openapi.yaml`: external contract.

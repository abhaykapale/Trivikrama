# Asset Inventory Module

ASSET-01A exposes the PostgreSQL asset registry through tenant-scoped query and transactional command boundaries.

## HTTP surface

- `GET /api/v1/assets` and `GET /api/v1/assets/:id`: every authenticated role with `assets.view`.
- `POST /api/v1/assets` and `PUT /api/v1/assets/:id`: Admin and Security Engineer.
- `DELETE /api/v1/assets/:id`: Admin only; this is an idempotent soft deactivation.

All organization identity comes from the authenticated principal. Request query strings and bodies cannot select an organization.

## Transaction boundary

Create, update, and deactivation run through `PostgresAssetCommandUnitOfWork` using retrying SERIALIZABLE transactions. Update and deactivation lock the tenant-owned row first and repeat the `org_id` predicate on the write. Each real mutation commits with an immutable `asset_create`, `asset_update`, or `asset_delete` audit event. Audit snapshots deliberately omit the free-form metadata object.

## Query boundary

List queries require `org_id`, use bounded offset pagination, and support allowlisted type, active-state, and literal asset identity search fields. Detail queries use `findByIdForOrg`; an absent or cross-tenant asset produces the same `404 RESOURCE_NOT_FOUND` response. List DTOs omit metadata, while detail DTOs expose it without `orgId`.

## Components

- `domain/asset.contracts.ts`: public DTOs, commands, transaction ports, and mapping.
- `application/`: list/detail and transactional create/update/deactivate use cases.
- `infrastructure/postgres-asset-command-unit-of-work.ts`: transaction adapter.
- `http/asset.routes.ts`: authentication, RBAC, validation, and stable errors.
- `composition/asset.dependencies.ts`: module wiring.

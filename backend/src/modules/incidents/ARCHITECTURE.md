# Incidents Module

## Responsibility

This module owns the incident-domain vocabulary that will be shared by alert
merging, correlation, risk scoring, persistence, and incident-management APIs.
INC-01A provides the typed persistence foundation. INC-01B adds the boundary
that merges persisted rule detections and AI inference results into one alert
contract and removes replay duplicates. INC-01C extracts normalized OCSF
entities and selects an existing incident using tenant, entity, rolling-window,
and maximum-duration rules. INC-01D adds deterministic composite risk scoring,
severity classification, and tenant-scoped asset criticality resolution.
INC-01E adds transactional creation/update, alert and event linkage, audit
records, replay protection, and production-worker integration.
INC-01F adds a transactional PostgreSQL notification outbox, lease-based
concurrent dispatch, bounded retry/dead-letter handling, and Redis-side
publish deduplication for real-time incident channels.
INC-02A adds authenticated, RBAC-protected incident list/detail reads with
tenant isolation, validated filters, deterministic pagination, and indexed
PostgreSQL query paths.
INC-02B adds the authenticated incident timeline endpoint, merging PostgreSQL
events, alerts, and audit actions into a deterministic chronological page and
enriching only that page with tenant-verified MongoDB event messages.
INC-02C adds separate paginated alert and linked-event endpoints. PostgreSQL
remains authoritative for incident membership and ordering; MongoDB supplies
normalized event content only after exact organization verification.

## Current structure

- `domain/incident.contracts.ts` defines lifecycle, severity, source, entity,
  kill-chain, score-breakdown, and correlation-candidate contracts.
- `domain/incident-entity.ts` normalizes and validates entity identities at the
  domain boundary.
- `domain/unified-alert.contracts.ts` defines the common rule/AI alert shape and
  structural source boundaries.
- `application/unified-alert-merger.ts` converts PostgreSQL rule alerts and
  anomalous MongoDB AI results into the common shape.
- `application/unified-alert-id.ts` derives replay-stable UUIDv8 identities for
  AI anomalies.
- `application/unified-alert-deduplicator.ts` computes deterministic SHA-256
  deduplication keys and rejects identity collisions.
- `application/unified-alert-entity-extractor.ts` joins alert event IDs to
  normalized OCSF events and attaches normalized correlation entities.
- `application/incident-candidate-ranker.ts` queries eligible PostgreSQL
  candidates, enforces the 15-minute/24-hour limits, and ranks matches.
- `application/incident-risk-scorer.ts` computes the five-factor risk score,
  produces its audit breakdown, and maps the result to incident severity.
- `infrastructure/repository-asset-criticality-resolver.ts` adapts the existing
  asset repository to the scoring port without exposing SQL to domain logic.
- `application/transactional-incident-correlator.ts` owns the complete atomic
  create/update/replay flow.
- `infrastructure/postgres-incident-correlation-unit-of-work.ts` binds that flow
  to retrying SERIALIZABLE PostgreSQL transactions.
- `application/incident-notification.ts` creates deterministic notification
  identities and the documented dashboard payload.
- `application/incident-notification-dispatcher.ts` leases pending rows and
  applies bounded retry/dead-letter policy.
- `infrastructure/redis-incident-notification.publisher.ts` atomically guards
  Redis Pub/Sub publication with a stable deduplication marker.
- `infrastructure/incident-notification-dispatcher.runner.ts` polls without
  overlapping batches and drains safely during worker shutdown.
- `domain/incident-query.contracts.ts` owns the read-model port, list filters,
  safe sort vocabulary, and API pagination shape.
- `application/list-incidents.use-case.ts` derives stable pagination metadata;
  `application/get-incident-detail.use-case.ts` performs the tenant-scoped
  aggregate lookup.
- `infrastructure/postgres-incident-query.repository.ts` implements the read
  port with parameterized Knex queries, an explicit sort allowlist, and an
  `org_id` predicate on every query.
- `domain/incident-timeline.contracts.ts` defines the event, alert, and action
  timeline variants and the timeline persistence port.
- `application/get-incident-timeline.use-case.ts` verifies incident visibility,
  derives pagination metadata, and enriches page-local event rows from MongoDB.
- `infrastructure/postgres-incident-timeline.repository.ts` merges and paginates
  tenant-scoped event links, alerts, and audit actions in PostgreSQL.
- `domain/incident-evidence.contracts.ts` owns the alert/event query ports and
  the public evidence DTOs.
- `application/list-incident-alerts.use-case.ts` and
  `application/list-incident-events.use-case.ts` verify incident visibility and
  construct stable pagination results.
- `infrastructure/postgres-incident-evidence-query.repository.ts` applies the
  incident and organization predicates to alert rows and event-link pages.
- `composition/incident-query.dependencies.ts` constructs the repository and
  injects it into both use cases.
- `http/incident-query.routes.ts` authenticates, authorizes, validates, and
  maps `/api/v1/incidents` requests to the application layer.
- `index.ts` is the public module export surface.

PostgreSQL remains the authoritative incident store. The existing
`PostgresIncidentRepository` implements persistence and now exposes a
tenant-scoped `findOpenCandidates()` lookup for the future correlator.

```mermaid
flowchart TD
    Rule["PostgreSQL rule alerts"]
    AI["MongoDB AI results"]
    Merge["UnifiedAlertMerger"]
    Dedup["UnifiedAlertDeduplicator"]
    Extract["OCSF entity extractor"]
    Rank["Candidate selector and ranker"]
    Score["Risk scorer"]
    Persist["Transactional persistence"]
    Contract["Incident domain contracts"]
    Normalize["Entity normalization"]
    Repository["PostgresIncidentRepository"]
    Database[("PostgreSQL incidents")]
    Outbox[("PostgreSQL outbox")]
    Dispatch["Outbox dispatcher"]
    Redis[("Redis Pub/Sub")]
    HTTP["Incident query routes"]
    QueryUseCases["List/detail use cases"]
    QueryRepository["PostgreSQL query repository"]

    Rule --> Merge
    AI --> Merge
    Merge --> Dedup
    Dedup --> Extract
    Extract --> Rank
    Rank --> Score
    Score --> Persist
    Persist --> Contract
    Persist --> Normalize
    Persist --> Repository
    Repository --> Normalize
    Repository --> Database
    Persist --> Outbox
    Outbox --> Dispatch
    Dispatch --> Redis
    HTTP --> QueryUseCases
    QueryUseCases --> QueryRepository
    QueryRepository --> Database
```

## INC-02A query flow

```mermaid
sequenceDiagram
    participant Client
    participant Router as createIncidentQueryRouter
    participant Auth as JWT + RBAC middleware
    participant UseCase as List/Get use case
    participant QueryRepo as PostgresIncidentQueryRepository
    participant PG as PostgreSQL

    Client->>Router: GET /api/v1/incidents...
    Router->>Auth: authenticateRequest + incidents.view
    Auth-->>Router: principal with orgId
    Router->>Router: Zod validation and allowlists
    Router->>UseCase: filters + trusted orgId
    UseCase->>QueryRepo: tenant-scoped query
    QueryRepo->>PG: parameterized SELECT/COUNT
    PG-->>QueryRepo: incident rows
    QueryRepo-->>UseCase: read models + total
    UseCase-->>Client: DTO + pagination
```

## Query security and scalability invariants

- The request cannot supply or override `orgId`; it comes only from the
  authenticated principal.
- List and detail SQL always include `org_id`. A missing or cross-tenant ID is
  indistinguishable and returns `RESOURCE_NOT_FOUND`.
- All three documented roles receive `incidents.view`; the route still enforces
  the permission explicitly so later roles fail closed.
- Status, severity, source, sort field, and order are allowlisted before the
  repository is called. Page size is capped at 100.
- Search text is parameterized and escapes SQL wildcard characters.
- Sorts include incident ID as a deterministic tie-breaker.
- Alerts, events, and timeline collections remain separate paginated endpoints;
  the detail read cannot grow without bound as an incident accumulates data.
- Tenant/sort B-tree indexes and trigram search indexes are created by the
  INC-02A migration.

## INC-02B timeline flow

```mermaid
flowchart TD
    HTTP["GET incident timeline"] --> Guard["JWT, RBAC, validation"]
    Guard --> Exists["Tenant-scoped incident lookup"]
    Exists --> Union["PostgreSQL timeline UNION"]
    Union --> Page["Chronological SQL page"]
    Page --> Mongo["Tenant-verified Mongo enrichment"]
    Mongo --> Response["Timeline DTO + pagination"]
```

## Timeline security and scalability invariants

- Incident visibility and every PostgreSQL timeline branch are constrained by
  the authenticated principal's organization ID.
- A missing and a cross-tenant incident both return `RESOURCE_NOT_FOUND` before
  timeline sources are queried.
- Type and date filters are bound parameters; page size is capped at 100.
- The merged SQL result is ordered by timestamp, entry type, and stable entry
  ID before offset pagination, so equal timestamps cannot reorder between calls.
- PostgreSQL paginates before MongoDB enrichment. Only event IDs present on the
  selected page are requested from MongoDB.
- A MongoDB normalized event contributes its message only when its `org_id`
  exactly matches the authenticated organization; absent or mismatched records
  produce a null message.
- Timeline reads use existing incident/time indexes and never load an
  incident's unbounded history into application memory.

## INC-02C evidence query flow

```mermaid
flowchart TD
    HTTP["GET incident alerts or events"] --> Guard["JWT, incidents.view, validation"]
    Guard --> Exists["Tenant-scoped incident lookup"]
    Exists --> PG["Tenant-scoped PostgreSQL page"]
    PG --> Alerts["Alert DTO page"]
    PG --> Mongo["Linked event IDs only"]
    Mongo --> Verify["Exact Mongo org_id check"]
    Verify --> Events["Normalized event DTO page"]
```

## Evidence query security and scalability invariants

- The organization identifier always comes from the authenticated principal;
  query-string attempts to supply another organization are discarded.
- Incident existence is verified before evidence access. Missing and
  cross-tenant incidents both return `RESOURCE_NOT_FOUND`.
- Alert SQL constrains both the alert row and joined incident by organization,
  preventing an inconsistent foreign alert from being exposed.
- Event membership, order, offset, and count come from tenant-scoped
  PostgreSQL `incident_events`; MongoDB is queried only for IDs on that page.
- MongoDB documents fail closed unless `org_id` exactly matches the principal.
  Missing or mismatched documents are omitted and never replaced with foreign
  content; pagination totals continue to describe authoritative PostgreSQL
  links so cross-store integrity gaps remain observable operationally.
- Page sizes are capped at 100. Alerts use stable newest-first ordering; linked
  events use stable chronological ordering.

## Persistence invariants

- Incident candidate queries always require an organization identifier.
- Only `open` and `investigating` incidents can be correlation candidates.
- Candidates must have activity inside the caller-provided window.
- Primary entity value and type are either both present or both absent.
- Entity and kill-chain JSONB values are arrays; score breakdown is an object.
- The correlation index starts with `org_id` to preserve the tenant boundary.

MongoDB continues to store normalized events and AI results. Incident records
and lifecycle state are stored in PostgreSQL as required by the SRS.

## Unified-alert invariants

- The caller supplies one organization and every source record must match it.
- Only AI results with `is_anomaly=true` become unified alerts.
- Rule and AI alerts remain distinct even when they reference the same event.
- Rule deduplication identity is rule ID plus sorted matched-event IDs.
- AI deduplication identity is model name, model version, and event ID.
- AI alert IDs are deterministic UUIDv8 values, making retries replay-safe.
- Conflicting security content under the same deduplication identity is rejected.

## Correlation matching invariants

- Alert and normalized-event organization IDs must match the requested tenant.
- OCSF users, hosts, and IP addresses are normalized before comparison.
- Only configured entity types participate in candidate lookup and ranking.
- Candidate status must be `open` or `investigating`.
- Activity at exactly 15 minutes is eligible; anything later is excluded.
- An incident at exactly 24 hours is expired and cannot receive another alert.
- Ranking order is entity overlap, recent activity, matching source, creation
  time, then incident ID for a deterministic final tie-break.

## Risk-scoring invariants

- The authoritative weights are `0.30/0.25/0.20/0.15/0.10` and must sum to 1.
- Missing rule, trustworthy AI, and asset signals use the neutral value `0.5`.
- AI fallback results do not count as observed ML confidence.
- Kill-chain scoring contributes zero while the feature is disabled.
- Alert density saturates at 20 alerts by default.
- Scores are rounded to two decimal places and classified at 20/40/60/80.
- Duplicate alerts and cross-tenant inputs fail closed before scoring.

## Transactional correlation invariants

- Candidate selection uses row locks inside a retrying SERIALIZABLE transaction.
- Alerts can only transition from unassigned to one incident; reassignment is rejected.
- AI and rule alerts use stable IDs and idempotent inserts.
- Incident-event links use the database uniqueness identity and conflict-safe inserts.
- Replayed alerts short-circuit without changing counts, links, risk, or audit history.
- Incident updates, event links, alert attachment, scoring, and audit writes commit or roll back together.
- Incidents are capped at 500 alerts; overflow begins a new incident.

## Notification outbox invariants

- Incident, audit, and notification-outbox writes share one PostgreSQL transaction.
- Notification IDs and deduplication keys are deterministic per incident event and causation ID.
- Replayed alerts cannot create another outbox row.
- Claiming uses expiring leases and `FOR UPDATE SKIP LOCKED` semantics.
- Redis publication and its deduplication marker execute in one Lua script.
- A crash after Redis publication but before PostgreSQL acknowledgement does not republish while the marker exists.
- Failed rows use bounded exponential backoff and become `dead_letter` after eight attempts.
- Payloads contain the tenant ID so the WebSocket layer can enforce organization routing.

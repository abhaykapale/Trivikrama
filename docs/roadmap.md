# Trivikrama — Current-to-Target Implementation Roadmap

**Assessment date:** 2026-08-29  
**Current-state evidence:** `PROJECT.zip` extracted to the review workspace  
**Target-state evidence:** ADR-001, HLD, SRS, Backend, Detection, Database, API, Security, Incident, Rule Engine, Scaling, Deployment, Frontend, AI Engine, `collector.md` (COLLECTOR-001), and the later Collector Architecture Review.

## Review method and confidence

This is a mid-project assessment, not a greenfield plan. Status is based on executable source paths and composition, not on names, interfaces, migrations, generated `dist` files, or documentation alone.

The archive intentionally does not include `node_modules`, so an independent `npm run typecheck` could not run (`tsc: not found`). This is reported as a validation limitation, **not** as a TypeScript failure. Static checks did confirm the repository structure, runtime composition, route registration, package scripts, emitted artifact layout, migration/repository surfaces, and test inventory.

**Interpretation order for target decisions:** ADR-001 is frozen; the SRS defines functional intent; supporting design documents, including `collector.md` (COLLECTOR-001), define detail. The later Collector Architecture Review corrects Collector assumptions, but it explicitly marks the central transport and signed envelope decisions as approval-gated. Those decisions must be made before Collector or ingestion code is written.

---

## 1. Executive Architecture Assessment

### Overall assessment

The codebase is a sound **platform foundation**, not yet a functioning SIEM. The implemented runtime is an Express application for database health, human authentication, and administrator user management. It initializes PostgreSQL, MongoDB, and Redis and contains a relatively mature persistence layer, but the runtime does not compose the Mongo repositories or any SIEM module.

| Dimension | Rating | Evidence-based assessment |
|---|---:|---|
| Architecture foundation | 5/10 | Dependency injection, a PostgreSQL unit of work, database lifecycle, migrations, repositories, JWT/RBAC, structured logging, and shutdown handling exist. Repository-port placement does not fully follow the frozen modular-monolith boundary. |
| Implemented product capability | 2/10 | Health, auth, and all six user-management routes exist. No source code exists for collector, ingestion, processing, detection, incidents, dashboard, WebSocket, AI, or frontend. |
| Reliability | 3/10 | DB startup/shutdown and transaction retries are implemented. The required durable handoff, queue retry/DLQ, idempotent pipeline, and restart recovery do not exist. |
| Security | 5/10 | Human auth has strong baseline controls. The machine-to-machine/file trust boundary, audit coverage for SIEM actions, TLS deployment, and secret delivery are absent. |
| Production readiness | 1/10 | No Docker/Compose/CI/infrastructure exists, and package production scripts target files that the current compiler does not emit. |

### Authorization decision

Do **not** rewrite auth, user management, migrations, or repositories. Preserve the working foundation. Complete the missing vertical pipeline around it, while repairing only the specific defects listed below. The first source change should stabilize build/run/test scripts; the first architecture prerequisite for ingestion is the approval and codification of the Collector batch/heartbeat contract.

---

## 2. Current Architecture

### Components actually composed at runtime

| Component | Actual responsibility | Status |
|---|---|---|
| Bootstrap — `backend/src/main.ts` | Validates config, connects PostgreSQL/MongoDB/Redis, creates PostgreSQL repositories/UoW, composes auth and users, starts Express, and coordinates graceful shutdown. | **MOSTLY COMPLETE** |
| Express app — `backend/src/app.ts` | Applies Helmet, CORS, body parsing, CSRF; mounts `/health`, `/api/v1/auth`, and `/api/v1/users`; installs error middleware. | **MOSTLY COMPLETE** |
| Auth module | Login/logout/refresh/me, bcrypt, signed JWT, PostgreSQL session revocation, account lockout, Redis login rate limiting, cookie/CSRF protection, and RBAC. | **MOSTLY COMPLETE** |
| Users module | Admin-only list/get/create/update/deactivate/reset-password with Zod validation, PostgreSQL transactions, and audit rows for create/update/reset. | **MOSTLY COMPLETE** |
| Database foundation | PostgreSQL Knex client/migrations, MongoDB bootstrap/validators/indexes, Redis client, health checks, seeds, maintenance scripts, and transaction retry support. | **MOSTLY COMPLETE** |
| Persistence repositories | PostgreSQL repositories for rules/incidents/alerts/assets/configuration/monitoring/etc.; Mongo repositories for raw batches, normalized events, and AI results. | **PARTIAL** — implemented but almost entirely unused by application runtime |
| Logging/health/shutdown | Winston logging/redaction, database health, and ordered shutdown of HTTP and DB clients. | **PARTIAL** — no request correlation, metrics, readiness split, queue/worker lifecycle, or tracing |

### Actual dependencies and runtime flow

```text
HTTP request
  → security middleware
  → health OR auth/users router
  → auth middleware / RBAC where required
  → application use case
  → module adapter
  → PostgreSQL repository / unit of work
  → JSON response or common error middleware

Startup
  → validate environment
  → connect PostgreSQL + MongoDB + Redis concurrently
  → create PostgreSQL repositories and UoW
  → compose Auth + Users only
  → listen for HTTP
```

The Mongo client is connected but `createMongoRepositories(...)` is never called by `main.ts`; Mongo repositories only appear in smoke/integration tooling. The PostgreSQL factory constructs repositories for future modules, but only users, sessions, and audit are injected into live use cases.

### Persistence actually present

- PostgreSQL migrations create users, sessions, audit, rules, alerts, incidents, incident events/notes, assets, configuration, collector status, queue metrics, and related indexes/constraints.
- Mongo bootstrap defines validators, TTL/indexes, and unique identifiers for `raw_events_archive.batch_id` and `normalized_events.event_id`.
- Redis is currently used for auth login rate limiting only; it is not a queue, pub/sub channel, session store, feature cache, or WebSocket dependency.

### Failure and deployment flow now

- Database connection failure prevents server startup and attempts deterministic cleanup.
- PostgreSQL unit-of-work retries retryable transaction errors with bounded exponential backoff.
- Request failures pass to common error middleware except the user-list handler, which sends a generic `500` itself and bypasses central logging/error mapping.
- No watcher, worker, queue, quarantine, recovery, or dependency fallback exists.
- The archive has no Dockerfile, Compose file, CI definition, frontend, collector, AI source, deployment configuration, or infrastructure directory.

---

## 3. Target Architecture

### Required by specification

ADR-001 requires a modular monolith with four processes:

```text
Central/endpoint log inputs
  → C++ Collector
  → signed, atomic OCSF batch + heartbeat files on shared handoff volume
  → Node/Express backend watcher
  → IProcessingQueue / BullMQ / workers
  → parse → validate/normalize → feature extraction
  → Sigma-compatible rules + HTTP AI inference
  → incident correlation + risk scoring
  → PostgreSQL/MongoDB + Redis Pub/Sub
  → REST/WebSocket API
  → Next.js SOC dashboard
```

The required data split is PostgreSQL for relational operational data, MongoDB for raw/normalized/AI documents, and Redis for BullMQ, feature/counter state, rate limiting, and Pub/Sub. The MVP is single organization; `org_id` is a forward-compatible reservation, not a multi-tenant product requirement.

Required reliability properties include atomic collector publication, persistent queue retry/DLQ, no data loss through restart, rule-only processing if AI is unavailable, and no claim of exactly-once delivery. The later Collector review refines the correct guarantee to **at-least-once delivery with idempotent batch/event persistence**.

### Architectural recommendation, supported by the later Collector review

The Collector should receive already-forwarded data through explicitly selected central ingress adapters. It must preserve source identity, publish only sealed uniquely identified batches, sign both batches and heartbeats, and advance read checkpoints only after durable publication. The backend must reject unknown collector identities/invalid signatures before queueing, archive a batch idempotently, and use stable event identities on replay.

This is consistent with ADR-001's file handoff. It does **not** authorize a new direct Collector-to-backend ingestion API or a message broker.

---

## 4. Current Implementation Inventory

| Domain | Current implementation | Target | Status |
|---|---|---|---|
| Auth/RBAC | JWT, bcrypt-12, session revocation in PostgreSQL, account lockout, CSRF, login rate limit, admin user permission | All human API/dashboard auth, audited actions | **MOSTLY COMPLETE** |
| User administration | Six documented user routes are mounted and covered by focused tests | Admin user management | **MOSTLY COMPLETE** |
| Database lifecycle/migrations | PostgreSQL/MongoDB/Redis lifecycle, migration/seed/bootstrap/maintenance tooling, repo factories, UoW | All data stores backing product modules | **MOSTLY COMPLETE** foundation |
| Data repositories | Repositories and schemas for target entities | Application/domain ownership and real workflows | **PARTIAL** |
| Collector | Empty directory only | C++20 central Collector, durable outbox, approved ingress adapters | **MISSING** |
| File ingestion | `COLLECTOR_DIR` and HMAC configuration only | Watch, claim, verify, queue, quarantine, recovery | **MISSING** |
| Queue/workers | No queue dependency or worker directory | `IProcessingQueue`, BullMQ, retry/backoff/DLQ, worker pool | **MISSING** |
| Parsing/normalization/features | Mongo document shape exists | OCSF validation, enrichment, stable IDs, feature extraction | **MISSING** |
| Rules | Rule tables/repository/seed only | Sigma YAML validation/compile/cache/evaluation/CRUD/hot reload | **SCAFFOLD** |
| AI | URL/timeout/batch/threshold config and Mongo AI repository only | FastAPI model service and resilient Node client | **SCAFFOLD** |
| Correlation/risk | PostgreSQL incident/alert repositories only | entity/window correlation and an approved scoring algorithm | **SCAFFOLD** |
| Incident operations | Persistence primitives only | lifecycle, assignment, notes, investigation endpoints | **SCAFFOLD** |
| Event investigation | Mongo queries/repositories only | secure event search/detail/export and incident joins | **SCAFFOLD** |
| Dashboard/real-time | No code | REST aggregations, Redis Pub/Sub, WebSocket, Next.js UI | **MISSING** |
| Collector monitoring | Repository/table only | signed heartbeat consumption, queue/file status and APIs/UI | **SCAFFOLD** |
| Observability | structured logs/redaction and DB health | metrics, tracing, request IDs, dashboards, alerts | **PARTIAL** |
| Deployment/CI | none | Docker Compose, health checks, migrations, CI, rollback/backup practice | **MISSING** |

### Confirmed implementation defects

1. **BROKEN production artifact paths.** `tsconfig.json` emits `dist/src/main.js` and `dist/src/scripts/*`, but `package.json` uses `dist/main.js` and `dist/scripts/*` for `start` and every `*:prod` command. The documented Docker command has the same wrong path.
2. **BROKEN aggregate test script.** `test:stb003` references `tests/unit/shared/http-contracts.test.ts`; the archive contains `http-contract.test.ts`.
3. **INCORRECT health contract alignment.** Runtime exposes `/health`, whereas ADR/HLD/deployment expect `/api/v1/health`; SRS itself says `/health`. Current deployment health checks would fail against the runtime.
4. **TECHNICAL DEBT in user paging/error behavior.** User list schemas impose no `limit <= 100` despite the API contract's maximum. `handleListUsers` turns every non-validation error into an unlogged direct 500 response instead of passing it to error middleware.
5. **POTENTIAL secret exposure.** `.env` is ignored by git but is included in the supplied project archive. Treat all non-placeholder secrets in that file as exposed to any archive recipient; rotate them and exclude it from future packaged artifacts.

---

## 5. Architecture & Implementation Gap Analysis

| Domain | Current state | Target state | What must change / why | Priority | Dependency |
|---|---|---|---|---|---|
| Runtime delivery | Scripts cannot locate compiled entrypoints; aggregate test script is stale | Runnable compiled service and reliable verification commands | Correct package paths (or deliberately change compiler layout); add artifact smoke test | P0 | None |
| Collector boundary | No contract/code; source documents conflict on central vs endpoint-local input | Approved signed batch/heartbeat schema with source/collector identity | Freeze contract and fixtures before watcher/collector code to prevent incompatible handoff | P0 | External architecture approval |
| Ingestion | Config only | Atomic file claim, signature/version/size validation, quarantine, durable enqueue | Add isolated ingestion module and strict filesystem trust boundary | P0 | Contract |
| Queue/worker | No BullMQ/chokidar/worker dependencies | Persistent queue with retries, backoff, DLQ and shutdown recovery | Define port in module domain and implement BullMQ adapter; do not hand-roll a queue | P0 | Contract and ingestion job schema |
| Event processing | Mongo models only | parse, OCSF validation, normalization, stable IDs, features | Implement ordered idempotent stages; preserve invalid evidence/quarantine | P0 | Queue |
| Detection | Rule persistence/seed only; no AI service | compiled rules, state in Redis, AI HTTP fallback | Build rules and AI independently against stable feature/alert contracts | P1 | Event/feature contract |
| Correlation | Incident/alert persistence only | entity/window grouping and risk scoring | Implement after alerts; resolve contradictory formula first | P1 | Rule/AI alert contract + scoring decision |
| Product APIs | 11 active routes for health/auth/users only | operational incident/rule/event/asset/audit/config/collector/dashboard APIs | Add vertical modules, not thin repository controllers | P1 | Domain flows |
| Real-time/UI | No source | Redis Pub/Sub/WebSocket and Next.js dashboard | Add only after API/event contracts are stable | P2 | Incident/monitoring APIs |
| Security | Good human boundary; no collector integrity or broad API controls | signed machine boundary, TLS deployment, audit coverage, secure config | Add HMAC verification/identity provisioning; apply endpoint-aware rate limits and audit | P0/P1 | Contract + API modules |
| Operability | logs and DB health only | metrics, traces, health/readiness, queue/file visibility | Instrument from the first ingestion slice rather than after pipeline completion | P1 | Queue/worker |
| Scalability | DB indexes/pools exist; no throughput path | 1,000 EPS / 4 workers and <30 s pipeline target | Benchmark real pipeline; bounded batches/concurrency; do not optimize before measurement | P2 | Working pipeline |
| Deployment | No Docker/CI; current prod paths broken | Compose stack, migration bootstrap, monitoring, smoke/rollback | Build deployment after all four processes are runnable; exercise in CI before production | P1/P2 | BLD-01 + services |
| Documentation | Several authoritative documents disagree | One approved executable specification | Update decisions rather than silently coding one interpretation | P0/P1 | Architecture decisions |

---

## 6. Documentation vs Code Conflicts

| Area | Specification | Current implementation | Conflict | Architectural decision |
|---|---|---|---|---|
| Collector ingress | HLD/SRS describe local syslog/file/ETW/HTTP collectors; `Finalcollector` states existing forwarding lands at a **central** Collector and transport determines the reader | No Collector code | Material, implementation-blocking | **REQUIRES DECISION.** Approve central ingress transport(s) and endpoint identity semantics. Amend HLD/SRS/Collector spec; retain ADR file handoff. |
| Batch/heartbeat security | HMAC secret configured; later review requires signed envelope, pre-provisioned collector ID, stable batch/event IDs | `COLLECTOR_HMAC_SECRET` is validated but never used | Required security/reliability behavior absent | **Modify code after ARCH-01.** Versioned signed contract and contract fixtures are mandatory. |
| Session store | ADR/HLD call Redis a session store; Security/DB design and code use PostgreSQL `sessions` | PostgreSQL is used for session lookup/revocation; Redis is rate-limit only | Target contradiction | **Preserve implementation.** Treat PostgreSQL as authoritative session store; update ADR/HLD wording to Redis for queue/rate-limit/PubSub/feature state. |
| Token default | SRS NFR-303 says 8 hours; Security/API/config say 1 hour | `JWT_ACCESS_TOKEN_EXPIRY` defaults to `1h` | Target contradiction | **Preserve 1 hour** and update SRS, unless product owner deliberately changes the security posture. |
| Health path | ADR/HLD/API deployment use `/api/v1/health`; SRS says `/health` | Only `/health` is mounted | Deployment checks do not reach a handler | **Modify code and docs in BLD-02.** Choose one canonical backend health URL; recommended: `/api/v1/health` to match API/deployment. |
| Risk scoring | HLD/SRS imply a three-factor product with neutral `1.0`; Detection uses four-factor weighted sum; Incident design uses five-factor weighted sum | No scorer exists | Implementation cannot be correct without a choice | **REQUIRES DECISION (ARCH-02).** Publish a small scoring ADR and one configuration schema before correlation work. |
| Pagination | API calls pagination cursor-based but specifies `page`/`limit`; code uses offset derived from page | User module is page/offset based | Terminology and future behavior differ | **Update API documentation** to page/offset for MVP; introduce cursor pagination only if measured query patterns require it. |
| Production entrypoint | Deployment doc and package scripts say `dist/main.js` | Compiler emits `dist/src/main.js` | Existing compiled container/service cannot start | **Modify package scripts and deployment docs now (BLD-01).** |

---

## 7. Technical Debt

| Severity | Debt | Consequence | Recommendation | Timing |
|---|---|---|---|---|
| Critical | Broken compiled artifact and `*:prod` paths | Built backend cannot start/migrate/verify in production mode | BLD-01: align package scripts with actual TypeScript output, then add artifact smoke test | Immediately |
| Critical | No approved signed collector handoff contract | Any watcher/Collector implementation risks loss, spoofing, or rework | ARCH-01 before ingestion code | Immediately |
| High | `.env` included in project archive | Potential secrets disclosure | Rotate non-placeholder values; exclude `.env` from exports and use only `.env.example` as source artifact | Immediately |
| High | No queue/worker/recovery path | Core SIEM cannot ingest safely or satisfy restart/DLQ requirements | Implement isolated ingestion slice with BullMQ and fault tests | Before Collector/detection |
| High | Repository interfaces live in `src/database/repositories` rather than module domains | New modules can couple business logic to the infrastructure package | New modules define domain ports; adapt existing repositories. Do not mass-refactor the working auth/user paths now. | Before new SIEM modules |
| High | Health endpoint path differs from deployment | Health checks fail and readiness semantics are unclear | BLD-02: choose and test canonical health route | Before Docker/CI |
| Medium | Aggregate test script is stale | A claimed aggregate validation command is unreliable | Include in BLD-01 | Immediately |
| Medium | User list has no max page size and bypasses central errors | Potential expensive query and poorer diagnostics | BLD-03: cap at 100; pass unknown failures to `next(error)` | Before public UI/API scale-up |
| Medium | Observability lacks request IDs, metrics, tracing, queue/file dimensions | Production failures cannot be diagnosed or capacity verified | OBS-01 starts with ingestion instrumentation | With ingestion |
| Medium | README names legacy `BCRYPT_SALT_ROUNDS`, while runtime uses `BCRYPT_ROUNDS` | Setup confusion | Update stale implementation notes | Opportunistically |

---

## 8. Dependency Graph

```text
BLD-01: runnable compiled backend
  ↓
ARCH-01: approved central ingress + signed batch/heartbeat contract
  ↓
ING-01: ingestion ports, directory claim, HMAC/version/size validation
  ↓
QUE-01: BullMQ adapter, retry/backoff/DLQ, worker lifecycle
  ↓
PROC-01: idempotent raw archive + OCSF validation/normalization
  ↓
PROC-02: feature extraction + canonical event/alert contracts
  ├───────────── RULE-01/02: rule compilation and evaluation
  └───────────── AI-01/02: FastAPI inference and resilient Node client
                         ↓
ARCH-02: approved risk-scoring definition
                         ↓
CORR-01: correlation, scoring, transactional incident persistence
                         ↓
API-01 + RT-01: incident/event/rule/monitoring APIs and live publication
                         ↓
FE-01: dashboard and investigation UI
                         ↓
TEST-04 + PERF-01 + DEPLOY-01: system/failure/load validation and Compose release
```

### Parallel work that is safe

- After **ARCH-01**, the C++ Collector core/outbox and backend ingestion module can be developed independently against shared contract fixtures. Implement only approved central ingress adapters.
- After **PROC-02**, rule engine and AI service/client can proceed in parallel.
- API/documentation work for assets/configuration and the frontend shell may proceed once their contracts are frozen, but must not substitute mocks for system acceptance.
- Docker/CI scaffolding can start after BLD-01, but its production acceptance must wait until all four processes work.

---

## 9. Critical Path

The minimum chain that blocks demonstrable end-to-end SIEM behavior is:

```text
BLD-01
  → ARCH-01
  → ING-01
  → QUE-01
  → PROC-01
  → PROC-02
  → RULE-01 + AI-02
  → ARCH-02
  → CORR-01
  → API-01/RT-01
  → TEST-04/PERF-01
  → DEPLOY-01
```

**Collector source adapters are not on the backend critical path until the backend ingestion slice is validated.** They are on the full product critical path, but `Finalcollector` correctly orders them after the backend can safely receive the approved file envelope.

---

## 10. Detailed Implementation Roadmap

### Phase 0 — Stabilize the existing runnable foundation

**Objective:** Make the already implemented backend build/run/test contract truthful.

**Architectural intent:** Prevent every later feature from being validated against a broken build artifact or stale aggregate test command.

**Current state:** Auth/users and database foundations are present, but package production paths do not match emitted output.

**Gap/scope:** Complete BLD-01, BLD-02, and BLD-03. Do not refactor modules.

**Affected components:** `backend/package.json`, `backend/tsconfig.json` only if deliberately changing output, `backend/src/app.ts`, health tests, users schema/router, deployment documentation.

**Dependencies:** None.

**Parallelizable work:** Documentation conflict log and ARCH-01 preparation.

**Risks:** Changing `rootDir` instead of scripts could unintentionally stop test compilation; use the smallest change and artifact assertions.

**Validation:** Build; verify every production script resolves an emitted file; run aggregate tests; hit canonical health path; assert list limit 101 returns 400.

**Exit criteria:** Existing backend starts from its compiled artifact, migration/bootstrap production scripts resolve their entrypoints, and the test command names existing files.

### Phase 1 — Freeze external and cross-module contracts

**Objective:** Eliminate decisions that would otherwise cause pipeline rework.

**Architectural intent:** Define the Collector→Backend trust boundary and detection/risk contracts before writing business logic.

**Current state:** `Finalcollector` identifies the correct direction but marks transport identity and signed envelope approval-gated. Risk scoring has incompatible formulas across documents.

**Gap/scope:** ARCH-01, DOC-01, ARCH-02.

**Affected components:** New versioned contract document/fixtures; HLD/SRS/ADR amendments after approval; `backend/src/config/env.ts` only if approved contract needs explicit limits/versions.

**Dependencies:** BLD-01 for code execution; operational input from forwarding owners for ARCH-01.

**Parallelizable work:** Rule/AI interface design can be drafted but not frozen until event contract is stable.

**Risks:** Treating UDP as replayable; encoding transport-specific semantics into the backend; deriving identity from untrusted filename.

**Validation:** Contract review checklist, positive/negative fixtures, schema version policy, HMAC test vectors, and documented decision record.

**Exit criteria:** A backend worker and Collector can independently validate the same signed batch/heartbeat fixtures, including duplicates/invalid signature/unknown collector cases.

### Phase 2 — Deliver a secure, durable ingestion vertical slice

**Objective:** Accept one approved atomic batch file and make its raw/normalized data durable without loss on retry/restart.

**Architectural intent:** Establish the first end-to-end platform capability before building detection.

**Current state:** Mongo/PG repositories and configuration are available; no watcher, queue, worker, archive behavior, or heartbeat consumer exists.

**Gap/scope:** ING-01, QUE-01, ING-02, PROC-01, MON-01.

**Affected components:** New `backend/src/modules/ingestion/*`, `backend/src/workers/*`, Mongo repository composition in `main.ts`, queue/worker lifecycle in shutdown coordinator, collector-status/queue-metrics adapters, tests/fixtures.

**Dependencies:** ARCH-01.

**Parallelizable work:** CLL-01 Collector core/outbox against approved fixtures.

**Risks:** Duplicate file claims, symlink/path traversal, partial files, HMAC timing leaks, processing a file before atomic final rename, lack of job idempotency, archive/event duplicate-key errors.

**Validation:** File arrives → verified/claimed → BullMQ job → raw archive unique on `batch_id` → normalized events unique on stable `event_id`; invalid files quarantine with auditable reason; restart/replay preserves data.

**Exit criteria:** A simulated signed batch can be replayed repeatedly without duplicate records or loss, and invalid/unknown/oversized batches never reach processing.

### Phase 3 — Complete canonical event processing and Collector integration

**Objective:** Transform accepted batches into validated, feature-enriched security events and produce them from the approved Collector implementation.

**Architectural intent:** Make OCSF the stable contract both detection engines consume.

**Current state:** Mongo validators/model interfaces exist but no parser/normalizer/features or C++ sources exist.

**Gap/scope:** PROC-02, CLL-01, CLL-02, data retention/index verification.

**Affected components:** New parsing/normalization/feature modules; C++ `collector/` project; chosen adapter(s); durable outbox/checkpoint; Mongo normalized-event repositories; configuration/defaults.

**Dependencies:** Phase 2; selected central transport(s).

**Parallelizable work:** Rule/AI development can begin once the final feature-enriched fixture is frozen.

**Risks:** Random event IDs on replay; using a weak dedup hash as identity; advancing checkpoints before final fsync/rename; unbounded batches; falsely claiming UDP is lossless.

**Validation:** Test fixtures from at least the approved source transports; OCSF violations handled by policy; Collector crash at every checkpoint/publish boundary; backend outage and replay test.

**Exit criteria:** Collector-to-backend at-least-once handoff is demonstrated, source identity survives, and replay is safe.

### Phase 4 — Add independent rule and AI detection

**Objective:** Produce normalized RuleAlert and AIAlert outputs for the same stable event contract.

**Architectural intent:** Keep detection engines independently testable and ensure AI remains additive.

**Current state:** rules/AI data stores, configuration, and seeds exist; no engine, client, or Python service exists.

**Gap/scope:** RULE-01, RULE-02, AI-01, AI-02, DET-01.

**Affected components:** New rule and analysis modules; Redis state keys; FastAPI source/models/tests; Node HTTP client; rule API composition later.

**Dependencies:** PROC-02. Risk scoring decision is not needed until correlation, but alert schema must be frozen.

**Parallelizable work:** Rule engine and AI engine/client.

**Risks:** unsafe dynamic compilation of untrusted YAML, Redis key collisions/TTL errors, model/input-feature drift, AI timeout cascading into worker failure.

**Validation:** Ten representative rules including match/count/sequence; cache hot reload; cooldown test; deterministic AI fixture/model test; timeout/circuit-open fallback returns rule-only output.

**Exit criteria:** Rule-only processing continues while AI is unavailable; both outputs merge into one validated alert contract.

### Phase 5 — Correlate, score, persist, and expose operational workflows

**Objective:** Turn alerts into auditable incidents with lifecycle and investigation APIs.

**Architectural intent:** Move from alerts to analyst-usable case management with one coherent transaction boundary in PostgreSQL and ordered idempotent cross-store writes.

**Current state:** repositories exist; no incident service, correlation logic, risk scorer, APIs, or audit workflow exists.

**Gap/scope:** ARCH-02, CORR-01, INC-01, API-01, ASSET-01, AUDIT-01.

**Affected components:** New correlation/incidents/assets/audit/dashboard application modules and HTTP routes; existing repository adapters; PostgreSQL UoW; Mongo event query adapter.

**Dependencies:** Phase 4 alert contract; ARCH-02.

**Parallelizable work:** Assets/configuration CRUD and API schema work after their ownership/authorization is frozen.

**Risks:** race when two workers update the same open incident, invalid lifecycle transitions, unbounded incident growth, mismatched cross-store links, audit actions outside transaction.

**Validation:** entity/time-window correlation, duplicate alert suppression, concurrent append test, score explainability, all status transition rules, notes/assignment authorization, event pivot queries.

**Exit criteria:** Analyst can follow an incident to alert/event/AI evidence, perform permitted lifecycle actions, and see an audit record.

### Phase 6 — Real-time analyst experience and Collector monitoring

**Objective:** Deliver the SOC dashboard, investigation surfaces, and live system visibility.

**Architectural intent:** Build UI against finalized APIs/events, not against persistence internals or mock-only behavior.

**Current state:** frontend directory has zero files; no WebSocket or Redis Pub/Sub composition exists.

**Gap/scope:** RT-01, FE-01, FE-02, MON-02, DASH-01.

**Affected components:** New Next.js app, backend WebSocket transport/PubSub adapter, dashboard/collector monitoring routes, collector status and queue metrics services.

**Dependencies:** Incident/event/monitoring APIs; notification contract.

**Parallelizable work:** Frontend shell/auth layout can begin earlier, but integration acceptance cannot.

**Risks:** trusting client-side RBAC, WebSocket authorization leaks, stale subscriptions, expensive dashboard aggregations, collector status interpreted as endpoint status.

**Validation:** role-based screen/API tests, two-client WebSocket authorization test, incident update latency test, empty/degraded/late-heartbeat states.

**Exit criteria:** Dashboard receives real incident/collector updates, and all page data derives from protected backend APIs.

### Phase 7 — Production engineering and full-system validation

**Objective:** Make the integrated four-process system deployable, diagnosable, and measurable.

**Architectural intent:** Production readiness is a capability, not a final packaging activity.

**Current state:** no containers, CI, metrics, tracing, traffic/load data, or automated end-to-end stack.

**Gap/scope:** OBS-01/02, SEC-01/02, TEST-04/05, PERF-01, DEPLOY-01/02.

**Affected components:** all processes, Compose files, Dockerfiles, CI workflow, monitoring configuration, backup/retention operational scripts, production config validation.

**Dependencies:** runnable components from Phases 2–6.

**Parallelizable work:** Compose scaffolding, Prometheus metric design, and CI workflow setup; final acceptance stays sequential.

**Risks:** configuration drift, untested migrations, insecure mounted secrets/volumes, repository role privileges, unsupported throughput claims.

**Validation:** clean Compose boot, migrations/bootstrap/seed, health checks, smoke suite, injection/failure/load tests, backup restore drill, and rollback rehearsal.

**Exit criteria:** A clean machine can launch the approved system with one documented command and operators can detect/recover expected failures.

### Stable task register

| ID | Task | Scope | Dependency | Priority | Current status |
|---|---|---|---|---|---|
| BLD-01 | Repair compiled artifact script paths | `start`, production DB scripts, main field, stale aggregate test path | None | P0 | **BROKEN** |
| BLD-02 | Resolve canonical backend health URL | Route + deployment/docs + health tests | BLD-01 | P0 | **INCORRECT** |
| BLD-03 | Bound user page size and centralize error propagation | `limit <= 100`, `next(error)` | BLD-01 | P1 | **TECHNICAL DEBT** |
| ARCH-01 | Approve and codify central signed batch/heartbeat contract | Transport, collector identity, schema/version, HMAC test vectors | Stakeholder approval | P0 | **MISSING** |
| DOC-01 | Reconcile source conflicts | sessions, token expiry, health, pagination, Collector docs | ARCH-01/ARCH-02 as relevant | P0 | **PARTIAL** |
| ARCH-02 | Approve risk scoring algorithm | Formula, neutral values, versioning/config | Stakeholder approval | P1 | **MISSING** |
| ING-01 | Create ingestion domain ports/job contract | Queue port, verifier, claimant, quarantine interfaces | ARCH-01 | P0 | **MISSING** |
| QUE-01 | Implement BullMQ queue/worker runtime | persistent retry/backoff/DLQ/status/shutdown | ING-01 | P0 | **MISSING** |
| ING-02 | Watch/claim/verify/quarantine final files | Atomic final files only, HMAC/identity/limit checks | ING-01, QUE-01 | P0 | **MISSING** |
| PROC-01 | Archive and normalize idempotently | raw batch + stable event persistence/replay | ING-02 | P0 | **MISSING** |
| MON-01 | Consume signed heartbeats/queue metrics | status upsert, offline policy, backend metrics | ARCH-01, QUE-01 | P1 | **MISSING** |
| PROC-02 | Feature extraction | Canonical feature-enriched events | PROC-01 | P0 | **MISSING** |
| CLL-01 | Build Collector core/outbox | durable publication/checkpoints/heartbeat | ARCH-01 | P0 | **MISSING** |
| CLL-02 | Build approved central ingress adapters | Only selected transports and source preservation | CLL-01 | P1 | **MISSING** |
| RULE-01 | Compile/cache/CRUD Sigma rules | validation, class dispatch, hot reload | PROC-02 | P1 | **MISSING** |
| RULE-02 | Stateful count/sequence/cooldown rules | Redis TTL state | RULE-01 | P1 | **MISSING** |
| AI-01 | Build FastAPI model service | health, inference, explanation, deterministic test model | PROC-02 | P1 | **MISSING** |
| AI-02 | Build Node AI client | timeout, circuit breaker, rule-only fallback | AI-01, PROC-02 | P1 | **MISSING** |
| DET-01 | Merge rule/AI outputs | canonical alert contract | RULE-01, AI-02 | P1 | **MISSING** |
| CORR-01 | Correlate/score/persist incidents | entity/window/concurrency/risk transaction | DET-01, ARCH-02 | P1 | **MISSING** |
| API-01 | Implement operational APIs | incident/event/rule/asset/audit/config/collector/dashboard | CORR-01 and feature modules | P1 | **MISSING** |
| RT-01 | Publish live notifications | Redis Pub/Sub + authenticated WebSocket | CORR-01 | P2 | **MISSING** |
| FE-01 | Build SOC dashboard | Next.js auth, incidents, investigation, rule/collector surfaces | API-01, RT-01 | P2 | **MISSING** |
| OBS-01 | Add service/pipeline observability | logs, IDs, metrics, traces, dashboards | ING-02 onward | P1 | **MISSING** |
| SEC-01 | Harden machine/file boundary | ACLs, identity provisioning, HMAC rotation, audit | ARCH-01, ING-02 | P0 | **MISSING** |
| TEST-04 | Add end-to-end failure suite | restart/replay/DLQ/AI-outage/authorization | Phases 2–6 | P1 | **MISSING** |
| PERF-01 | Measure target load | EPS/latency/DB/queue benchmark | Working pipeline | P2 | **MISSING** |
| DEPLOY-01 | Implement Compose/CI/production release path | containers, migrations, health, monitoring, rollback | BLD-01 + services | P1 | **MISSING** |

---

## 11. Testing Roadmap

| Capability | Unit | Integration/contract | Failure/concurrency/performance |
|---|---|---|---|
| Existing foundation | Keep auth/user/UoW tests; add BLD script/route assertions | Real PostgreSQL session/migration tests | Build artifact and production-script resolution test |
| Batch contract | envelope parser, canonical serialization, HMAC verifier, path/size policy | Shared positive/negative fixtures used by backend and C++ Collector | invalid HMAC, old schema, unknown collector, partial/oversized file |
| Queue/ingestion | queue port/claim/quarantine logic | Redis BullMQ + real filesystem temp volume + Mongo archive | worker crash before/after archive, replay duplicate, DLQ/retry/backoff, graceful shutdown |
| Event processing | parser/normalizer/stable-ID/features | Mongo validator/index/TTL behavior | malformed event policy, duplicate key, ordered retry after partial cross-store work |
| Rules | compiler/operator/count/sequence/cooldown | PostgreSQL rule CRUD and Redis state | malicious/invalid YAML, cache reload race, high-cardinality key test |
| AI | schema/client/circuit state | FastAPI test model and Node contract fixtures | timeout, 5 consecutive failures/open circuit, half-open recovery, rule-only continuation |
| Correlation/incidents | entity extraction, score, lifecycle transitions | PostgreSQL transactions plus event document lookup | concurrent workers append same incident, failed audit rollback, max-alert cap |
| APIs/UI | request/response/permission tests | backend contract tests and browser E2E | WebSocket authorization, CSRF/cookie/bearer cases, pagination limits |
| Operations | metric semantics/config validation | Compose clean boot/migrate/seed/smoke | backup restore, disk/full outbox, DB/Redis/AI outage, 1k EPS/4-worker load |

Introduce coverage gates after the test runner is standardized. The SRS target is at least 80% unit coverage for domain/application layers; line coverage alone must not replace contract and failure testing.

---

## 12. Reliability & Failure Handling Roadmap

1. **Delivery model:** Document at-least-once delivery at every durable boundary. Never claim exactly once.
2. **Collector checkpoint:** Advance only after a sealed batch is fsynced and atomically published; retain published manifests for recovery.
3. **Backend claim/queue:** Claim only final files, persist a job with batch identity, and recover orphaned claims/jobs on startup.
4. **Idempotency:** Mongo raw archive `batch_id` is unique; normalized events use stable source-derived `event_id`. Workers treat duplicate-key outcomes as successful replay after verifying identity consistency.
5. **Cross-store consistency:** Do not add distributed transactions. Archive raw batch, then normalize/idempotently persist, then transact relational incident updates; replay remains safe at each boundary.
6. **Retries/DLQ:** Use BullMQ bounded exponential backoff. Classify validation/signature failures as quarantine/no-retry; transient IO/DB failures retry; exhausted jobs retain diagnostics and a controlled replay operation.
7. **AI resilience:** Per-request timeout, circuit breaker, health status, and explicit rule-only fallback. AI failure never blocks raw/normalized event preservation.
8. **Shutdown/startup:** Stop watcher acceptance, drain/return jobs safely, close workers before databases, reconcile claimed files/jobs on startup.
9. **Concurrency:** Use transaction locking or an optimistic strategy to prevent two workers corrupting the same open incident; test it.

---

## 13. Security Roadmap

### Existing strengths to preserve

- bcrypt configured at 12 rounds, password requirements, account lockout, JWT minimum secret validation, cookie `HttpOnly`/SameSite, CSRF validation for cookie-authenticated mutations, role permissions, Zod validation, Helmet, origin-specific CORS, redacted structured logs, parameterized Knex use, and auth rate limiting through Redis.

### Required security work

| ID | Work | Reason |
|---|---|---|
| SEC-01 | Pre-provision Collector identity; use filesystem ACLs and constant-time HMAC verification before queue/archive | `COLLECTOR_HMAC_SECRET` currently provides no active trust boundary |
| SEC-02 | Add endpoint-level authorization/audit policies as each API module is introduced | UI role controls are never a security boundary |
| SEC-03 | Apply bounded request/query/export limits and endpoint-specific rate limits | Protect search/export/rule import and prevent unbounded work |
| SEC-04 | Establish production TLS/secrets/rotation policy; remove `.env` from delivered archives | Protect APIs, AI internal HTTP, and shared secret material |
| SEC-05 | Validate file ownership/path/size/schema and preserve security audit events for rejected batches | Shared directory is a trust boundary, not a trusted input |

The recommended code sequence is HMAC/identity first, then API controls as corresponding modules are created. Do not add a public ingestion endpoint because that would contradict the selected file-based architecture.

---

## 14. Observability Roadmap

Current Winston JSON logging/redaction and DB health are useful foundations, but they are insufficient for pipeline operations.

| Signal | Minimum dimensions | Introduce with |
|---|---|---|
| Request logs | request ID, route, method, authenticated actor (when safe), status, duration | BLD-02/API work |
| Ingestion | collector ID, batch ID, claim result, signature/version outcome, file bytes/events | ING-02 |
| Queue | waiting/active/retry/DLQ counts, oldest job age, processing duration | QUE-01 / MON-01 |
| Processing | batch/event IDs, stage duration, invalid/duplicate/quarantine counts | PROC-01/02 |
| Detection | rule cache stats, evaluation duration, matches/suppressed alerts, AI fallback/circuit state | RULE/AI tasks |
| Incidents | correlation decisions, conflicts/retries, score version, incident notification result | CORR-01 |
| Collector | heartbeat age/status, outbox bytes, drops/backpressure, checkpoint/replay count | CLL-01 / MON-01 |
| Platform | Prometheus metrics, traces across worker stages, readiness/liveness, error reporting | OBS-01 / DEPLOY-01 |

No event payload, JWT, password, HMAC, or full PII-bearing raw log must be indiscriminately logged. Use identifiers and redacted summaries.

---

## 15. Performance & Scalability Roadmap

### Required before production

- Measure the target SRS claim: 1,000 events/s with four backend workers and end-to-end latency under 30 seconds.
- Bound batch event count **and bytes**, worker concurrency, queue retention, DLQ size, file/quarantine capacity, Mongo write batch size, query pagination, and API export volume.
- Verify database indexes against actual incident listing, correlation lookup, event search, raw batch deduplication, and TTL retention queries.
- Record queue lag, worker utilization, Mongo/PostgreSQL pool saturation, Redis memory/AOF behavior, and AI latency in the test environment.

### Future optimization, only after measurement

- Increase worker concurrency/PM2 processes, tune batch size, add cache/index changes, or move to read replicas. Do not introduce Kafka, Kubernetes, or microservices: ADR-001 explicitly excludes them for MVP.

### Likely bottlenecks

Mongo writes/indexes and AI batching are likely first pipeline bottlenecks; correlation database contention may appear when multiple workers update the same entity incident. The architecture already gives the right control points—bounded BullMQ concurrency, batch processing, idempotent writes, and PostgreSQL UoW—once they are implemented.

---

## 16. Deployment & Production Readiness Roadmap

### Required delivery order

1. Repair compiled artifact paths (BLD-01) and agree canonical health path (BLD-02).
2. Add container definitions for each real process; do not create empty placeholder service images as “complete.”
3. Add development/test/production Compose definitions, shared Collector handoff volume, non-root users/ACLs, secrets/environment validation, and migration/bootstrap ordering.
4. Run migrations and Mongo bootstrap as controlled deployment steps, not as implicit unobserved application work.
5. Add CI: typecheck/lint, unit, real DB integration, shared contract tests, e2e, image build, and coverage gate.
6. Add production health/readiness, Prometheus/Grafana/Alertmanager configuration, structured JSON logs, backup/restore and rollback runbooks.

### Current blockers

- No Dockerfiles, Compose, CI workflow, Nginx, monitoring, or process source trees.
- `start` and `*:prod` scripts are broken against current output.
- Deployment documentation assumes services and paths that do not exist.
- Health endpoint path differs between runtime and deployment documentation.

---

## 17. Final Execution Sequence

```text
CURRENT STATE: auth/users/database foundation
  ↓
PHASE 0: fix build/run/test and health contract
  ↓ validation checkpoint: compiled backend starts from emitted artifact
PHASE 1: approve Collector envelope/identity and risk scoring decisions
  ↓ validation checkpoint: shared signed fixtures and ADR/document amendments
PHASE 2: watcher → verified queue → idempotent archive/normalization → heartbeat
  ↓ validation checkpoint: replay/restart/quarantine/DLQ tests
PHASE 3: canonical features + approved Collector core/adapters
  ↓ validation checkpoint: safe Collector-to-backend at-least-once flow
PHASE 4: rules + AI fallback
  ↓ validation checkpoint: alert contract and rule-only continuation
PHASE 5: correlation, incidents, operational APIs
  ↓ validation checkpoint: full investigation and audit workflow
PHASE 6: live dashboard and Collector monitoring
  ↓ validation checkpoint: role-safe real-time UI
PHASE 7: observability, security hardening, Compose/CI
  ↓ validation checkpoint: failure/load/restore/deployment drills
PRODUCTION READINESS
```

---

## 18. Definition of Done

Trivikrama is done only when all of the following are true:

1. An approved central transport generates signed, uniquely identified Collector batches/heartbeats; source identity is preserved.
2. Backend accepts only final, authorized batches; invalid inputs are quarantined and audited; replay/restart does not lose or duplicate semantic events.
3. Valid OCSF events are normalized, retain stable event IDs, are stored with required Mongo TTL/indexes, and are feature-enriched.
4. At least ten Sigma-compatible rules—including required stateful behavior—run from validated YAML with cache/hot reload, and AI produces explainable inference from the same feature schema.
5. AI timeout/circuit failure produces explicit rule-only continuation, not dropped events.
6. Related alerts become PostgreSQL incidents according to one approved, versioned scoring algorithm; lifecycle, assignment, notes, event linkage, and audit records are authorization-correct.
7. All documented MVP API groups are implemented with validated contracts, consistent error semantics, pagination bounds, RBAC, CSRF/bearer behavior, and query/export safeguards.
8. Next.js dashboard provides protected incident investigation, rule management, AI explanations, and Collector monitoring; real-time updates are authenticated and authorized.
9. Metrics/logs/traces/health expose the required operational signals without leaking credentials or raw sensitive payloads.
10. Unit/domain coverage meets the SRS 80% target, integration tests use real PostgreSQL/MongoDB/Redis, and contract/E2E/failure/concurrency/load tests pass.
11. The four real processes and databases start from a clean Docker Compose deployment with migrations/bootstrap, non-root permissions, persistent volumes, secure configuration, rollback/backup instructions, and production smoke tests.
12. Measured evidence—not assumptions—shows the agreed latency/throughput and recovery requirements are met.

---

## 19. Highest-Risk Areas

1. **Unfrozen Collector handoff contract:** Code written before transport/identity/envelope approval will likely be insecure or require rework.
2. **Data loss disguised as success:** Checkpoint/ack ordering and duplicate handling must be proven through crash tests, not inferred from queue use.
3. **Contradictory target specifications:** Sessions, health path, risk formula, and pagination are not safely implementable by choosing arbitrarily.
4. **Build/deployment illusion:** Current code can appear compiled yet cannot start from the documented production command.
5. **Trust boundary expansion:** A shared filesystem is an ingestion boundary; source path, owner, batch identity, signature, size, and replay handling are mandatory.
6. **Premature UI/infrastructure work:** Frontend and Docker before the durable pipeline would create mock-driven integration debt rather than a usable SIEM.

---

## 20. NEXT IMPLEMENTATION TASK

**ID:** BLD-01  
**TASK:** Repair the backend production artifact paths and the stale aggregate test path in `package.json`.

**CURRENT STATE:** TypeScript currently emits `dist/src/main.js` and `dist/src/scripts/*`. `package.json` declares `main: dist/main.js`, `start: node dist/main.js`, and production database scripts under `dist/scripts/*`, none of which exist in the archive. `test:stb003` targets `tests/unit/shared/http-contracts.test.ts`, but the actual file is `tests/unit/shared/http-contract.test.ts`.

**TARGET:** Every package production command must resolve a real emitted file, and the aggregate test script must reference real test paths. Preserve the existing `tsconfig` layout unless a deliberate, separately tested output-layout decision is made.

**WHY THIS IS NEXT:** It has no external dependency, is a confirmed break in the existing implementation, and prevents truthful build/run/deployment validation. It is deliberately smaller and safer than starting a missing SIEM module while the current service cannot launch from its compiled artifact.

**AFFECTED COMPONENTS:**

- `backend/package.json`
- Potentially `backend/tsconfig.json` only if the implementation deliberately moves output rather than updating scripts
- `backend/dist/src/main.js` and `backend/dist/src/scripts/*` as verification outputs (generated, not hand-edited)

**DEPENDENCIES:** None.

**EXPECTED OUTCOME:** `npm start`, `migrate:prod`, `db:mongo:bootstrap:prod`, `db:redis:verify:prod`, `db:verify:prod`, and `db:maintenance:prod` resolve existing compiled paths; `test:stb003` resolves its shared HTTP contract test.

**VALIDATION:**

1. Run `npm run build`.
2. Assert every script’s referenced `dist/src/...` target exists.
3. Run `node --check dist/src/main.js` and the applicable compiled script checks.
4. Run `npm run test:stb003` after dependencies are installed.
5. Start against the local DB stack and confirm the process reaches its configured listen stage (or fails only for an expected unavailable dependency, never `MODULE_NOT_FOUND` for `dist/main.js`).

**EXIT CRITERIA:** The compiled artifact is executable through package scripts, aggregate tests use existing files, and the deployment document is updated to the same canonical compiled path. After BLD-01, the next blocking architecture task is ARCH-01—the approved signed Collector batch/heartbeat contract.

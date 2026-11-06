# Dashboard Analytics Module

DASH-01A provides the read-only REST aggregation boundary for the SOC dashboard. All queries use the authenticated principal's organization and a bounded allowlisted time range.

## Data sources

- PostgreSQL incidents: status/severity counts, response-time aggregates, timeline buckets, and affected entities.
- PostgreSQL alerts: total/rule/AI counts and preceding-window trends.
- MongoDB normalized events: event rate and source breakdown.
- Existing cached AI Engine health monitor: online/degraded/offline status and model version.

The module returns aggregate values only. It does not expose raw events, tenant identifiers, rule content, or internal database fields.

## Bounds and semantics

- Ranges: `1h`, `4h`, `24h`, `7d`, `30d`.
- Timeline intervals: `5m`, `15m`, `1h`, `6h`, `1d`, with at most 500 requested buckets.
- Top assets/entities: 1–25 rows.
- Trend percentages compare the selected window to the immediately preceding equal-duration window.
- Empty timeline periods are returned as explicit zero-valued buckets for stable chart rendering.
- Responses use `Cache-Control: private, no-store`.

## Components

- `domain/dashboard.contracts.ts`: public inputs and aggregation ports.
- `application/`: time-window rules and four endpoint use cases.
- `infrastructure/postgres-dashboard.repository.ts`: parameterized relational aggregation.
- `infrastructure/mongo-dashboard-event.repository.ts`: tenant/time-bounded event aggregation.
- `http/dashboard.routes.ts`: authentication, RBAC, validation, and response policy.
- `composition/dashboard.dependencies.ts`: runtime wiring.

# Trivikrama Frontend

FE-04B adds `/rules/new`, a locally bundled Monaco YAML editor, explicit server compiler validation and preview, confirmation before creation/activation, and bounded persisted-rule dry runs. Install the included backend `/rules/validate` route before using Validate. This endpoint reuses the existing compiler and performs no persistence/reload operations. Validation is not a uniqueness or activation guarantee; creation revalidates transactionally. Dry-run testing applies to saved rules only. Network/timeout creation errors require checking the rule list before retrying to avoid ambiguous duplicate submissions. Sigma schema completion and inline line-position diagnostics remain follow-up work; compiler path errors are shown below the editor.

FE-04A implements read-only Sigma rule listing and detail routes with backend-aligned filters, server sorting/pagination, validated response allowlists, protected built-in provenance, persisted YAML and compilation metadata, false positives, and safe HTTP(S) reference links. Mutations remain separate. Saved-search functionality was deferred because no documented persistence API exists.

FE-03A adds `/investigate`: validated normalized-event search, URL-restored filters, 50-row server pagination, time/severity sorting, IP/user pivots, expandable OCSF and AI evidence, and backend CSV export capped at 10,000 rows. Export reuses the server-reported search window. Deep links from incident events use `eventId`. No event-to-incident lookup endpoint exists yet, so related incident links are not fabricated. Message search is debounced; other filters apply with Search. No query-language parser or saved searches are introduced.

FE-01A provides the production-oriented Next.js application foundation, secure cookie authentication, CSRF handling, backend-aligned RBAC, protected routing, and the responsive application shell. FE-01B adds live tenant-scoped dashboard analytics, recent incidents, visibility-aware polling, and cookie-authenticated incident notifications. FE-02A implements the operational incident queue with validated API responses, URL-backed filters, debounced search, server pagination and sorting, cancellable requests, and real-time refresh. FE-02B adds the secure incident investigation workspace with correlated alerts, normalized events, AI/SHAP evidence, risk composition, chronological activity, and 30-day entity and asset context. FE-02C adds transactional status, assignment, note, close, reopen, and classified-resolution workflows using the existing CSRF-protected backend APIs.

## Requirements

- Node.js 20.9 or later (Node.js 24 LTS recommended)
- Trivikrama backend on `http://localhost:3000`
- Backend `FRONTEND_URL=http://localhost:3001`

## Local setup

```powershell
Set-Location "D:\Trivikrama\frontend"
Copy-Item ".env.example" ".env.local"
npm install
npm run verify
npm run dev
```

Open `http://localhost:3001`. The backend, PostgreSQL, MongoDB, and Redis must already be running for live authentication.

## Security contract

- Authentication uses the backend-managed HttpOnly `siem_token` cookie.
- State-changing requests echo the readable `siem_csrf` cookie in `x-csrf-token`.
- Axios always uses credentials and never creates a bearer authorization header.
- JWT values returned by legacy backend responses are parsed and discarded; they are never stored.
- Zustand contains only safe user metadata and optional session expiry metadata, with no persistence middleware.
- Proxy cookie checks are routing hints only. `GET /api/v1/auth/me` is authoritative.
- Frontend RBAC controls visibility only; backend middleware remains authoritative.

## Verification

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

For the live authentication smoke test, verify login, refresh inside the configured refresh window, a CSRF-protected logout, and rejection of protected routes after logout.

For dashboard verification, confirm all five supported time ranges, manual and 30-second refresh, partial API failure handling, recent incident navigation, and WebSocket-driven refresh for incident create/update/status notifications.

For incident queue verification, confirm status, severity, source, time-range, and search filtering; URL restoration after refresh; server-side sort and pagination; manual, visibility-aware, and WebSocket refresh; and accessible loading, empty, stale-data, and error states. Assignees are displayed as backend-provided UUIDs because the current role-safe API does not expose analyst display names to every incident viewer.

For incident detail verification, open an incident from the queue and confirm that Overview, Alerts, Events, AI analysis, and Timeline load independently; pagination remains server-side; event pivots retain only the event identifier; WebSocket notifications refresh the visible evidence; and section failures do not destroy already loaded incident data.

For incident response verification, exercise only backend-permitted lifecycle transitions; resolve an investigating incident with every resolution class; add a note and confirm it appears in Timeline; verify administrators can search active users; verify security engineers can assign to themselves or unassign without user-directory access; and verify SOC Analysts never receive assignment controls. Every mutation must include the HttpOnly session cookie and readable CSRF cookie through the shared API client.

## Known backend contract dependency

`GET /api/v1/auth/me` currently returns the user but not the session expiry. A session loaded after a full browser refresh therefore cannot schedule proactive refresh; any later `401` safely clears local state and returns the user to sign-in. Before production release, expose non-secret `expiresAt` session metadata from `/auth/me` so reload-safe proactive refresh can be enabled without reading or storing the JWT.

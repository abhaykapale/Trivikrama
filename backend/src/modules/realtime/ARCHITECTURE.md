# Real-Time WebSocket Module

WS-01A provides the authenticated `/ws` push boundary between Redis incident
notifications and browser dashboards. It is push-only: clients cannot select
Redis channels or submit operational commands.

## Upgrade security

- Only `GET /ws` with WebSocket version 13 and a valid 16-byte handshake key is
  accepted. Query strings and other paths are rejected.
- The `Origin` header must exactly match the configured frontend origin.
- Authentication uses only the `siem_token` HttpOnly cookie. Bearer tokens in
  URLs or WebSocket subprotocols are not accepted.
- JWT claims are revalidated against an active, unexpired PostgreSQL session
  and active user. The session user ID must match the JWT subject.
- One session may own at most five simultaneous connections.

## Protocol controls

- Client frames must be masked, unfragmented, and no larger than 16 KiB.
- A token bucket permits 100 inbound frames per minute per connection.
- Unsupported commands, binary frames, extensions, and protocol violations
  receive an appropriate WebSocket close code.
- Server ping/client pong heartbeats detect abandoned connections. Connections
  also close when their authenticated session expires. Each heartbeat cycle
  rechecks the database session and active user, so logout, revocation, and
  deactivation terminate already-open connections fail-closed.

## Tenant-safe delivery

The Redis subscriber uses exact allowlisted channels:
`incidents:new`, `incidents:updated`, and `incidents:status`. Incoming payloads
are JSON-parsed, schema checked, and limited to 64 KiB. The trusted `orgId` in
the transactional-outbox payload selects the in-memory tenant connection set;
it is removed from the browser message. A tenant never receives another
tenant's notification, and clients cannot request a different tenant.

## Lifecycle

The subscriber connects before the HTTP listener starts. Shutdown first
detaches the upgrade handler, closes active WebSockets, and stops the dedicated
Redis subscription, then closes HTTP and shared database clients.

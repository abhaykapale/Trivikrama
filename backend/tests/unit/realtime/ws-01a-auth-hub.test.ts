import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../../../src/config/index.js";
import type { IJwtService, JwtClaims, SessionRecord, UserRecord } from "../../../src/modules/auth/domain/index.js";
import { TenantConnectionHub } from "../../../src/modules/realtime/application/tenant-connection-hub.js";
import { WebSocketUpgradeAuthenticator } from "../../../src/modules/realtime/application/websocket-upgrade-authenticator.js";
import type { RealtimeConnection, RealtimePrincipal } from "../../../src/modules/realtime/domain/realtime.contracts.js";

const USER_ID = "550e8400-e29b-41d4-a716-446655440001";
const NOW = new Date("2026-10-28T12:00:00.000Z");
const CLAIMS: JwtClaims = { sub: USER_ID, username: "analyst", role: "soc_analyst", jti: "jwt-1", iat: 1_798_459_200, exp: 1_798_462_800, iss: "ai-siem" };

test("WS-01A authenticates only same-origin cookie upgrades with active matching sessions", async () => {
  const auth = authenticator();
  assert.deepEqual(await auth.authenticate({ headers: { origin: "https://evil.test", cookie: "siem_token=valid" } }), { ok: false, status: 403, message: "Origin not allowed." });
  assert.deepEqual(await auth.authenticate({ headers: { origin: "http://localhost:3001" } }), { ok: false, status: 401, message: "Authentication required." });
  const result = await auth.authenticate({ headers: { origin: "http://localhost:3001", cookie: "siem_token=valid" } });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.principal, principal());
});

test("WS-01A rejects revoked, expired, inactive, and user-mismatched sessions", async () => {
  for (const variant of [
    { session: { ...session(), revokedAt: NOW } },
    { session: { ...session(), expiresAt: new Date(NOW.getTime() - 1) } },
    { user: { ...user(), isActive: false } },
    { session: { ...session(), userId: "550e8400-e29b-41d4-a716-446655440099" } },
  ]) {
    const result = await authenticator(variant).authenticate({ headers: { origin: "http://localhost:3001", cookie: "siem_token=valid" } });
    assert.deepEqual(result, { ok: false, status: 401, message: "Authentication required." });
  }
  assert.equal(await authenticator({ session: { ...session(), revokedAt: NOW } }).isStillAuthorized(principal()), false);
  assert.equal(await authenticator().isStillAuthorized(principal()), true);
});

test("WS-01A enforces five connections per session and tenant-isolated delivery", () => {
  const hub = new TenantConnectionHub();
  const tenantA = Array.from({ length: 6 }, (_, index) => connection(`a-${index}`, principal()));
  for (const item of tenantA.slice(0, 5)) assert.equal(hub.add(item), true);
  assert.equal(hub.add(tenantA[5]!), false);
  const other = connection("b-1", { ...principal(), orgId: "tenant-b", sessionId: "session-b" });
  assert.equal(hub.add(other), true);
  assert.equal(hub.broadcast({ id: "n-1", type: "INCIDENT_CREATED", occurredAt: NOW.toISOString(), orgId: "tenant-a", data: { incidentId: "i-1" } }), 5);
  assert.equal(tenantA[0]!.messages.length, 1);
  assert.equal(other.messages.length, 0);
  assert.equal("orgId" in tenantA[0]!.messages[0]!, false);
});

function authenticator(overrides: { session?: SessionRecord; user?: UserRecord } = {}) {
  const jwt: IJwtService = { async sign() { return "valid"; }, async verify(token) { if (token !== "valid") throw new Error("invalid"); return CLAIMS; } };
  return new WebSocketUpgradeAuthenticator({ jwtService: jwt, sessionRepository: { async findByJwtId() { return overrides.session ?? session(); } }, userRepository: { async findById() { return overrides.user ?? user(); } }, config: TEST_CONFIG, now: () => NOW });
}
function session(): SessionRecord { return { id: "session-1", userId: USER_ID, jwtId: "jwt-1", ipAddress: null, userAgent: null, expiresAt: new Date(NOW.getTime() + 60_000), createdAt: NOW, revokedAt: null }; }
function user(): UserRecord { return { id: USER_ID, username: "analyst", email: "analyst@example.test", passwordHash: "x", role: "soc_analyst", displayName: "Analyst", isActive: true, lastLoginAt: null, failedLoginCount: 0, lockedUntil: null, createdAt: NOW, updatedAt: NOW, orgId: "tenant-a" }; }
function principal(): RealtimePrincipal { return { userId: USER_ID, username: "analyst", role: "soc_analyst", orgId: "tenant-a", sessionId: "session-1", jwtId: "jwt-1", expiresAt: new Date(NOW.getTime() + 60_000) }; }
interface MemoryConnection extends RealtimeConnection { readonly messages: Array<Readonly<Record<string, unknown>>>; }
function connection(id: string, value: RealtimePrincipal): MemoryConnection { return { id, principal: value, isOpen: true, messages: [], send(message) { this.messages.push(message); }, close() {} }; }
const TEST_CONFIG = { frontend: { url: "http://localhost:3001" }, jwt: { cookie: { name: "siem_token" } } } as unknown as AppConfig;

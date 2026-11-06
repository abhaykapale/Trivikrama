import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express, { type Express } from "express";
import type { AppConfig } from "../../../src/config/index.js";
import type { ListAuditLogsInput } from "../../../src/modules/audit/domain/audit-query.contracts.js";
import { createAuditQueryRouter } from "../../../src/modules/audit/http/audit-query.routes.js";
import type { AuthRole, IJwtService, JwtClaims, SessionRecord, UserRecord } from "../../../src/modules/auth/domain/index.js";

const USER_ID = "550e8400-e29b-41d4-a716-446655440001";

test("AUDIT-01A requires authentication", async () => {
  const harness = createHarness();
  const response = await withServer(harness.app, (baseUrl) => fetch(`${baseUrl}/api/v1/audit`));
  assert.equal(response.status, 401);
});

for (const role of ["admin", "security_engineer"] as const) {
  test(`AUDIT-01A permits ${role} and derives the tenant from authentication`, async () => {
    const harness = createHarness();
    harness.addToken(role, role, `org-${role}`);
    const response = await withServer(harness.app, (baseUrl) => request(baseUrl,
      "/api/v1/audit?action=login&targetType=user&targetId=user-1&ipAddress=10.0.0.5&page=2&limit=25&sort=action&order=asc&orgId=forged", role));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(harness.inputs[0], {
      orgId: `org-${role}`, action: "login", targetType: "user", targetId: "user-1", ipAddress: "10.0.0.5",
      page: 2, limit: 25, sort: "action", order: "asc",
    });
  });
}

test("AUDIT-01A denies SOC Analysts before query execution", async () => {
  const harness = createHarness();
  harness.addToken("analyst", "soc_analyst", "org-a");
  const response = await withServer(harness.app, (baseUrl) => request(baseUrl, "/api/v1/audit", "analyst"));
  assert.equal(response.status, 403);
  assert.equal(harness.inputs.length, 0);
});

test("AUDIT-01A applies documented defaults and rejects unsafe query values", async () => {
  const harness = createHarness();
  harness.addToken("admin", "admin", "org-a");
  await withServer(harness.app, async (baseUrl) => {
    assert.equal((await request(baseUrl, "/api/v1/audit", "admin")).status, 200);
    for (const path of [
      "/api/v1/audit?action=not_real", "/api/v1/audit?actorId=nope", "/api/v1/audit?targetType=%24where",
      "/api/v1/audit?ipAddress=999.1.1.1", "/api/v1/audit?limit=101", "/api/v1/audit?sort=details", "/api/v1/audit?order=sideways",
      "/api/v1/audit?from=not-a-date",
    ]) assert.equal((await request(baseUrl, path, "admin")).status, 400, path);
  });
  assert.deepEqual(harness.inputs[0], { orgId: "org-a", page: 1, limit: 50, sort: "createdAt", order: "desc" });
});

interface Harness { readonly app: Express; readonly inputs: ListAuditLogsInput[]; addToken(token: string, role: AuthRole, orgId: string): void; }
function createHarness(): Harness {
  const jwt = new FakeJwtService(); const sessions = new Map<string, SessionRecord>(); const users = new Map<string, UserRecord>();
  const harness: Harness = { app: express(), inputs: [], addToken(token, role, orgId) {
    const jti = `jwt-${token}`; const now = Math.floor(Date.now() / 1_000);
    jwt.tokens.set(token, { sub: USER_ID, username: token, role, jti, iat: now, exp: now + 3_600, iss: "ai-siem" });
    sessions.set(jti, session(jti)); users.set(USER_ID, user(role, orgId, token));
  } };
  harness.app.use(express.json());
  harness.app.use("/api/v1/audit", createAuditQueryRouter({
    authentication: { jwtService: jwt, sessionRepository: { async findByJwtId(id) { return sessions.get(id) ?? null; } }, userRepository: { async findById(id) { return users.get(id) ?? null; } }, config: TEST_CONFIG },
    listAuditLogsUseCase: { async execute(input) { harness.inputs.push(input); return { data: [], pagination: { page: input.page, limit: input.limit, total: 0, totalPages: 0, hasNext: false, hasPrev: input.page > 1 } }; } },
  }));
  return harness;
}
class FakeJwtService implements IJwtService { public readonly tokens = new Map<string, JwtClaims>(); public async sign(claims: JwtClaims) { return `signed:${claims.jti}`; } public async verify(token: string) { const claims = this.tokens.get(token); if (claims === undefined) throw new Error("Unknown token"); return claims; } }
function session(jwtId: string): SessionRecord { return { id: `session-${jwtId}`, userId: USER_ID, jwtId, ipAddress: null, userAgent: null, expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), revokedAt: null }; }
function user(role: AuthRole, orgId: string, username: string): UserRecord { return { id: USER_ID, username, email: `${username}@example.test`, passwordHash: "test", role, displayName: username, isActive: true, lastLoginAt: null, failedLoginCount: 0, lockedUntil: null, createdAt: new Date(), updatedAt: new Date(), orgId }; }
async function request(baseUrl: string, path: string, token: string) { return fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } }); }
async function withServer<TResult>(app: Express, callback: (baseUrl: string) => Promise<TResult>): Promise<TResult> { const server = await new Promise<Server>((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); }); try { return await callback(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); } finally { await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))); } }
const TEST_CONFIG: AppConfig = {
  server: { port: 3000, nodeEnv: "test", apiPrefix: "/api/v1" }, database: { DATABASE_URL: "postgres://test", MONGODB_URI: "mongodb://test", REDIS_URL: "redis://test", postgres: { poolMin: 0, poolMax: 1, connectionTimeoutMs: 1000, queryTimeoutMs: 1000 }, mongodb: { poolSize: 1, serverSelectionTimeoutMs: 1000 }, redis: { keyPrefix: "test" } },
  jwt: { algorithm: "HS256", secret: "test-jwt-secret-that-is-long-enough-for-audit-tests", accessTokenExpiry: "1h", refreshWindow: "5m", maxSessionDuration: "7d", issuer: "ai-siem", cookie: { name: "siem_token", httpOnly: true, secure: true, sameSite: "strict" } }, auth: { bcryptRounds: 12, lockoutAttempts: 5, lockoutMinutes: 15, rateLimitPerMinute: 10 }, security: { bcryptSaltRounds: 12, collectorHmacSecret: "collector-secret" }, collector: { directory: "./collector", trust: { collectorId: "test", keyId: "test", secretBase64Url: "c8Wm1Qx4Ny7Rt2Ks5Vb9Lp3Hd6Fj0Za8Pe1Uy4Mi7Go2Cq5Xs9Dv3Ln6Ak0Jr8Tw" } }, ai: { engineUrl: "http://localhost:8000", timeoutMs: 5000, batchSize: 100, threshold: 0.65, circuitFailureThreshold: 5, circuitCooldownMs: 60000, circuitSuccessThreshold: 2 }, frontend: { url: "http://localhost:3001" }, logging: { level: "debug", format: "pretty" },
};

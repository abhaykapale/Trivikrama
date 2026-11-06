import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express, { type Express } from "express";
import type { AppConfig } from "../../../src/config/index.js";
import { InvalidConfigurationValueError, type UpdateConfigurationCommand } from "../../../src/modules/configuration/domain/configuration.contracts.js";
import { createConfigurationRouter } from "../../../src/modules/configuration/http/configuration.routes.js";
import type { AuthRole, IJwtService, JwtClaims, SessionRecord, UserRecord } from "../../../src/modules/auth/domain/index.js";

const USER_ID = "550e8400-e29b-41d4-a716-446655440001";
const ENGINEER_ID = "550e8400-e29b-41d4-a716-446655440002";
const ANALYST_ID = "550e8400-e29b-41d4-a716-446655440003";

test("CONFIG-01A endpoints require authentication", async () => {
  const harness = createHarness();
  await withServer(harness.app, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/v1/config`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/v1/config/ai.anomaly_threshold`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: 0.7 }) })).status, 401);
  });
});

test("CONFIG-01A allows Admin to list and update managed configuration", async () => {
  const harness = createHarness(); harness.addToken("admin", "admin", "org-admin");
  await withServer(harness.app, async (baseUrl) => {
    const listed = await request(baseUrl, "/api/v1/config", "admin"); assert.equal(listed.status, 200); assert.equal(listed.headers.get("cache-control"), "private, no-store");
    const updated = await request(baseUrl, "/api/v1/config/correlation.time_window_minutes", "admin", 20); assert.equal(updated.status, 200);
  });
  assert.equal(harness.listCalls, 1);
  assert.deepEqual(harness.updates[0], { key: "correlation.time_window_minutes", value: 20, actor: { id: USER_ID, username: "admin", role: "admin", ipAddress: "127.0.0.1", orgId: "org-admin" } });
});

test("CONFIG-01A restricts Security Engineer to the AI threshold and denies SOC Analyst", async () => {
  const harness = createHarness(); harness.addToken("engineer", "security_engineer", "org-e"); harness.addToken("analyst", "soc_analyst", "org-a");
  await withServer(harness.app, async (baseUrl) => {
    assert.equal((await request(baseUrl, "/api/v1/config", "engineer")).status, 403);
    assert.equal((await request(baseUrl, "/api/v1/config/ai.anomaly_threshold", "engineer", 0.72)).status, 200);
    assert.equal((await request(baseUrl, "/api/v1/config/ai.batch_size", "engineer", 200)).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/v1/config/ai.batch_size`, { method: "PUT", headers: { authorization: "Bearer engineer", "content-type": "application/json" }, body: "{}" })).status, 403);
    assert.equal((await request(baseUrl, "/api/v1/config", "analyst")).status, 403);
    assert.equal((await request(baseUrl, "/api/v1/config/ai.anomaly_threshold", "analyst", 0.7)).status, 403);
  });
  assert.equal(harness.updates.length, 1);
});

test("CONFIG-01A validates keys, strict JSON bodies, and bounded values", async () => {
  const harness = createHarness(); harness.addToken("admin", "admin", "org-a");
  await withServer(harness.app, async (baseUrl) => {
    for (const [path, body] of [["/api/v1/config/bad", { value: 1 }], ["/api/v1/config/ai.anomaly_threshold", {}], ["/api/v1/config/ai.anomaly_threshold", { value: 0.7, extra: true }]] as const) {
      const response = await fetch(`${baseUrl}${path}`, { method: "PUT", headers: { authorization: "Bearer admin", "content-type": "application/json" }, body: JSON.stringify(body) });
      assert.equal(response.status, 400, path);
    }
  });
  assert.equal(harness.updates.length, 0);
});

test("CONFIG-01A maps hidden and invalid managed values to stable errors", async () => {
  const harness = createHarness(); harness.addToken("admin", "admin", "org-a");
  await withServer(harness.app, async (baseUrl) => {
    harness.returnNull = true;
    assert.equal((await request(baseUrl, "/api/v1/config/ai.anomaly_threshold", "admin", 0.7)).status, 404);
    harness.returnNull = false; harness.error = new InvalidConfigurationValueError("ai.anomaly_threshold", ["Too big"]);
    const response = await request(baseUrl, "/api/v1/config/ai.anomaly_threshold", "admin", 2);
    assert.equal(response.status, 422); assert.equal((await response.json() as { error: { code: string } }).error.code, "INVALID_CONFIGURATION_VALUE");
  });
});

interface Harness { readonly app: Express; readonly updates: UpdateConfigurationCommand[]; listCalls: number; returnNull: boolean; error: Error | null; addToken(token: string, role: AuthRole, orgId: string): void; }
function createHarness(): Harness {
  const jwt = new FakeJwtService(); const sessions = new Map<string, SessionRecord>(); const users = new Map<string, UserRecord>();
  const harness: Harness = { app: express(), updates: [], listCalls: 0, returnNull: false, error: null, addToken(token, role, orgId) { const jti = `jwt-${token}`; const userId = token === "admin" ? USER_ID : token === "engineer" ? ENGINEER_ID : ANALYST_ID; const now = Math.floor(Date.now() / 1_000); jwt.tokens.set(token, { sub: userId, username: token, role, jti, iat: now, exp: now + 3_600, iss: "ai-siem" }); sessions.set(jti, session(jti, userId)); users.set(userId, user(userId, role, orgId, token)); } };
  harness.app.use(express.json({ limit: "64kb" }));
  harness.app.use("/api/v1/config", createConfigurationRouter({
    authentication: { jwtService: jwt, sessionRepository: { async findByJwtId(id) { return sessions.get(id) ?? null; } }, userRepository: { async findById(id) { return users.get(id) ?? null; } }, config: TEST_CONFIG },
    listConfigurationUseCase: { async execute() { harness.listCalls += 1; return { data: [] }; } },
    updateConfigurationUseCase: { async execute(input) { if (harness.error) throw harness.error; harness.updates.push(input); if (harness.returnNull) return null; return { key: input.key, value: input.value, previousValue: null, updatedAt: new Date(), updatedBy: input.actor.id }; } },
  })); return harness;
}
class FakeJwtService implements IJwtService { public readonly tokens = new Map<string, JwtClaims>(); public async sign(claims: JwtClaims) { return `signed:${claims.jti}`; } public async verify(token: string) { const claims = this.tokens.get(token); if (!claims) throw new Error("Unknown token"); return claims; } }
function session(jwtId: string, userId: string): SessionRecord { return { id: `session-${jwtId}`, userId, jwtId, ipAddress: null, userAgent: null, expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), revokedAt: null }; }
function user(id: string, role: AuthRole, orgId: string, username: string): UserRecord { return { id, username, email: `${username}@example.test`, passwordHash: "test", role, displayName: username, isActive: true, lastLoginAt: null, failedLoginCount: 0, lockedUntil: null, createdAt: new Date(), updatedAt: new Date(), orgId }; }
async function request(baseUrl: string, path: string, token: string, value?: unknown) { return fetch(`${baseUrl}${path}`, { method: value === undefined ? "GET" : "PUT", headers: { authorization: `Bearer ${token}`, ...(value === undefined ? {} : { "content-type": "application/json" }) }, ...(value === undefined ? {} : { body: JSON.stringify({ value }) }) }); }
async function withServer<TResult>(app: Express, callback: (baseUrl: string) => Promise<TResult>): Promise<TResult> { const server = await new Promise<Server>((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); }); try { return await callback(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); } finally { await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))); } }
const TEST_CONFIG: AppConfig = { server: { port: 3000, nodeEnv: "test", apiPrefix: "/api/v1" }, database: { DATABASE_URL: "postgres://test", MONGODB_URI: "mongodb://test", REDIS_URL: "redis://test", postgres: { poolMin: 0, poolMax: 1, connectionTimeoutMs: 1000, queryTimeoutMs: 1000 }, mongodb: { poolSize: 1, serverSelectionTimeoutMs: 1000 }, redis: { keyPrefix: "test" } }, jwt: { algorithm: "HS256", secret: "test-jwt-secret-that-is-long-enough-for-config-tests", accessTokenExpiry: "1h", refreshWindow: "5m", maxSessionDuration: "7d", issuer: "ai-siem", cookie: { name: "siem_token", httpOnly: true, secure: true, sameSite: "strict" } }, auth: { bcryptRounds: 12, lockoutAttempts: 5, lockoutMinutes: 15, rateLimitPerMinute: 10 }, security: { bcryptSaltRounds: 12, collectorHmacSecret: "collector-secret" }, collector: { directory: "./collector", trust: { collectorId: "test", keyId: "test", secretBase64Url: "c8Wm1Qx4Ny7Rt2Ks5Vb9Lp3Hd6Fj0Za8Pe1Uy4Mi7Go2Cq5Xs9Dv3Ln6Ak0Jr8Tw" } }, ai: { engineUrl: "http://localhost:8000", timeoutMs: 5000, batchSize: 100, threshold: 0.65, circuitFailureThreshold: 5, circuitCooldownMs: 60000, circuitSuccessThreshold: 2 }, frontend: { url: "http://localhost:3001" }, logging: { level: "debug", format: "pretty" } };

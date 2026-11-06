import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express, { type Express } from "express";

import type { AppConfig } from "../../../src/config/index.js";
import type { AuthRole, IJwtService, JwtClaims, SessionRecord, UserRecord } from "../../../src/modules/auth/domain/index.js";
import { DashboardIntervalTooFineError } from "../../../src/modules/dashboard/application/dashboard-window.js";
import type { DashboardRequest, DashboardTimelineRequest, DashboardTopAssetsRequest } from "../../../src/modules/dashboard/domain/dashboard.contracts.js";
import { createDashboardRouter } from "../../../src/modules/dashboard/http/dashboard.routes.js";

const USER_ID = "550e8400-e29b-41d4-a716-446655440001";

test("DASH-01A endpoints require authentication", async () => {
  const harness = createHarness();
  await withServer(harness.app, async (baseUrl) => {
    for (const path of ["summary", "timeline", "top-assets", "source-breakdown"]) {
      assert.equal((await fetch(`${baseUrl}/api/v1/dashboard/${path}`)).status, 401, path);
    }
  });
});

for (const role of ["admin", "security_engineer", "soc_analyst"] as const) {
  test(`DASH-01A allows authenticated ${role} and derives the tenant`, async () => {
    const harness = createHarness();
    harness.addToken(role, role, `org-${role}`);
    await withServer(harness.app, async (baseUrl) => {
      const summary = await request(baseUrl, "/api/v1/dashboard/summary?range=7d&orgId=forged", role);
      assert.equal(summary.status, 200);
      assert.equal(summary.headers.get("cache-control"), "private, no-store");
      assert.equal((await request(baseUrl, "/api/v1/dashboard/timeline?range=24h&interval=1h", role)).status, 200);
      assert.equal((await request(baseUrl, "/api/v1/dashboard/top-assets?range=4h&limit=5", role)).status, 200);
      assert.equal((await request(baseUrl, "/api/v1/dashboard/source-breakdown?range=1h", role)).status, 200);
    });
    assert.deepEqual(harness.summaryInputs[0], { orgId: `org-${role}`, range: "7d" });
    assert.deepEqual(harness.timelineInputs[0], { orgId: `org-${role}`, range: "24h", interval: "1h" });
    assert.deepEqual(harness.topInputs[0], { orgId: `org-${role}`, range: "4h", limit: 5 });
    assert.deepEqual(harness.sourceInputs[0], { orgId: `org-${role}`, range: "1h" });
  });
}

test("DASH-01A applies defaults and rejects malformed or unbounded queries", async () => {
  const harness = createHarness();
  harness.addToken("analyst", "soc_analyst", "org-a");
  await withServer(harness.app, async (baseUrl) => {
    assert.equal((await request(baseUrl, "/api/v1/dashboard/summary", "analyst")).status, 200);
    assert.equal((await request(baseUrl, "/api/v1/dashboard/top-assets", "analyst")).status, 200);
    for (const path of [
      "/api/v1/dashboard/summary?range=90d",
      "/api/v1/dashboard/timeline?interval=1m",
      "/api/v1/dashboard/top-assets?limit=0",
      "/api/v1/dashboard/top-assets?limit=26",
    ]) assert.equal((await request(baseUrl, path, "analyst")).status, 400, path);
  });
  assert.deepEqual(harness.summaryInputs[0], { orgId: "org-a", range: "24h" });
  assert.deepEqual(harness.topInputs[0], { orgId: "org-a", range: "24h", limit: 10 });
});

test("DASH-01A maps an excessive bucket request to a stable error", async () => {
  const harness = createHarness();
  harness.addToken("analyst", "soc_analyst", "org-a");
  harness.timelineError = new DashboardIntervalTooFineError("30d", "5m", 8_640);
  const response = await withServer(harness.app, (baseUrl) => request(baseUrl, "/api/v1/dashboard/timeline?range=30d&interval=5m", "analyst"));
  assert.equal(response.status, 400);
  assert.equal((response.body as { error: { code: string } }).error.code, "DASHBOARD_INTERVAL_TOO_FINE");
});

interface Harness {
  readonly app: Express;
  readonly summaryInputs: DashboardRequest[];
  readonly timelineInputs: DashboardTimelineRequest[];
  readonly topInputs: DashboardTopAssetsRequest[];
  readonly sourceInputs: DashboardRequest[];
  timelineError: Error | null;
  addToken(token: string, role: AuthRole, orgId: string): void;
}

function createHarness(): Harness {
  const jwt = new FakeJwtService();
  const sessions = new Map<string, SessionRecord>();
  const users = new Map<string, UserRecord>();
  const harness: Harness = { app: express(), summaryInputs: [], timelineInputs: [], topInputs: [], sourceInputs: [], timelineError: null,
    addToken(token, role, orgId) {
      const jti = `jwt-${token}`; const now = Math.floor(Date.now() / 1_000);
      jwt.tokens.set(token, { sub: USER_ID, username: token, role, jti, iat: now, exp: now + 3_600, iss: "ai-siem" });
      sessions.set(jti, session(jti)); users.set(USER_ID, user(role, orgId, token));
    },
  };
  harness.app.use(express.json());
  harness.app.use("/api/v1/dashboard", createDashboardRouter({
    authentication: { jwtService: jwt, sessionRepository: { async findByJwtId(id) { return sessions.get(id) ?? null; } }, userRepository: { async findById(id) { return users.get(id) ?? null; } }, config: TEST_CONFIG },
    getDashboardSummaryUseCase: { async execute(input) { harness.summaryInputs.push(input); return summary(); } },
    getDashboardTimelineUseCase: { async execute(input) { if (harness.timelineError !== null) throw harness.timelineError; harness.timelineInputs.push(input); return { timeRange: input.range, interval: input.interval ?? "1h", buckets: [] }; } },
    getDashboardTopAssetsUseCase: { async execute(input) { harness.topInputs.push(input); return { assets: [] }; } },
    getDashboardSourceBreakdownUseCase: { async execute(input) { harness.sourceInputs.push(input); return { sources: [], total: 0 }; } },
  }));
  return harness;
}

class FakeJwtService implements IJwtService {
  public readonly tokens = new Map<string, JwtClaims>();
  public async sign(claims: JwtClaims): Promise<string> { return `signed:${claims.jti}`; }
  public async verify(token: string): Promise<JwtClaims> { const claims = this.tokens.get(token); if (claims === undefined) throw new Error("Unknown token"); return claims; }
}
function summary() { return { timeRange: "24h", incidents: { open: 0, openTrend: 0, critical: 0, criticalTrend: 0, investigating: 0, resolvedToday: 0, closedToday: 0 }, alerts: { totalToday: 0, alertsTrend: 0, ruleAlerts: 0, aiAlerts: 0 }, events: { eventsPerSecond: 0, epsTrend: 0, totalToday: 0 }, responseTime: { avgMinutes: 0, avgTrend: 0, medianMinutes: 0 }, severityDistribution: { critical: 0, high: 0, medium: 0, low: 0, informational: 0 }, aiEngine: { status: "online" as const, modelVersion: "v1", anomaliesDetected: 0 } }; }
function session(jwtId: string): SessionRecord { return { id: `session-${jwtId}`, userId: USER_ID, jwtId, ipAddress: null, userAgent: null, expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), revokedAt: null }; }
function user(role: AuthRole, orgId: string, username: string): UserRecord { return { id: USER_ID, username, email: `${username}@example.test`, passwordHash: "test", role, displayName: username, isActive: true, lastLoginAt: null, failedLoginCount: 0, lockedUntil: null, createdAt: new Date(), updatedAt: new Date(), orgId }; }
async function request(baseUrl: string, path: string, token: string) { const response = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } }); return { status: response.status, headers: response.headers, body: await response.json() as unknown }; }
async function withServer<TResult>(app: Express, callback: (baseUrl: string) => Promise<TResult>): Promise<TResult> { const server = await new Promise<Server>((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); }); try { return await callback(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); } finally { await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))); } }

const TEST_CONFIG: AppConfig = {
  server: { port: 3000, nodeEnv: "test", apiPrefix: "/api/v1" }, database: { DATABASE_URL: "postgres://test", MONGODB_URI: "mongodb://test", REDIS_URL: "redis://test", postgres: { poolMin: 0, poolMax: 1, connectionTimeoutMs: 1000, queryTimeoutMs: 1000 }, mongodb: { poolSize: 1, serverSelectionTimeoutMs: 1000 }, redis: { keyPrefix: "test" } },
  jwt: { algorithm: "HS256", secret: "test-jwt-secret-that-is-long-enough-for-dashboard-tests", accessTokenExpiry: "1h", refreshWindow: "5m", maxSessionDuration: "7d", issuer: "ai-siem", cookie: { name: "siem_token", httpOnly: true, secure: true, sameSite: "strict" } }, auth: { bcryptRounds: 12, lockoutAttempts: 5, lockoutMinutes: 15, rateLimitPerMinute: 10 }, security: { bcryptSaltRounds: 12, collectorHmacSecret: "collector-secret" },
  collector: { directory: "./collector", trust: { collectorId: "test", keyId: "test", secretBase64Url: "c8Wm1Qx4Ny7Rt2Ks5Vb9Lp3Hd6Fj0Za8Pe1Uy4Mi7Go2Cq5Xs9Dv3Ln6Ak0Jr8Tw" } }, ai: { engineUrl: "http://localhost:8000", timeoutMs: 5000, batchSize: 100, threshold: 0.65, circuitFailureThreshold: 5, circuitCooldownMs: 60000, circuitSuccessThreshold: 2 }, frontend: { url: "http://localhost:3001" }, logging: { level: "debug", format: "pretty" },
};

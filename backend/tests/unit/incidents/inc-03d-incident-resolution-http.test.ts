import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { AppConfig } from "../../../src/config/index.js";
import type { AuthRole, IJwtService, JwtClaims, SessionRecord, UserRecord } from "../../../src/modules/auth/domain/index.js";
import { InvalidIncidentStatusTransitionError } from "../../../src/modules/incidents/application/transition-incident-status.use-case.js";
import { INCIDENT_RESOLUTIONS, type ResolveIncidentCommand } from "../../../src/modules/incidents/domain/incident-resolution.contracts.js";
import { createIncidentQueryRouter } from "../../../src/modules/incidents/http/incident-query.routes.js";

const USER_ID = "550e8400-e29b-41d4-a716-446655440001";
const INCIDENT_ID = "00000000-0000-4000-8000-000000000501";

test("PUT /incidents/:id/resolve requires authentication", async () => {
  const harness = createHarness();
  await withServer(harness.app, async (baseUrl) => {
    const response = await requestResolution(baseUrl, INCIDENT_ID, { resolution: "tp_mitigated" });
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, "UNAUTHORIZED");
  });
  assert.equal(harness.inputs.length, 0);
});

for (const role of ["admin", "security_engineer", "soc_analyst"] as const) {
  test(`incident resolution allows authenticated ${role}`, async () => {
    const harness = createHarness();
    harness.addActiveToken(`${role}-token`, role, `org-${role}`);
    await withServer(harness.app, async (baseUrl) => {
      const response = await requestResolution(baseUrl, INCIDENT_ID, { resolution: "tp_mitigated" }, `${role}-token`);
      assert.equal(response.status, 200);
      assert.equal(response.body.status, "resolved");
      assert.equal(response.body.resolution, "tp_mitigated");
      assert.equal("orgId" in response.body, false);
    });
    assert.equal(harness.inputs[0]?.orgId, `org-${role}`);
    assert.equal(harness.inputs[0]?.actor.role, role);
  });
}

test("resolution route accepts every reason and derives tenant and actor", async () => {
  const harness = createHarness();
  harness.addActiveToken("analyst-token", "soc_analyst", "org-alpha");
  await withServer(harness.app, async (baseUrl) => {
    for (const resolution of INCIDENT_RESOLUTIONS) {
      const response = await requestResolution(baseUrl, INCIDENT_ID, { resolution, note: "  contained host  " }, "analyst-token");
      assert.equal(response.status, 200);
      assert.equal(response.body.resolution, resolution);
    }
    const forged = await requestResolution(baseUrl, INCIDENT_ID, {
      resolution: "tp_mitigated",
      orgId: "forged",
      actorId: "forged",
    }, "analyst-token");
    assert.equal(forged.status, 400);
  });
  assert.equal(harness.inputs.length, INCIDENT_RESOLUTIONS.length);
  assert.equal(harness.inputs[0]?.orgId, "org-alpha");
  assert.equal(harness.inputs[0]?.actor.id, USER_ID);
  assert.equal(harness.inputs[0]?.note, "contained host");
});

test("resolution route validates UUID, strict body, reason, and note bounds", async () => {
  const harness = createHarness();
  harness.addActiveToken("analyst-token", "soc_analyst", "org-alpha");
  await withServer(harness.app, async (baseUrl) => {
    const atLimit = await requestResolution(baseUrl, INCIDENT_ID, { resolution: "fp_known", note: "x".repeat(10_000) }, "analyst-token");
    assert.equal(atLimit.status, 200);
    for (const [id, body] of [
      ["not-a-uuid", { resolution: "tp_mitigated" }],
      [INCIDENT_ID, { resolution: "not_valid" }],
      [INCIDENT_ID, { resolution: "tp_mitigated", note: "   " }],
      [INCIDENT_ID, { resolution: "tp_mitigated", note: "x".repeat(10_001) }],
      [INCIDENT_ID, {}],
      [INCIDENT_ID, { resolution: "tp_mitigated", extra: true }],
    ] as const) {
      const response = await requestResolution(baseUrl, id, body, "analyst-token");
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, "VALIDATION_ERROR");
    }
  });
  assert.equal(harness.inputs.length, 1);
});

test("resolution route conceals absence and maps invalid transitions", async () => {
  const harness = createHarness();
  harness.addActiveToken("analyst-token", "soc_analyst", "org-alpha");
  await withServer(harness.app, async (baseUrl) => {
    harness.result = null;
    const hidden = await requestResolution(baseUrl, INCIDENT_ID, { resolution: "duplicate" }, "analyst-token");
    assert.equal(hidden.status, 404);
    assert.equal(hidden.body.error.code, "RESOURCE_NOT_FOUND");
    assert.equal(JSON.stringify(hidden.body).includes("org-alpha"), false);

    harness.error = new InvalidIncidentStatusTransitionError("closed", "resolved");
    const invalid = await requestResolution(baseUrl, INCIDENT_ID, { resolution: "duplicate" }, "analyst-token");
    assert.equal(invalid.status, 422);
    assert.equal(invalid.body.error.code, "INVALID_STATUS_TRANSITION");
    assert.deepEqual(invalid.body.error.details, { currentStatus: "closed", requestedStatus: "resolved" });
  });
});

interface Harness {
  readonly app: Express;
  readonly inputs: ResolveIncidentCommand[];
  result: { id: string; status: "resolved"; resolution: "tp_mitigated"; resolvedAt: Date; updatedAt: Date } | null;
  error: Error | null;
  addActiveToken(token: string, role: AuthRole, orgId: string): void;
}

function createHarness(): Harness {
  const jwtService = new FakeJwtService();
  const sessions = new Map<string, SessionRecord>();
  const users = new Map<string, UserRecord>();
  const inputs: ResolveIncidentCommand[] = [];
  const harness: Harness = {
    app: express(), inputs,
    result: { id: INCIDENT_ID, status: "resolved", resolution: "tp_mitigated", resolvedAt: new Date("2026-10-20T02:00:00Z"), updatedAt: new Date("2026-10-20T02:00:00Z") },
    error: null,
    addActiveToken(token, role, orgId) {
      const jwtId = `jwt-${token}`;
      const now = Math.floor(Date.now() / 1000);
      jwtService.claimsByToken.set(token, { sub: USER_ID, username: "incident-operator", role, jti: jwtId, iat: now, exp: now + 3600, iss: "ai-siem" });
      sessions.set(jwtId, createSession(jwtId));
      users.set(USER_ID, createUser(role, orgId));
    },
  };
  harness.app.use(express.json({ limit: "32kb" }));
  harness.app.use("/api/v1/incidents", createIncidentQueryRouter({
    authentication: {
      jwtService,
      sessionRepository: { async findByJwtId(jwtId) { return sessions.get(jwtId) ?? null; } },
      userRepository: { async findById(id) { return users.get(id) ?? null; } },
      config: TEST_CONFIG,
    },
    listIncidentsUseCase: { async execute() { throw new Error("Outside INC-03D test scope."); } },
    getIncidentDetailUseCase: { async execute() { throw new Error("Outside INC-03D test scope."); } },
    resolveIncidentUseCase: {
      async execute(input) {
        inputs.push(input);
        if (harness.error !== null) throw harness.error;
        if (harness.result === null) return null;
        return { ...harness.result, resolution: input.resolution };
      },
    },
  }));
  harness.app.use(testErrorMiddleware);
  return harness;
}

class FakeJwtService implements IJwtService {
  public readonly claimsByToken = new Map<string, JwtClaims>();
  public async sign(claims: JwtClaims): Promise<string> { return `signed:${claims.jti}`; }
  public async verify(token: string): Promise<JwtClaims> {
    const claims = this.claimsByToken.get(token);
    if (claims === undefined) throw new Error("invalid token");
    return claims;
  }
}

function createSession(jwtId: string): SessionRecord {
  return { id: "00000000-0000-4000-8000-000000000801", userId: USER_ID, jwtId, ipAddress: "127.0.0.1", userAgent: "inc-03d-test", expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), revokedAt: null };
}

function createUser(role: AuthRole, orgId: string): UserRecord {
  return { id: USER_ID, username: "incident-operator", email: "operator@example.test", passwordHash: "hash", role, displayName: "Incident Operator", isActive: true, lastLoginAt: null, failedLoginCount: 0, lockedUntil: null, createdAt: new Date(), updatedAt: new Date(), orgId };
}

async function requestResolution(baseUrl: string, incidentId: string, body: unknown, token?: string) {
  const response = await fetch(`${baseUrl}/api/v1/incidents/${incidentId}/resolve`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

function testErrorMiddleware(error: unknown, _request: Request, response: Response, _next: NextFunction): Response {
  return response.status(500).json({ error: { code: "INTERNAL_SERVER_ERROR", message: error instanceof Error ? error.message : "Something went wrong." } });
}

function withServer(app: Express, operation: (baseUrl: string) => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const server: Server = app.listen(0, "127.0.0.1", async () => {
      try {
        const address = server.address() as AddressInfo;
        await operation(`http://127.0.0.1:${address.port}`);
        server.close((error) => (error ? reject(error) : resolve()));
      } catch (error) { server.close(() => reject(error)); }
    });
    server.once("error", reject);
  });
}

const TEST_CONFIG: AppConfig = {
  server: { port: 3000, nodeEnv: "test", apiPrefix: "/api/v1" },
  database: { DATABASE_URL: "postgres://example.test/trivikrama", MONGODB_URI: "mongodb://example.test/trivikrama", REDIS_URL: "redis://example.test:6379", postgres: { poolMin: 1, poolMax: 2, connectionTimeoutMs: 5000, queryTimeoutMs: 30000 }, mongodb: { poolSize: 2, serverSelectionTimeoutMs: 5000 }, redis: { keyPrefix: "trivikrama-test" } },
  jwt: { algorithm: "HS256", secret: "test-jwt-secret-that-is-long-enough-for-inc-03d-http", accessTokenExpiry: "1h", refreshWindow: "5m", maxSessionDuration: "7d", issuer: "ai-siem", cookie: { name: "siem_token", httpOnly: true, secure: true, sameSite: "strict" } },
  auth: { bcryptRounds: 12, lockoutAttempts: 5, lockoutMinutes: 15, rateLimitPerMinute: 10 },
  security: { bcryptSaltRounds: 12, collectorHmacSecret: "collector-hmac-secret-for-inc-03d-http-test" },
  collector: { directory: "./collector", trust: { collectorId: "collector-test-01", keyId: "collector-key-test-01", secretBase64Url: "c8Wm1Qx4Ny7Rt2Ks5Vb9Lp3Hd6Fj0Za8Pe1Uy4Mi7Go2Cq5Xs9Dv3Ln6Ak0Jr8Tw" } },
  ai: { engineUrl: "http://localhost:8000", timeoutMs: 5000, batchSize: 100, threshold: 0.65, circuitFailureThreshold: 5, circuitCooldownMs: 60000, circuitSuccessThreshold: 2 },
  frontend: { url: "http://localhost:3001" }, logging: { level: "debug", format: "pretty" },
};

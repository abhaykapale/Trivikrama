import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { AppConfig } from "../../../src/config/index.js";
import type { AuthRole, IJwtService, JwtClaims, SessionRecord, UserRecord } from "../../../src/modules/auth/domain/index.js";
import { IncidentAssigneeNotAvailableError } from "../../../src/modules/incidents/application/assign-incident.use-case.js";
import type { AssignIncidentCommand } from "../../../src/modules/incidents/domain/incident-assignment.contracts.js";
import { createIncidentQueryRouter } from "../../../src/modules/incidents/http/incident-query.routes.js";

const USER_ID = "550e8400-e29b-41d4-a716-446655440001";
const INCIDENT_ID = "00000000-0000-4000-8000-000000000501";
const ASSIGNEE_ID = "00000000-0000-4000-8000-000000000601";

test("PUT /incidents/:id/assign requires authentication", async () => {
  const harness = createHarness();
  await withServer(harness.app, async (baseUrl) => {
    const response = await requestAssignment(baseUrl, INCIDENT_ID, ASSIGNEE_ID);
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, "UNAUTHORIZED");
  });
  assert.equal(harness.inputs.length, 0);
});

for (const role of ["admin", "security_engineer"] as const) {
  test(`assignment allows authenticated ${role}`, async () => {
    const harness = createHarness();
    harness.addActiveToken(`${role}-token`, role, `org-${role}`);
    await withServer(harness.app, async (baseUrl) => {
      const response = await requestAssignment(baseUrl, INCIDENT_ID, ASSIGNEE_ID, `${role}-token`);
      assert.equal(response.status, 200);
      assert.equal(response.body.id, INCIDENT_ID);
      assert.equal(response.body.assignedTo, ASSIGNEE_ID);
      assert.equal("orgId" in response.body, false);
    });
    assert.equal(harness.inputs[0]?.orgId, `org-${role}`);
    assert.equal(harness.inputs[0]?.actor.id, USER_ID);
    assert.equal(harness.inputs[0]?.actor.role, role);
  });
}

test("assignment denies SOC analysts without invoking the command", async () => {
  const harness = createHarness();
  harness.addActiveToken("analyst-token", "soc_analyst", "org-alpha");
  await withServer(harness.app, async (baseUrl) => {
    const response = await requestAssignment(baseUrl, INCIDENT_ID, ASSIGNEE_ID, "analyst-token");
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, "FORBIDDEN");
  });
  assert.equal(harness.inputs.length, 0);
});

test("assignment accepts null and derives tenant and actor only from authentication", async () => {
  const harness = createHarness();
  harness.addActiveToken("engineer-token", "security_engineer", "org-alpha");
  harness.result = { id: INCIDENT_ID, assignedTo: null, updatedAt: new Date() };
  await withServer(harness.app, async (baseUrl) => {
    const response = await requestAssignment(baseUrl, INCIDENT_ID, null, "engineer-token");
    assert.equal(response.status, 200);
    assert.equal(response.body.assignedTo, null);

    const forged = await requestJson(baseUrl, `/api/v1/incidents/${INCIDENT_ID}/assign?orgId=forged`, "PUT", {
      assignedTo: ASSIGNEE_ID, orgId: "forged",
    }, "engineer-token");
    assert.equal(forged.status, 400);
  });
  assert.equal(harness.inputs.length, 1);
  assert.equal(harness.inputs[0]?.orgId, "org-alpha");
  assert.equal(harness.inputs[0]?.actor.username, "incident-operator");
});

test("assignment validates incident UUID and a strict nullable assignee UUID", async () => {
  const harness = createHarness();
  harness.addActiveToken("engineer-token", "security_engineer", "org-alpha");
  await withServer(harness.app, async (baseUrl) => {
    for (const [id, body] of [
      ["not-a-uuid", { assignedTo: ASSIGNEE_ID }],
      [INCIDENT_ID, { assignedTo: "not-a-uuid" }],
      [INCIDENT_ID, {}],
      [INCIDENT_ID, { assignedTo: ASSIGNEE_ID, extra: true }],
    ] as const) {
      const response = await requestJson(baseUrl, `/api/v1/incidents/${id}/assign`, "PUT", body, "engineer-token");
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, "VALIDATION_ERROR");
    }
  });
  assert.equal(harness.inputs.length, 0);
});

test("assignment safely maps hidden incidents and unavailable assignees", async () => {
  const harness = createHarness();
  harness.addActiveToken("engineer-token", "security_engineer", "org-alpha");
  await withServer(harness.app, async (baseUrl) => {
    harness.result = null;
    const hidden = await requestAssignment(baseUrl, INCIDENT_ID, ASSIGNEE_ID, "engineer-token");
    assert.equal(hidden.status, 404);
    assert.equal(hidden.body.error.code, "RESOURCE_NOT_FOUND");

    harness.error = new IncidentAssigneeNotAvailableError(ASSIGNEE_ID);
    const unavailable = await requestAssignment(baseUrl, INCIDENT_ID, ASSIGNEE_ID, "engineer-token");
    assert.equal(unavailable.status, 404);
    assert.equal(unavailable.body.error.code, "ASSIGNEE_NOT_AVAILABLE");
    assert.equal(JSON.stringify(unavailable.body).includes(ASSIGNEE_ID), false);
  });
});

interface Harness {
  readonly app: Express;
  readonly inputs: AssignIncidentCommand[];
  result: { id: string; assignedTo: string | null; updatedAt: Date } | null;
  error: Error | null;
  addActiveToken(token: string, role: AuthRole, orgId: string): void;
}

function createHarness(): Harness {
  const jwtService = new FakeJwtService();
  const sessions = new Map<string, SessionRecord>();
  const users = new Map<string, UserRecord>();
  const inputs: AssignIncidentCommand[] = [];
  const harness: Harness = {
    app: express(), inputs,
    result: { id: INCIDENT_ID, assignedTo: ASSIGNEE_ID, updatedAt: new Date("2026-10-20T00:00:00.000Z") },
    error: null,
    addActiveToken(token, role, orgId) {
      const jwtId = `jwt-${token}`;
      const nowSeconds = Math.floor(Date.now() / 1000);
      jwtService.claimsByToken.set(token, {
        sub: USER_ID, username: "incident-operator", role, jti: jwtId,
        iat: nowSeconds, exp: nowSeconds + 3600, iss: "ai-siem",
      });
      sessions.set(jwtId, createSession(jwtId));
      users.set(USER_ID, createUser(role, orgId));
    },
  };
  harness.app.use(express.json());
  harness.app.use("/api/v1/incidents", createIncidentQueryRouter({
    authentication: {
      jwtService,
      sessionRepository: { async findByJwtId(jwtId) { return sessions.get(jwtId) ?? null; } },
      userRepository: { async findById(id) { return users.get(id) ?? null; } },
      config: TEST_CONFIG,
    },
    listIncidentsUseCase: { async execute() { throw new Error("Outside INC-03B test scope."); } },
    getIncidentDetailUseCase: { async execute() { throw new Error("Outside INC-03B test scope."); } },
    assignIncidentUseCase: {
      async execute(input) {
        inputs.push(input);
        if (harness.error !== null) throw harness.error;
        return harness.result;
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
  return { id: "00000000-0000-4000-8000-000000000801", userId: USER_ID, jwtId,
    ipAddress: "127.0.0.1", userAgent: "inc-03b-test",
    expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), revokedAt: null };
}

function createUser(role: AuthRole, orgId: string): UserRecord {
  return { id: USER_ID, username: "incident-operator", email: "operator@example.test",
    passwordHash: "hash", role, displayName: "Incident Operator", isActive: true,
    lastLoginAt: null, failedLoginCount: 0, lockedUntil: null,
    createdAt: new Date(), updatedAt: new Date(), orgId };
}

function requestAssignment(baseUrl: string, incidentId: string, assignedTo: string | null, token?: string) {
  return requestJson(baseUrl, `/api/v1/incidents/${incidentId}/assign`, "PUT", { assignedTo }, token);
}

async function requestJson(baseUrl: string, path: string, method: string, body: unknown, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as any };
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
        server.close((error) => error ? reject(error) : resolve());
      } catch (error) { server.close(() => reject(error)); }
    });
    server.once("error", reject);
  });
}

const TEST_CONFIG: AppConfig = {
  server: { port: 3000, nodeEnv: "test", apiPrefix: "/api/v1" },
  database: {
    DATABASE_URL: "postgres://example.test/trivikrama", MONGODB_URI: "mongodb://example.test/trivikrama", REDIS_URL: "redis://example.test:6379",
    postgres: { poolMin: 1, poolMax: 2, connectionTimeoutMs: 5000, queryTimeoutMs: 30000 },
    mongodb: { poolSize: 2, serverSelectionTimeoutMs: 5000 }, redis: { keyPrefix: "trivikrama-test" },
  },
  jwt: { algorithm: "HS256", secret: "test-jwt-secret-that-is-long-enough-for-inc-03b-http", accessTokenExpiry: "1h", refreshWindow: "5m", maxSessionDuration: "7d", issuer: "ai-siem",
    cookie: { name: "siem_token", httpOnly: true, secure: true, sameSite: "strict" } },
  auth: { bcryptRounds: 12, lockoutAttempts: 5, lockoutMinutes: 15, rateLimitPerMinute: 10 },
  security: { bcryptSaltRounds: 12, collectorHmacSecret: "collector-hmac-secret-for-inc-03b-http-test" },
  collector: { directory: "./collector", trust: { collectorId: "collector-test-01", keyId: "collector-key-test-01", secretBase64Url: "c8Wm1Qx4Ny7Rt2Ks5Vb9Lp3Hd6Fj0Za8Pe1Uy4Mi7Go2Cq5Xs9Dv3Ln6Ak0Jr8Tw" } },
  ai: { engineUrl: "http://localhost:8000", timeoutMs: 5000, batchSize: 100, threshold: 0.65, circuitFailureThreshold: 5, circuitCooldownMs: 60000, circuitSuccessThreshold: 2 },
  frontend: { url: "http://localhost:3001" }, logging: { level: "debug", format: "pretty" },
};

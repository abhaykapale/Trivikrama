import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { AppConfig } from "../../../src/config/index.js";
import type {
  AuthRole,
  IJwtService,
  JwtClaims,
  SessionRecord,
  UserRecord,
} from "../../../src/modules/auth/domain/index.js";
import type { AddIncidentNoteCommand } from "../../../src/modules/incidents/domain/incident-note-command.contracts.js";
import { createIncidentQueryRouter } from "../../../src/modules/incidents/http/incident-query.routes.js";

const USER_ID = "550e8400-e29b-41d4-a716-446655440001";
const INCIDENT_ID = "00000000-0000-4000-8000-000000000501";
const NOTE_ID = "00000000-0000-4000-8000-000000000901";

test("POST /incidents/:id/notes requires authentication", async () => {
  const harness = createHarness();
  await withServer(harness.app, async (baseUrl) => {
    const response = await requestNote(baseUrl, INCIDENT_ID, "note");
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, "UNAUTHORIZED");
  });
  assert.equal(harness.inputs.length, 0);
});

for (const role of ["admin", "security_engineer", "soc_analyst"] as const) {
  test(`incident notes allow authenticated ${role}`, async () => {
    const harness = createHarness();
    harness.addActiveToken(`${role}-token`, role, `org-${role}`);
    await withServer(harness.app, async (baseUrl) => {
      const response = await requestNote(
        baseUrl,
        INCIDENT_ID,
        "**Host isolated**",
        `${role}-token`,
      );
      assert.equal(response.status, 201);
      assert.equal(response.body.id, NOTE_ID);
      assert.equal(response.body.authorName, "incident-operator");
      assert.equal(response.body.content, "**Host isolated**");
      assert.equal("orgId" in response.body, false);
    });
    assert.equal(harness.inputs[0]?.orgId, `org-${role}`);
    assert.equal(harness.inputs[0]?.actor.role, role);
  });
}

test("note route trims boundaries and derives tenant and author from authentication", async () => {
  const harness = createHarness();
  harness.addActiveToken("analyst-token", "soc_analyst", "org-alpha");
  await withServer(harness.app, async (baseUrl) => {
    const response = await requestNote(
      baseUrl,
      INCIDENT_ID,
      "  investigation note  ",
      "analyst-token",
    );
    assert.equal(response.status, 201);

    const forged = await requestJson(
      baseUrl,
      `/api/v1/incidents/${INCIDENT_ID}/notes?orgId=forged`,
      { content: "note", authorId: "forged", orgId: "forged" },
      "analyst-token",
    );
    assert.equal(forged.status, 400);
  });
  assert.equal(harness.inputs.length, 1);
  assert.equal(harness.inputs[0]?.content, "investigation note");
  assert.equal(harness.inputs[0]?.orgId, "org-alpha");
  assert.equal(harness.inputs[0]?.actor.id, USER_ID);
});

test("note route validates UUID, strict body, blank text, and 10,000 character limit", async () => {
  const harness = createHarness();
  harness.addActiveToken("analyst-token", "soc_analyst", "org-alpha");
  await withServer(harness.app, async (baseUrl) => {
    const atLimit = await requestNote(
      baseUrl,
      INCIDENT_ID,
      "x".repeat(10_000),
      "analyst-token",
    );
    assert.equal(atLimit.status, 201);

    for (const [id, body] of [
      ["not-a-uuid", { content: "note" }],
      [INCIDENT_ID, { content: "   " }],
      [INCIDENT_ID, { content: "x".repeat(10_001) }],
      [INCIDENT_ID, {}],
      [INCIDENT_ID, { content: "note", extra: true }],
    ] as const) {
      const response = await requestJson(
        baseUrl,
        `/api/v1/incidents/${id}/notes`,
        body,
        "analyst-token",
      );
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, "VALIDATION_ERROR");
    }
  });
  assert.equal(harness.inputs.length, 1);
});

test("note route conceals a missing or cross-tenant incident", async () => {
  const harness = createHarness();
  harness.addActiveToken("analyst-token", "soc_analyst", "org-alpha");
  harness.result = null;
  await withServer(harness.app, async (baseUrl) => {
    const response = await requestNote(
      baseUrl,
      INCIDENT_ID,
      "note",
      "analyst-token",
    );
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, "RESOURCE_NOT_FOUND");
    assert.equal(JSON.stringify(response.body).includes("org-alpha"), false);
  });
});

interface Harness {
  readonly app: Express;
  readonly inputs: AddIncidentNoteCommand[];
  result: {
    id: string;
    incidentId: string;
    authorId: string;
    authorName: string;
    content: string;
    createdAt: Date;
  } | null;
  addActiveToken(token: string, role: AuthRole, orgId: string): void;
}

function createHarness(): Harness {
  const jwtService = new FakeJwtService();
  const sessions = new Map<string, SessionRecord>();
  const users = new Map<string, UserRecord>();
  const inputs: AddIncidentNoteCommand[] = [];
  const harness: Harness = {
    app: express(),
    inputs,
    result: {
      id: NOTE_ID,
      incidentId: INCIDENT_ID,
      authorId: USER_ID,
      authorName: "incident-operator",
      content: "**Host isolated**",
      createdAt: new Date("2026-10-20T01:00:00.000Z"),
    },
    addActiveToken(token, role, orgId) {
      const jwtId = `jwt-${token}`;
      const now = Math.floor(Date.now() / 1000);
      jwtService.claimsByToken.set(token, {
        sub: USER_ID,
        username: "incident-operator",
        role,
        jti: jwtId,
        iat: now,
        exp: now + 3600,
        iss: "ai-siem",
      });
      sessions.set(jwtId, createSession(jwtId));
      users.set(USER_ID, createUser(role, orgId));
    },
  };

  harness.app.use(express.json({ limit: "32kb" }));
  harness.app.use(
    "/api/v1/incidents",
    createIncidentQueryRouter({
      authentication: {
        jwtService,
        sessionRepository: {
          async findByJwtId(jwtId) {
            return sessions.get(jwtId) ?? null;
          },
        },
        userRepository: {
          async findById(id) {
            return users.get(id) ?? null;
          },
        },
        config: TEST_CONFIG,
      },
      listIncidentsUseCase: {
        async execute() {
          throw new Error("Outside INC-03C test scope.");
        },
      },
      getIncidentDetailUseCase: {
        async execute() {
          throw new Error("Outside INC-03C test scope.");
        },
      },
      addIncidentNoteUseCase: {
        async execute(input) {
          inputs.push(input);
          if (harness.result === null) return null;
          return { ...harness.result, content: input.content };
        },
      },
    }),
  );
  harness.app.use(testErrorMiddleware);
  return harness;
}

class FakeJwtService implements IJwtService {
  public readonly claimsByToken = new Map<string, JwtClaims>();
  public async sign(claims: JwtClaims): Promise<string> {
    return `signed:${claims.jti}`;
  }
  public async verify(token: string): Promise<JwtClaims> {
    const claims = this.claimsByToken.get(token);
    if (claims === undefined) throw new Error("invalid token");
    return claims;
  }
}

function createSession(jwtId: string): SessionRecord {
  return {
    id: "00000000-0000-4000-8000-000000000801",
    userId: USER_ID,
    jwtId,
    ipAddress: "127.0.0.1",
    userAgent: "inc-03c-test",
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    revokedAt: null,
  };
}

function createUser(role: AuthRole, orgId: string): UserRecord {
  return {
    id: USER_ID,
    username: "incident-operator",
    email: "operator@example.test",
    passwordHash: "hash",
    role,
    displayName: "Incident Operator",
    isActive: true,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    orgId,
  };
}

function requestNote(
  baseUrl: string,
  incidentId: string,
  content: string,
  token?: string,
) {
  return requestJson(
    baseUrl,
    `/api/v1/incidents/${incidentId}/notes`,
    { content },
    token,
  );
}

async function requestJson(
  baseUrl: string,
  path: string,
  body: unknown,
  token?: string,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
}

function testErrorMiddleware(
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction,
): Response {
  return response.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: error instanceof Error ? error.message : "Something went wrong.",
    },
  });
}

function withServer(
  app: Express,
  operation: (baseUrl: string) => Promise<void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const server: Server = app.listen(0, "127.0.0.1", async () => {
      try {
        const address = server.address() as AddressInfo;
        await operation(`http://127.0.0.1:${address.port}`);
        server.close((error) => (error ? reject(error) : resolve()));
      } catch (error) {
        server.close(() => reject(error));
      }
    });
    server.once("error", reject);
  });
}

const TEST_CONFIG: AppConfig = {
  server: { port: 3000, nodeEnv: "test", apiPrefix: "/api/v1" },
  database: {
    DATABASE_URL: "postgres://example.test/trivikrama",
    MONGODB_URI: "mongodb://example.test/trivikrama",
    REDIS_URL: "redis://example.test:6379",
    postgres: {
      poolMin: 1,
      poolMax: 2,
      connectionTimeoutMs: 5000,
      queryTimeoutMs: 30000,
    },
    mongodb: { poolSize: 2, serverSelectionTimeoutMs: 5000 },
    redis: { keyPrefix: "trivikrama-test" },
  },
  jwt: {
    algorithm: "HS256",
    secret: "test-jwt-secret-that-is-long-enough-for-inc-03c-http",
    accessTokenExpiry: "1h",
    refreshWindow: "5m",
    maxSessionDuration: "7d",
    issuer: "ai-siem",
    cookie: {
      name: "siem_token",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
    },
  },
  auth: {
    bcryptRounds: 12,
    lockoutAttempts: 5,
    lockoutMinutes: 15,
    rateLimitPerMinute: 10,
  },
  security: {
    bcryptSaltRounds: 12,
    collectorHmacSecret: "collector-hmac-secret-for-inc-03c-http-test",
  },
  collector: {
    directory: "./collector",
    trust: {
      collectorId: "collector-test-01",
      keyId: "collector-key-test-01",
      secretBase64Url:
        "c8Wm1Qx4Ny7Rt2Ks5Vb9Lp3Hd6Fj0Za8Pe1Uy4Mi7Go2Cq5Xs9Dv3Ln6Ak0Jr8Tw",
    },
  },
  ai: {
    engineUrl: "http://localhost:8000",
    timeoutMs: 5000,
    batchSize: 100,
    threshold: 0.65,
    circuitFailureThreshold: 5,
    circuitCooldownMs: 60000,
    circuitSuccessThreshold: 2,
  },
  frontend: { url: "http://localhost:3001" },
  logging: { level: "debug", format: "pretty" },
};

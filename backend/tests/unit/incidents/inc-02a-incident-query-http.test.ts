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
import type {
  GetIncidentQuery,
  IncidentQueryRecord,
  ListIncidentsQuery,
} from "../../../src/modules/incidents/domain/incident-query.contracts.js";
import { createIncidentQueryRouter } from "../../../src/modules/incidents/http/incident-query.routes.js";

const USER_ID = "550e8400-e29b-41d4-a716-446655440001";
const INCIDENT_ID = "00000000-0000-4000-8000-000000000501";

test("incident query endpoints require authentication", async () => {
  const harness = createHarness();

  await withServer(harness.app, async (baseUrl) => {
    for (const path of ["/api/v1/incidents", `/api/v1/incidents/${INCIDENT_ID}`]) {
      const response = await requestJson(baseUrl, path);
      assert.equal(response.status, 401);
      assert.equal(response.body.error.code, "UNAUTHORIZED");
    }
  });

  assert.equal(harness.listInputs.length, 0);
  assert.equal(harness.detailInputs.length, 0);
});

for (const role of ["admin", "security_engineer", "soc_analyst"] as const) {
  test(`GET /incidents allows authenticated ${role}`, async () => {
    const harness = createHarness();
    harness.addActiveToken(`${role}-token`, role, `org-${role}`);

    await withServer(harness.app, async (baseUrl) => {
      const response = await requestJson(
        baseUrl,
        "/api/v1/incidents?page=2&limit=10&status=open,investigating&severity=high&source=both&sort=riskScore&order=asc&orgId=forged-org",
        `${role}-token`,
      );

      assert.equal(response.status, 200);
      assert.equal(response.body.pagination.page, 2);
      assert.equal(response.body.pagination.limit, 10);
    });

    assert.deepEqual(harness.listInputs[0], {
      orgId: `org-${role}`,
      page: 2,
      limit: 10,
      status: ["open", "investigating"],
      severity: ["high"],
      source: ["both"],
      assignedTo: undefined,
      search: undefined,
      createdFrom: undefined,
      createdTo: undefined,
      sort: "riskScore",
      order: "asc",
    });
  });
}

test("GET /incidents validates allowlisted filters, bounds, and dates", async () => {
  const harness = createHarness();
  harness.addActiveToken("analyst-token", "soc_analyst", "org-alpha");

  await withServer(harness.app, async (baseUrl) => {
    const invalidQueries = [
      "limit=101",
      "status=deleted",
      "sort=created_at%3BDROP%20TABLE%20incidents",
      "from=2026-10-19T00%3A00%3A00Z&to=2026-10-18T00%3A00%3A00Z",
      "assignedTo=not-a-uuid",
    ];

    for (const query of invalidQueries) {
      const response = await requestJson(
        baseUrl,
        `/api/v1/incidents?${query}`,
        "analyst-token",
      );
      assert.equal(response.status, 400, query);
      assert.equal(response.body.error.code, "VALIDATION_ERROR", query);
    }
  });

  assert.equal(harness.listInputs.length, 0);
});

test("GET /incidents/:id validates UUIDs and hides cross-tenant absence as 404", async () => {
  const harness = createHarness();
  harness.addActiveToken("analyst-token", "soc_analyst", "org-alpha");

  await withServer(harness.app, async (baseUrl) => {
    const invalid = await requestJson(
      baseUrl,
      "/api/v1/incidents/not-a-uuid",
      "analyst-token",
    );
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, "VALIDATION_ERROR");

    const absent = await requestJson(
      baseUrl,
      `/api/v1/incidents/${INCIDENT_ID}`,
      "analyst-token",
    );
    assert.equal(absent.status, 404);
    assert.equal(absent.body.error.code, "RESOURCE_NOT_FOUND");
    assert.deepEqual(harness.detailInputs, [
      { incidentId: INCIDENT_ID, orgId: "org-alpha" },
    ]);
  });
});

test("GET /incidents/:id returns the documented incident DTO without orgId", async () => {
  const harness = createHarness();
  harness.detailResult = incidentRecord();
  harness.addActiveToken("analyst-token", "soc_analyst", "org-alpha");

  await withServer(harness.app, async (baseUrl) => {
    const response = await requestJson(
      baseUrl,
      `/api/v1/incidents/${INCIDENT_ID}`,
      "analyst-token",
    );

    assert.equal(response.status, 200);
    assert.equal(response.body.id, INCIDENT_ID);
    assert.equal(response.body.createdAt, "2026-07-26T05:10:00.000Z");
    assert.equal("orgId" in response.body, false);
  });
});

interface Harness {
  readonly app: Express;
  readonly listInputs: ListIncidentsQuery[];
  readonly detailInputs: GetIncidentQuery[];
  detailResult: IncidentQueryRecord | null;
  addActiveToken(token: string, role: AuthRole, orgId: string): void;
}

function createHarness(): Harness {
  const jwtService = new FakeJwtService();
  const sessions = new Map<string, SessionRecord>();
  const users = new Map<string, UserRecord>();
  const listInputs: ListIncidentsQuery[] = [];
  const detailInputs: GetIncidentQuery[] = [];
  const harness: Harness = {
    app: express(),
    listInputs,
    detailInputs,
    detailResult: null,
    addActiveToken(token, role, orgId) {
      const jwtId = `jwt-${token}`;
      const nowSeconds = Math.floor(Date.now() / 1000);
      jwtService.claimsByToken.set(token, {
        sub: USER_ID,
        username: "incident-reader",
        role,
        jti: jwtId,
        iat: nowSeconds,
        exp: nowSeconds + 3600,
        iss: "ai-siem",
      });
      sessions.set(jwtId, createSession(jwtId));
      users.set(USER_ID, createUser(role, orgId));
    },
  };

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
        async execute(input) {
          listInputs.push(input);
          return {
            data: [],
            pagination: {
              page: input.page,
              limit: input.limit,
              total: 0,
              totalPages: 0,
              hasNext: false,
              hasPrev: input.page > 1,
            },
          };
        },
      },
      getIncidentDetailUseCase: {
        async execute(input) {
          detailInputs.push(input);
          return harness.detailResult;
        },
      },
    }),
  );
  harness.app.use(testErrorMiddleware);

  return harness;
}

function testErrorMiddleware(
  _error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction,
): Response {
  return response.status(500).json({
    error: { code: "INTERNAL_SERVER_ERROR", message: "Something went wrong." },
  });
}

class FakeJwtService implements IJwtService {
  public readonly claimsByToken = new Map<string, JwtClaims>();

  public async sign(claims: JwtClaims): Promise<string> {
    return `signed:${claims.jti}`;
  }

  public async verify(token: string): Promise<JwtClaims> {
    const claims = this.claimsByToken.get(token);
    if (claims === undefined) throw new Error("Unknown token.");
    return claims;
  }
}

function createSession(jwtId: string): SessionRecord {
  return {
    id: `session-${jwtId}`,
    userId: USER_ID,
    jwtId,
    ipAddress: "127.0.0.1",
    userAgent: "inc-02a-test",
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    revokedAt: null,
  };
}

function createUser(role: AuthRole, orgId: string): UserRecord {
  return {
    id: USER_ID,
    username: "incident-reader",
    email: "incident-reader@example.test",
    passwordHash: "not-a-real-hash",
    role,
    displayName: "Incident Reader",
    isActive: true,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    orgId,
  };
}

function incidentRecord(): IncidentQueryRecord {
  return {
    id: INCIDENT_ID,
    title: "HIGH — SSH brute force",
    description: "Repeated failed logins.",
    status: "open",
    severity: "high",
    riskScore: 78.5,
    source: "both",
    scoreBreakdown: {},
    primaryEntity: "192.168.1.100",
    entityType: "src_ip",
    entities: [{ type: "src_ip", value: "192.168.1.100" }],
    killChainStages: ["credential_access"],
    alertCount: 2,
    eventCount: 12,
    assignedTo: null,
    firstEventAt: new Date("2026-07-26T05:10:00.000Z"),
    lastEventAt: new Date("2026-07-26T05:20:00.000Z"),
    createdAt: new Date("2026-07-26T05:10:00.000Z"),
    updatedAt: new Date("2026-07-26T05:20:00.000Z"),
    resolvedAt: null,
    closedAt: null,
  };
}

async function requestJson(baseUrl: string, path: string, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: (await response.json()) as any };
}

async function withServer(
  app: Express,
  operation: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = await new Promise<Server>((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.once("error", reject);
  });
  const address = server.address() as AddressInfo;

  try {
    await operation(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
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
    secret: "test-jwt-secret-that-is-long-enough-for-incident-query-tests",
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
    collectorHmacSecret: "collector-hmac-secret-for-incident-query-tests",
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

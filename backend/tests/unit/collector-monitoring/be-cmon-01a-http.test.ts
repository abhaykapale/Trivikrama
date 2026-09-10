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
import { createCollectorMonitoringRouter } from "../../../src/modules/collector-monitoring/http/collector-monitoring.routes.js";

const USER_ID = "550e8400-e29b-41d4-a716-446655440001";

test("GET /api/v1/collector/status requires authentication", async () => {
  const harness = createHarness();

  await withServer(harness.app, async (baseUrl) => {
    const response = await requestJson(baseUrl);

    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, "UNAUTHORIZED");
    assert.equal(harness.receivedOrgIds.length, 0);
  });
});

test("GET /api/v1/collector/status rejects an invalid token", async () => {
  const harness = createHarness();

  await withServer(harness.app, async (baseUrl) => {
    const response = await requestJson(baseUrl, "invalid-token");

    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, "UNAUTHORIZED");
    assert.equal(harness.receivedOrgIds.length, 0);
  });
});

for (const role of ["admin", "security_engineer", "soc_analyst"] as const) {
  test(`GET /api/v1/collector/status allows authenticated ${role}`, async () => {
    const harness = createHarness();
    harness.addActiveToken(`${role}-token`, role, `org-${role}`);

    await withServer(harness.app, async (baseUrl) => {
      const response = await requestJson(baseUrl, `${role}-token`);

      assert.equal(response.status, 200);
      assert.deepEqual(response.body, { collectors: [] });
      assert.deepEqual(harness.receivedOrgIds, [`org-${role}`]);
    });
  });
}

test("GET /api/v1/collector/status returns a generic error on failure", async () => {
  const harness = createHarness(true);
  harness.addActiveToken("analyst-token", "soc_analyst", "org-alpha");

  await withServer(harness.app, async (baseUrl) => {
    const response = await requestJson(baseUrl, "analyst-token");

    assert.equal(response.status, 500);
    assert.equal(response.body.error.code, "INTERNAL_SERVER_ERROR");
    assert.equal(response.body.error.message, "Something went wrong.");
    assert.equal(JSON.stringify(response.body).includes("PostgreSQL"), false);
  });
});

interface Harness {
  readonly app: Express;
  readonly receivedOrgIds: string[];
  addActiveToken(token: string, role: AuthRole, orgId: string): void;
}

function createHarness(fail = false): Harness {
  const jwtService = new FakeJwtService();
  const sessionRepository = new FakeSessionRepository();
  const userRepository = new FakeUserRepository();
  const receivedOrgIds: string[] = [];
  const app = express();

  app.use(
    "/api/v1/collector",
    createCollectorMonitoringRouter({
      authentication: {
        jwtService,
        sessionRepository,
        userRepository,
        config: TEST_CONFIG,
      },
      getCollectorStatusUseCase: {
        async execute({ orgId }) {
          receivedOrgIds.push(orgId);

          if (fail) {
            throw new Error("PostgreSQL connection details must stay private.");
          }

          return { collectors: [] };
        },
      },
    }),
  );
  app.use(testErrorMiddleware);

  return {
    app,
    receivedOrgIds,
    addActiveToken(token, role, orgId) {
      const jwtId = `jwt-${token}`;
      const nowSeconds = Math.floor(Date.now() / 1000);

      jwtService.claimsByToken.set(token, {
        sub: USER_ID,
        username: "monitor-user",
        role,
        jti: jwtId,
        iat: nowSeconds,
        exp: nowSeconds + 3600,
        iss: "ai-siem",
      });
      sessionRepository.sessions.set(jwtId, createSession(jwtId));
      userRepository.users.set(USER_ID, createUser(role, orgId));
    },
  };
}

function testErrorMiddleware(
  _error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction,
): Response {
  return response.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Something went wrong.",
    },
  });
}

class FakeJwtService implements IJwtService {
  public readonly claimsByToken = new Map<string, JwtClaims>();

  public async sign(claims: JwtClaims): Promise<string> {
    return `signed:${claims.jti}`;
  }

  public async verify(token: string): Promise<JwtClaims> {
    const claims = this.claimsByToken.get(token);

    if (claims === undefined) {
      throw new Error("Unknown token.");
    }

    return claims;
  }
}

class FakeSessionRepository {
  public readonly sessions = new Map<string, SessionRecord>();

  public async findByJwtId(jwtId: string): Promise<SessionRecord | null> {
    return this.sessions.get(jwtId) ?? null;
  }
}

class FakeUserRepository {
  public readonly users = new Map<string, UserRecord>();

  public async findById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }
}

function createSession(jwtId: string): SessionRecord {
  return {
    id: `session-${jwtId}`,
    userId: USER_ID,
    jwtId,
    ipAddress: "127.0.0.1",
    userAgent: "be-cmon-01a-test",
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    revokedAt: null,
  };
}

function createUser(role: AuthRole, orgId: string): UserRecord {
  return {
    id: USER_ID,
    username: "monitor-user",
    email: "monitor@example.test",
    passwordHash: "not-a-real-hash",
    role,
    displayName: "Monitor User",
    isActive: true,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    orgId,
  };
}

async function requestJson(baseUrl: string, token?: string) {
  const response = await fetch(`${baseUrl}/api/v1/collector/status`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });

  return {
    status: response.status,
    body: (await response.json()) as any,
  };
}

async function withServer(
  app: Express,
  operation: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = await listen(app);
  const address = server.address() as AddressInfo;

  try {
    await operation(`http://127.0.0.1:${address.port}`);
  } finally {
    await close(server);
  }
}

function listen(app: Express): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
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
    secret: "test-jwt-secret-that-is-long-enough-for-cmon-http-validation",
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
    collectorHmacSecret: "collector-hmac-secret-for-cmon-http-test",
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
  },
  frontend: { url: "http://localhost:3001" },
  logging: { level: "debug", format: "pretty" },
};

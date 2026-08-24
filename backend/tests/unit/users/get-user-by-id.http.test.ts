import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import express, { type Express } from "express";

import type { AppConfig } from "../../../src/config/index.js";
import type {
  AuthRole,
  IJwtService,
  JwtClaims,
  SessionRecord,
  UserRecord,
} from "../../../src/modules/auth/domain/index.js";
import { ListUsersUseCase } from "../../../src/modules/users/application/use-case/list-users.use-case.js";
import { GetUserByIdUseCase } from "../../../src/modules/users/application/use-case/list-getuser.use-case.js";
import type {
  GetManagedUserInput,
  IUserManagementRepository,
  ManagedUserFilters,
  ManagedUserRecord,
  PageResult,
} from "../../../src/modules/users/domain/user-management.contracts.js";
import { createUsersRouter } from "../../../src/modules/users/http/index.js";
import errorMiddleware from "../../../src/middleware/error.middleware.js";

const ADMIN_ID = "550e8400-e29b-41d4-a716-446655440001";
const TARGET_USER_ID = "550e8400-e29b-41d4-a716-446655440002";
const UNKNOWN_USER_ID = "550e8400-e29b-41d4-a716-446655440099";

const TEST_CONFIG: AppConfig = {
  server: {
    port: 3000,
    nodeEnv: "test",
    apiPrefix: "/api/v1",
  },
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
    mongodb: {
      poolSize: 2,
      serverSelectionTimeoutMs: 5000,
    },
    redis: {
      keyPrefix: "trivikrama-test",
    },
  },
  jwt: {
    algorithm: "HS256",
    secret:
      "test-jwt-secret-that-is-long-enough-for-production-like-validation",
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
    collectorHmacSecret: "collector-hmac-secret-for-get-user-test",
  },
  collector: {
    directory: "./collector",
  },
  ai: {
    engineUrl: "http://localhost:8000",
    timeoutMs: 5000,
    batchSize: 100,
    threshold: 0.65,
  },
  frontend: {
    url: "http://localhost:3001",
  },
  logging: {
    level: "debug",
    format: "pretty",
  },
};

class FakeJwtService implements IJwtService {
  public readonly claimsByToken = new Map<string, JwtClaims>();

  public async sign(claims: JwtClaims): Promise<string> {
    return `signed:${claims.jti}`;
  }

  public async verify(token: string): Promise<JwtClaims> {
    const claims = this.claimsByToken.get(token);

    if (claims === undefined) {
      throw new Error("Unknown token");
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

class FakeAuthenticationUserRepository {
  public readonly users = new Map<string, UserRecord>();

  public async findById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }
}

class FakeUserManagementRepository implements IUserManagementRepository {
  public readonly receivedGetInputs: GetManagedUserInput[] = [];
  public getResult: ManagedUserRecord | null = null;
  public getError: Error | null = null;

  public async list(
    _filters: ManagedUserFilters,
  ): Promise<PageResult<ManagedUserRecord>> {
    return { items: [], total: 0 };
  }

  public async getById(
    input: GetManagedUserInput,
  ): Promise<ManagedUserRecord | null> {
    this.receivedGetInputs.push(input);

    if (this.getError !== null) {
      throw this.getError;
    }

    return this.getResult;
  }
}

interface TestHarness {
  readonly app: Express;
  readonly managementRepository: FakeUserManagementRepository;
  addActiveToken(token: string, role: AuthRole, orgId?: string): void;
}

function createHarness(): TestHarness {
  const jwtService = new FakeJwtService();
  const sessionRepository = new FakeSessionRepository();
  const authenticationUserRepository = new FakeAuthenticationUserRepository();
  const managementRepository = new FakeUserManagementRepository();

  const listUsersUseCase = new ListUsersUseCase(managementRepository);
  const getUserByIdUseCase = new GetUserByIdUseCase(managementRepository);

  const app = express();
  app.use(express.json());
  app.use(
    "/api/v1/users",
    createUsersRouter({
      authentication: {
        jwtService,
        sessionRepository,
        userRepository: authenticationUserRepository,
        config: TEST_CONFIG,
      },
      listUsersUseCase,
      getUserByIdUseCase,
    }),
  );
  app.use(errorMiddleware);

  return {
    app,
    managementRepository,
    addActiveToken(token: string, role: AuthRole, orgId = "org-123"): void {
      const jwtId = `jwt-${token}`;
      const nowSeconds = Math.floor(Date.now() / 1000);

      jwtService.claimsByToken.set(token, {
        sub: ADMIN_ID,
        username: "request-user",
        role,
        jti: jwtId,
        iat: nowSeconds,
        exp: nowSeconds + 3600,
        iss: "ai-siem",
      });

      sessionRepository.sessions.set(jwtId, {
        id: `session-${token}`,
        userId: ADMIN_ID,
        jwtId,
        ipAddress: "127.0.0.1",
        userAgent: "get-user-test",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        revokedAt: null,
      });

      authenticationUserRepository.users.set(ADMIN_ID, {
        id: ADMIN_ID,
        username: "request-user",
        email: "request-user@example.test",
        passwordHash: "not-a-real-password-hash",
        role,
        displayName: "Request User",
        isActive: true,
        lastLoginAt: null,
        failedLoginCount: 0,
        lockedUntil: null,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
        orgId,
      });
    },
  };
}

test("GET /api/v1/users/:id returns 401 without authentication", async () => {
  const harness = createHarness();

  await withServer(harness.app, async (baseUrl) => {
    const response = await jsonRequest(
      baseUrl,
      `/api/v1/users/${TARGET_USER_ID}`,
    );

    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, "UNAUTHORIZED");
    assert.equal(harness.managementRepository.receivedGetInputs.length, 0);
  });
});

test("GET /api/v1/users/:id returns 401 for an invalid token", async () => {
  const harness = createHarness();

  await withServer(harness.app, async (baseUrl) => {
    const response = await jsonRequest(
      baseUrl,
      `/api/v1/users/${TARGET_USER_ID}`,
      { authorization: "Bearer invalid-token" },
    );

    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, "UNAUTHORIZED");
    assert.equal(harness.managementRepository.receivedGetInputs.length, 0);
  });
});

test("GET /api/v1/users/:id returns 403 for a SOC analyst", async () => {
  const harness = createHarness();
  harness.addActiveToken("analyst-token", "soc_analyst");

  await withServer(harness.app, async (baseUrl) => {
    const response = await jsonRequest(
      baseUrl,
      `/api/v1/users/${TARGET_USER_ID}`,
      { authorization: "Bearer analyst-token" },
    );

    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, "FORBIDDEN");
    assert.equal(harness.managementRepository.receivedGetInputs.length, 0);
  });
});

test("GET /api/v1/users/:id returns 400 for an invalid UUID", async () => {
  const harness = createHarness();
  harness.addActiveToken("admin-token", "admin");

  await withServer(harness.app, async (baseUrl) => {
    const response = await jsonRequest(baseUrl, "/api/v1/users/123", {
      authorization: "Bearer admin-token",
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "VALIDATION_ERROR");
    assert.equal(harness.managementRepository.receivedGetInputs.length, 0);
  });
});

test("GET /api/v1/users/:id returns 404 when the user does not exist", async () => {
  const harness = createHarness();
  harness.addActiveToken("admin-token", "admin", "org-123");

  await withServer(harness.app, async (baseUrl) => {
    const response = await jsonRequest(
      baseUrl,
      `/api/v1/users/${UNKNOWN_USER_ID}`,
      { authorization: "Bearer admin-token" },
    );

    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, "NOT_FOUND");
    assert.deepEqual(harness.managementRepository.receivedGetInputs, [
      {
        userId: UNKNOWN_USER_ID,
        orgId: "org-123",
      },
    ]);
  });
});

test("GET /api/v1/users/:id returns the safe list-item structure for an admin", async () => {
  const harness = createHarness();
  harness.addActiveToken("admin-token", "admin", "org-123");
  harness.managementRepository.getResult = {
    id: TARGET_USER_ID,
    username: "analyst",
    email: "analyst@example.test",
    role: "soc_analyst",
    displayName: "SOC Analyst",
    isActive: true,
    lastLoginAt: new Date("2026-08-20T10:00:00.000Z"),
    createdAt: new Date("2026-08-01T10:00:00.000Z"),
  };

  await withServer(harness.app, async (baseUrl) => {
    const response = await jsonRequest(
      baseUrl,
      `/api/v1/users/${TARGET_USER_ID}`,
      { authorization: "Bearer admin-token" },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      id: TARGET_USER_ID,
      username: "analyst",
      email: "analyst@example.test",
      role: "soc_analyst",
      displayName: "SOC Analyst",
      isActive: true,
      lastLoginAt: "2026-08-20T10:00:00.000Z",
      createdAt: "2026-08-01T10:00:00.000Z",
    });

    assert.deepEqual(harness.managementRepository.receivedGetInputs, [
      {
        userId: TARGET_USER_ID,
        orgId: "org-123",
      },
    ]);

    assert.equal("passwordHash" in response.body, false);
    assert.equal("failedLoginCount" in response.body, false);
    assert.equal("lockedUntil" in response.body, false);
    assert.equal("orgId" in response.body, false);
    assert.equal("updatedAt" in response.body, false);
  });
});

test("GET /api/v1/users/:id does not disclose a user outside the principal organization", async () => {
  const harness = createHarness();
  harness.addActiveToken("admin-token", "admin", "org-admin");

  // The repository/adapter represents an organization mismatch as not found.
  harness.managementRepository.getResult = null;

  await withServer(harness.app, async (baseUrl) => {
    const response = await jsonRequest(
      baseUrl,
      `/api/v1/users/${TARGET_USER_ID}`,
      { authorization: "Bearer admin-token" },
    );

    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, "NOT_FOUND");
    assert.deepEqual(harness.managementRepository.receivedGetInputs, [
      {
        userId: TARGET_USER_ID,
        orgId: "org-admin",
      },
    ]);
  });
});

test("GET /api/v1/users/:id returns a generic 500 for an unexpected repository failure", async () => {
  const harness = createHarness();
  harness.addActiveToken("admin-token", "admin");
  harness.managementRepository.getError = new Error(
    "PostgreSQL connection details must stay private",
  );

  await withServer(harness.app, async (baseUrl) => {
    const response = await jsonRequest(
      baseUrl,
      `/api/v1/users/${TARGET_USER_ID}`,
      { authorization: "Bearer admin-token" },
    );

    assert.equal(response.status, 500);
    assert.equal(response.body.error.code, "INTERNAL_SERVER_ERROR");
    assert.equal(response.body.error.message, "Something went wrong.");
    assert.equal(
      JSON.stringify(response.body).includes("PostgreSQL connection"),
      false,
    );
  });
});

async function jsonRequest(
  baseUrl: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{
  readonly status: number;
  readonly body: Record<string, any>;
}> {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  const body = (await response.json()) as Record<string, any>;

  return {
    status: response.status,
    body,
  };
}

async function withServer(
  app: Express,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = await listen(app);

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await close(server);
  }
}

async function listen(app: Express): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
}

async function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

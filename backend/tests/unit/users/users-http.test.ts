import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import express, { type Express } from "express";

import type { AppConfig } from "../../../src/config/index.js";
import type {
  AuthRole,
  IJwtService,
  ISessionRepository,
  IUserRepository,
  JwtClaims,
  SessionRecord,
  UserRecord,
} from "../../../src/modules/auth/domain/index.js";
import { ListUsersUseCase } from "../../../src/modules/users/application/use-case/list-users.use-case.js";
import type {
  DeactivatedUser,
  DeactivateUserByIdInput,
  GetManagedUserInput,
  IUserManagementRepository,
  ManagedUserFilters,
  ManagedUserRecord,
  PageResult,
} from "../../../src/modules/users/domain/user-management.contracts.js";
import { createUsersRouter } from "../../../src/modules/users/http/index.js";
import { GetUserByIdUseCase } from "../../../src/modules/users/application/use-case/list-getuser.use-case.js";
import { DeactivateUserByIdUseCase } from "../../../src/modules/users/application/use-case/list-detactivate-user.use-case.js";

type TestCase = {
  readonly name: string;
  readonly run: () => Promise<void>;
};

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
    collectorHmacSecret: "collector-hmac-secret-for-users-http-test",
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

  public add(session: SessionRecord): void {
    this.sessions.set(session.jwtId, session);
  }

  public async findByJwtId(jwtId: string): Promise<SessionRecord | null> {
    return this.sessions.get(jwtId) ?? null;
  }
}

class FakeAuthUserRepository {
  public readonly users = new Map<string, UserRecord>();

  public add(user: UserRecord): void {
    this.users.set(user.id, user);
  }

  public async findById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }
}

class FakeUserManagementRepository implements IUserManagementRepository {
  public readonly receivedFilters: ManagedUserFilters[] = [];
  public result: PageResult<ManagedUserRecord> = {
    items: [],
    total: 0,
  };
  public error: Error | null = null;

  public async list(
    filters: ManagedUserFilters,
  ): Promise<PageResult<ManagedUserRecord>> {
    this.receivedFilters.push(filters);

    if (this.error !== null) {
      throw this.error;
    }

    return this.result;
  }
  getById(input: GetManagedUserInput): Promise<ManagedUserRecord | null> {
      return Promise.resolve(null);
  }
  async deactivateUserById(input: DeactivateUserByIdInput): Promise<DeactivatedUser | null> {
    return null;
  }
}

const tests: readonly TestCase[] = [
  {
    name: "GET /api/v1/users returns 401 without authentication",
    run: async () => {
      const harness = createUsersHttpHarness();

      await withServer(harness.app, async (baseUrl) => {
        const response = await jsonRequest(baseUrl, "/api/v1/users");

        assert.equal(response.status, 401);
        assert.equal(response.body.error.code, "UNAUTHORIZED");
        assert.equal(harness.users.receivedFilters.length, 0);
      });
    },
  },
  {
    name: "GET /api/v1/users returns 403 for SOC Analyst",
    run: async () => {
      const harness = createUsersHttpHarness();
      harness.addActiveToken("analyst-token", "soc_analyst", "org-analyst");

      await withServer(harness.app, async (baseUrl) => {
        const response = await jsonRequest(baseUrl, "/api/v1/users", {
          authorization: "Bearer analyst-token",
        });

        assert.equal(response.status, 403);
        assert.equal(response.body.error.code, "FORBIDDEN");
        assert.equal(harness.users.receivedFilters.length, 0);
      });
    },
  },
  {
    name: "GET /api/v1/users returns 400 for invalid query",
    run: async () => {
      const harness = createUsersHttpHarness();
      harness.addActiveToken("admin-token", "admin", "org-123");

      await withServer(harness.app, async (baseUrl) => {
        const response = await jsonRequest(baseUrl, "/api/v1/users?page=0", {
          authorization: "Bearer admin-token",
        });

        assert.equal(response.status, 400);
        assert.equal(response.body.error.code, "VALIDATION_ERROR");
        assert.equal(harness.users.receivedFilters.length, 0);
      });
    },
  },
  {
    name: "GET /api/v1/users returns filtered paginated users for Admin",
    run: async () => {
      const harness = createUsersHttpHarness();
      harness.addActiveToken("admin-token", "admin", "org-123");
      harness.users.result = {
        items: [
          {
            id: "managed-user-1",
            username: "analyst",
            email: "analyst@example.test",
            role: "soc_analyst",
            displayName: "SOC Analyst",
            isActive: false,
            lastLoginAt: null,
            createdAt: new Date("2026-08-01T10:00:00.000Z"),
          },
        ],
        total: 21,
      };

      await withServer(harness.app, async (baseUrl) => {
        const response = await jsonRequest(
          baseUrl,
          "/api/v1/users?page=2&limit=10&role=soc_analyst&isActive=false&search=analyst",
          { authorization: "Bearer admin-token" },
        );

        assert.equal(response.status, 200);
        assert.deepEqual(harness.users.receivedFilters[0], {
          orgId: "org-123",
          limit: 10,
          offset: 10,
          role: "soc_analyst",
          isActive: false,
          search: "analyst",
        });
        assert.deepEqual(response.body.data, [
          {
            id: "managed-user-1",
            username: "analyst",
            email: "analyst@example.test",
            role: "soc_analyst",
            displayName: "SOC Analyst",
            isActive: false,
            lastLoginAt: null,
            createdAt: "2026-08-01T10:00:00.000Z",
          },
        ]);
        assert.deepEqual(response.body.pagination, {
          page: 2,
          limit: 10,
          total: 21,
          totalPages: 3,
          hasNext: true,
          hasPrev: true,
        });
        assert.equal(
          Object.hasOwn(response.body.data[0], "passwordHash"),
          false,
        );
      });
    },
  },
  {
    name: "GET /api/v1/users hides unexpected repository failures",
    run: async () => {
      const harness = createUsersHttpHarness();
      harness.addActiveToken("admin-token", "admin", "org-123");
      harness.users.error = new Error("Database connection failed");

      await withServer(harness.app, async (baseUrl) => {
        const response = await jsonRequest(baseUrl, "/api/v1/users", {
          authorization: "Bearer admin-token",
        });

        assert.equal(response.status, 500);
        assert.equal(response.body.error.code, "INTERNAL_SERVER_ERROR");
        assert.equal(response.body.error.message, "Something went wrong.");
        assert.equal(
          JSON.stringify(response.body).includes("Database connection failed"),
          false,
        );
      });
    },
  },
];

void main();

async function main(): Promise<void> {
  await runTests(tests);
}

async function runTests(testCases: readonly TestCase[]): Promise<void> {
  const startedAt = Date.now();
  const results: Array<{
    readonly name: string;
    readonly status: "pass" | "fail";
    readonly durationMs: number;
    readonly error?: string;
  }> = [];

  for (const test of testCases) {
    const testStartedAt = Date.now();

    try {
      await test.run();
      results.push({
        name: test.name,
        status: "pass",
        durationMs: Date.now() - testStartedAt,
      });
    } catch (error) {
      results.push({
        name: test.name,
        status: "fail",
        durationMs: Date.now() - testStartedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const failed = results.filter((result) => result.status === "fail");
  console.log(
    JSON.stringify(
      {
        success: failed.length === 0,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        totals: {
          tests: results.length,
          passed: results.length - failed.length,
          failed: failed.length,
        },
        results,
      },
      null,
      2,
    ),
  );

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

function createUsersHttpHarness(): {
  readonly app: Express;
  readonly users: FakeUserManagementRepository;
  readonly addActiveToken: (
    token: string,
    role: AuthRole,
    orgId: string,
  ) => void;
} {
  const app = express();
  const jwtService = new FakeJwtService();
  const sessionRepository = new FakeSessionRepository();
  const authUserRepository = new FakeAuthUserRepository();
  const users = new FakeUserManagementRepository();
  const listUsersUseCase = new ListUsersUseCase(users);
  const getUserByIdUseCase = new GetUserByIdUseCase(users);

  app.use(
    `${TEST_CONFIG.server.apiPrefix}/users`,
    createUsersRouter({
      authentication: {
        jwtService,
        sessionRepository: sessionRepository as Pick<
          ISessionRepository,
          "findByJwtId"
        >,
        userRepository: authUserRepository as Pick<IUserRepository, "findById">,
        config: TEST_CONFIG,
      },
      listUsersUseCase,
      getUserByIdUseCase: new GetUserByIdUseCase(users),
      deactivateUserByIdUseCase: new DeactivateUserByIdUseCase(users),
      createUserUseCase: {
        async execute(): Promise<never> {
          throw new Error("Create user is outside this test harness.");
        },
      },
    }),
  );

  return {
    app,
    users,
    addActiveToken(token: string, role: AuthRole, orgId: string): void {
      const jwtId = `jti-${token}`;

      jwtService.claimsByToken.set(
        token,
        makeClaims({
          sub: "user-1",
          role,
          jti: jwtId,
        }),
      );
      authUserRepository.add(makeAuthUser({ role, orgId }));
      sessionRepository.add({
        id: `session-${jwtId}`,
        userId: "user-1",
        jwtId,
        ipAddress: null,
        userAgent: null,
        expiresAt: addSeconds(new Date(), 3600),
        createdAt: new Date(),
        revokedAt: null,
      });
    },
  };
}

async function withServer(
  app: Express,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  console.log("STARTING SERVER");

  const server = await listen(app);

  console.log("SERVER STARTED");

  const address = server.address();

  if (typeof address === "string" || address === null) {
    server.close();
    throw new Error("Expected TCP test server address.");
  }

  try {
    console.log("RUNNING TEST");

    await run(`http://127.0.0.1:${(address as AddressInfo).port}`);

    console.log("TEST REQUEST FINISHED");
  } finally {
    console.log("CLOSING SERVER");

    await closeServer(server);

    console.log("SERVER CLOSED");
  }
}

async function listen(app: Express): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1");
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

async function closeServer(server: Server): Promise<void> {
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

// async function jsonRequest(
//   baseUrl: string,
//   path: string,
//   headers: Record<string, string> = {},
// ): Promise<{
//   readonly status: number;
//   readonly body: Record<string, any>;
// }> {
//   const response = await fetch(`${baseUrl}${path}`, {
//     method: "GET",
//     headers,
//   });
//   const text = await response.text();

//   return {
//     status: response.status,
//     body: text.length === 0 ? {} : JSON.parse(text),
//   };
// }
async function jsonRequest(
  baseUrl: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{
  readonly status: number;
  readonly body: Record<string, any>;
}> {
  console.log("BEFORE FETCH:", path);

  const response = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers,
  });

  console.log("AFTER FETCH:", response.status);

  const text = await response.text();

  console.log("AFTER RESPONSE TEXT");

  return {
    status: response.status,
    body: text.length === 0 ? {} : JSON.parse(text),
  };
}
function makeAuthUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "user-1",
    username: "admin",
    email: "admin@example.test",
    passwordHash: "$2b$12$testhashplaceholder",
    role: "admin",
    displayName: "Administrator",
    isActive: true,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    createdAt: new Date("2026-07-31T00:00:00.000Z"),
    updatedAt: new Date("2026-07-31T00:00:00.000Z"),
    orgId: "org-123",
    ...overrides,
  };
}

function makeClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  const now = Math.floor(Date.now() / 1000);

  return {
    sub: "user-1",
    username: "admin",
    role: "admin",
    jti: "active-jti",
    iat: now,
    exp: now + 3600,
    iss: "ai-siem",
    ...overrides,
  };
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

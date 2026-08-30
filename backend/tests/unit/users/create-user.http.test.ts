import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import express, { type Express } from "express";

import type { AppConfig } from "../../../src/config/index.js";
import errorMiddleware from "../../../src/middleware/error.middleware.js";
import AppError from "../../../src/shared/errors/AppError.js";
import type {
  AuthRole,
  IJwtService,
  JwtClaims,
  SessionRecord,
  UserRecord,
} from "../../../src/modules/auth/domain/index.js";
import type {
  CreateUserCommand,
  CreateUserResult,
} from "../../../src/modules/users/application/use-case/create-user.use-case.js";
import { DeactivateUserByIdUseCase } from "../../../src/modules/users/application/use-case/list-detactivate-user.use-case.js";
import { GetUserByIdUseCase } from "../../../src/modules/users/application/use-case/list-getuser.use-case.js";
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

const ADMIN_ID = "550e8400-e29b-41d4-a716-446655440001";
const CREATED_USER_ID = "550e8400-e29b-41d4-a716-446655440002";

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
        secret: "test-jwt-secret-that-is-long-enough-for-production-validation",
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
        collectorHmacSecret: "collector-hmac-secret-for-create-user-test",
    },
    collector: {
        directory: "./collector",
        trust: {
            collectorId: "collector-test-01",
            keyId: "collector-key-test-01",
            secretBase64Url: "c8Wm1Qx4Ny7Rt2Ks5Vb9Lp3Hd6Fj0Za8Pe1Uy4Mi7Go2Cq5Xs9Dv3Ln6Ak0Jr8Tw",
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
  public async list(
    _filters: ManagedUserFilters,
  ): Promise<PageResult<ManagedUserRecord>> {
    return { items: [], total: 0 };
  }

  public async getById(
    _input: GetManagedUserInput,
  ): Promise<ManagedUserRecord | null> {
    return null;
  }

  public async deactivateUserById(
    _input: DeactivateUserByIdInput,
  ): Promise<DeactivatedUser | null> {
    return null;
  }
}

class FakeCreateUserUseCase {
  public readonly inputs: CreateUserCommand[] = [];
  public error: Error | null = null;
  public result: CreateUserResult = {
    id: CREATED_USER_ID,
    username: "agarcia",
    email: "agarcia@corp.local",
    role: "security_engineer",
    displayName: "Ana Garcia",
    isActive: true,
    createdAt: "2026-08-26T10:00:00.000Z",
  };

  public async execute(input: CreateUserCommand): Promise<CreateUserResult> {
    this.inputs.push(input);

    if (this.error !== null) {
      throw this.error;
    }

    return this.result;
  }
}

interface Harness {
  readonly app: Express;
  readonly createUserUseCase: FakeCreateUserUseCase;
  addActiveToken(token: string, role: AuthRole, orgId?: string): void;
}

function createHarness(): Harness {
  const jwtService = new FakeJwtService();
  const sessions = new FakeSessionRepository();
  const authenticationUsers = new FakeAuthenticationUserRepository();
  const managementUsers = new FakeUserManagementRepository();
  const createUserUseCase = new FakeCreateUserUseCase();
  const app = express();

  app.use(express.json());
  app.use(
    "/api/v1/users",
    createUsersRouter({
      authentication: {
        jwtService,
        sessionRepository: sessions,
        userRepository: authenticationUsers,
        config: TEST_CONFIG,
      },
      listUsersUseCase: new ListUsersUseCase(managementUsers),
      getUserByIdUseCase: new GetUserByIdUseCase(managementUsers),
      deactivateUserByIdUseCase: new DeactivateUserByIdUseCase(
        managementUsers,
      ),
      createUserUseCase,
    }),
  );
  app.use(errorMiddleware);

  return {
    app,
    createUserUseCase,
    addActiveToken(token: string, role: AuthRole, orgId = "org-123"): void {
      const jwtId = `jwt-${token}`;
      const nowSeconds = Math.floor(Date.now() / 1000);

      jwtService.claimsByToken.set(token, {
        sub: ADMIN_ID,
        username: "request-admin",
        role,
        jti: jwtId,
        iat: nowSeconds,
        exp: nowSeconds + 3600,
        iss: "ai-siem",
      });
      sessions.sessions.set(jwtId, {
        id: `session-${token}`,
        userId: ADMIN_ID,
        jwtId,
        ipAddress: "127.0.0.1",
        userAgent: "create-user-test",
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
        revokedAt: null,
      });
      authenticationUsers.users.set(ADMIN_ID, {
        id: ADMIN_ID,
        username: "request-admin",
        email: "request-admin@example.test",
        passwordHash: "not-a-real-password-hash",
        role,
        displayName: "Request Admin",
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

const VALID_BODY = {
  username: "agarcia",
  email: "agarcia@corp.local",
  password: "InitialP@ss123!",
  role: "security_engineer",
  displayName: "Ana Garcia",
};

test("POST /api/v1/users returns 401 without authentication", async () => {
  const harness = createHarness();

  await withServer(harness.app, async (baseUrl) => {
    const response = await jsonRequest(baseUrl, "/api/v1/users", VALID_BODY);

    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, "UNAUTHORIZED");
    assert.equal(harness.createUserUseCase.inputs.length, 0);
  });
});

test("POST /api/v1/users returns 403 for a SOC analyst", async () => {
  const harness = createHarness();
  harness.addActiveToken("analyst-token", "soc_analyst");

  await withServer(harness.app, async (baseUrl) => {
    const response = await jsonRequest(baseUrl, "/api/v1/users", VALID_BODY, {
      authorization: "Bearer analyst-token",
    });

    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, "FORBIDDEN");
    assert.equal(harness.createUserUseCase.inputs.length, 0);
  });
});

test("POST /api/v1/users returns 400 for a weak password", async () => {
  const harness = createHarness();
  harness.addActiveToken("admin-token", "admin");

  await withServer(harness.app, async (baseUrl) => {
    const response = await jsonRequest(
      baseUrl,
      "/api/v1/users",
      { ...VALID_BODY, password: "weak-password" },
      { authorization: "Bearer admin-token" },
    );

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "VALIDATION_ERROR");
    assert.equal(harness.createUserUseCase.inputs.length, 0);
  });
});

test("POST /api/v1/users creates a safe organization-scoped user", async () => {
  const harness = createHarness();
  harness.addActiveToken("admin-token", "admin", "org-admin");

  await withServer(harness.app, async (baseUrl) => {
    const response = await jsonRequest(baseUrl, "/api/v1/users", VALID_BODY, {
      authorization: "Bearer admin-token",
    });

    assert.equal(response.status, 201);
    assert.deepEqual(response.body, harness.createUserUseCase.result);
    assert.equal("password" in response.body, false);
    assert.equal("passwordHash" in response.body, false);
    assert.equal("orgId" in response.body, false);
    assert.deepEqual(harness.createUserUseCase.inputs, [
      {
        ...VALID_BODY,
        orgId: "org-admin",
        actorId: ADMIN_ID,
        actorUsername: "request-admin",
        actorRole: "admin",
        ipAddress: "127.0.0.1",
      },
    ]);
  });
});

test("POST /api/v1/users returns 409 for a duplicate username", async () => {
  const harness = createHarness();
  harness.addActiveToken("admin-token", "admin");
  harness.createUserUseCase.error = new AppError(
    "Username agarcia already exists",
    409,
    "USERNAME_EXISTS",
  );

  await withServer(harness.app, async (baseUrl) => {
    const response = await jsonRequest(baseUrl, "/api/v1/users", VALID_BODY, {
      authorization: "Bearer admin-token",
    });

    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, "USERNAME_EXISTS");
  });
});

test("POST /api/v1/users hides unexpected failures", async () => {
  const harness = createHarness();
  harness.addActiveToken("admin-token", "admin");
  harness.createUserUseCase.error = new Error(
    "PostgreSQL connection details must stay private",
  );

  await withServer(harness.app, async (baseUrl) => {
    const response = await jsonRequest(baseUrl, "/api/v1/users", VALID_BODY, {
      authorization: "Bearer admin-token",
    });

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
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{
  readonly status: number;
  readonly body: Record<string, any>;
}> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  return {
    status: response.status,
    body: (await response.json()) as Record<string, any>,
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

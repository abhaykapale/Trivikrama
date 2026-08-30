import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import express, { type Express, type Request, type Response } from "express";

import type { AppConfig } from "../../../src/config/index.js";
import type { RedisClient } from "../../../src/database/index.js";
import { csrfProtection } from "../../../src/middleware/security/index.js";
import {
  AUTH_APPLICATION_ERROR_CODES,
  AccountLockedError,
  AuthService,
  InvalidCredentialsError,
} from "../../../src/modules/auth/application/index.js";
import type {
  LoginRequestDto,
  LogoutUseCaseInput,
  RefreshTokenRequestDto,
} from "../../../src/modules/auth/application/index.js";
import type {
  IJwtService,
  ISessionRepository,
  IUserRepository,
  SessionRecord,
  UserRecord,
} from "../../../src/modules/auth/domain/index.js";
import type {
  AuthRole,
  JwtClaims,
} from "../../../src/modules/auth/domain/index.js";
import {
  createAuthRouter,
  requirePermission,
  requireRole,
} from "../../../src/modules/auth/http/index.js";
import type { AuthenticatedPrincipal } from "../../../src/modules/auth/http/authenticated-principal.js";

export type TestCase = {
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
        secret: "test-jwt-secret-that-is-long-enough-for-production-like-validation",
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
        collectorHmacSecret: "collector-hmac-secret-for-be01d-verification",
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
    frontend: {
        url: "http://localhost:3001",
    },
    logging: {
        level: "debug",
        format: "pretty",
    },
};

class FakeRedisClient {
  public readonly counts = new Map<string, number>();
  public readonly expires = new Map<string, number>();

  public async incr(key: string): Promise<number> {
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next;
  }

  public async expire(key: string, seconds: number): Promise<number> {
    this.expires.set(key, seconds);
    return 1;
  }
}

class FakeJwtService implements IJwtService {
  public readonly claimsByToken = new Map<string, JwtClaims>();
  public invalidTokens = new Set<string>();

  public async sign(claims: JwtClaims): Promise<string> {
    return `signed:${claims.jti}`;
  }

  public async verify(token: string): Promise<JwtClaims> {
    if (this.invalidTokens.has(token)) {
      throw new Error("Invalid token");
    }

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

class FakeUserRepository {
  public readonly users = new Map<string, UserRecord>();

  public add(user: UserRecord): void {
    this.users.set(user.id, user);
  }

  public async findById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }
}

class FakeAuthService {
  public loginMode: "success" | "invalid" | "locked" = "success";
  public readonly loginRequests: LoginRequestDto[] = [];
  public readonly logoutRequests: LogoutUseCaseInput[] = [];
  public readonly refreshRequests: RefreshTokenRequestDto[] = [];

  public async login(input: LoginRequestDto) {
    this.loginRequests.push(input);

    if (this.loginMode === "invalid") {
      throw new InvalidCredentialsError();
    }

    if (this.loginMode === "locked") {
      throw new AccountLockedError("2026-08-01T00:15:00.000Z");
    }

    return {
      token: "login-token",
      expiresAt: addSeconds(new Date(), 3600).toISOString(),
      user: {
        id: "user-1",
        username: "analyst",
        email: "analyst@example.test",
        role: "soc_analyst" as const,
        displayName: "SOC Analyst",
        lastLoginAt: new Date().toISOString(),
      },
    };
  }

  public async logout(input: LogoutUseCaseInput) {
    this.logoutRequests.push(input);
    return { message: "Logged out successfully" as const };
  }

  public async refreshToken(input: RefreshTokenRequestDto) {
    this.refreshRequests.push(input);
    return {
      token: "rotated-token",
      expiresAt: addSeconds(new Date(), 3600).toISOString(),
    };
  }

  public async getCurrentUser(input: { readonly userId: string }) {
    return {
      id: input.userId,
      username: "analyst",
      email: "analyst@example.test",
      role: "soc_analyst" as const,
      displayName: "SOC Analyst",
      isActive: true,
      lastLoginAt: new Date().toISOString(),
      createdAt: "2026-07-31T00:00:00.000Z",
    };
  }
}

const tests: readonly TestCase[] = [
  {
    name: "POST /api/v1/auth/login sets secure siem_token and CSRF cookies",
    run: async () => {
      const harness = createHttpHarness();

      await withServer(harness.app, async (baseUrl) => {
        const response = await jsonRequest(baseUrl, "/api/v1/auth/login", {
          method: "POST",
          body: {
            username: "analyst",
            password: "CorrectHorseBatteryStaple!123",
          },
        });

        assert.equal(response.status, 200);
        assert.equal(response.body.token, "login-token");
        const cookies = getSetCookieHeader(response.headers);
        assert.match(cookies, /siem_token=login-token/u);
        assert.match(cookies, /HttpOnly/u);
        assert.match(cookies, /Secure/u);
        assert.match(cookies, /SameSite=Strict/u);
        assert.match(cookies, /Max-Age=3600/u);
        assert.match(cookies, /siem_csrf=/u);
      });
    },
  },
  {
    name: "POST /api/v1/auth/login maps validation failure to 400",
    run: async () => {
      const harness = createHttpHarness();

      await withServer(harness.app, async (baseUrl) => {
        const response = await jsonRequest(baseUrl, "/api/v1/auth/login", {
          method: "POST",
          body: {
            username: "bad username",
            password: "short",
          },
        });

        assert.equal(response.status, 400);
        assert.equal(response.body.error.code, "VALIDATION_ERROR");
      });
    },
  },
  {
    name: "POST /api/v1/auth/login maps invalid credentials to generic 401",
    run: async () => {
      const harness = createHttpHarness();
      harness.authService.loginMode = "invalid";

      await withServer(harness.app, async (baseUrl) => {
        const response = await jsonRequest(baseUrl, "/api/v1/auth/login", {
          method: "POST",
          body: {
            username: "missing",
            password: "CorrectHorseBatteryStaple!123",
          },
        });

        assert.equal(response.status, 401);
        assert.equal(
          response.body.error.code,
          AUTH_APPLICATION_ERROR_CODES.INVALID_CREDENTIALS,
        );
        assert.equal(response.body.error.message, "Invalid username or password.");
      });
    },
  },
  {
    name: "POST /api/v1/auth/login maps locked account to 423",
    run: async () => {
      const harness = createHttpHarness();
      harness.authService.loginMode = "locked";

      await withServer(harness.app, async (baseUrl) => {
        const response = await jsonRequest(baseUrl, "/api/v1/auth/login", {
          method: "POST",
          body: {
            username: "analyst",
            password: "CorrectHorseBatteryStaple!123",
          },
        });

        assert.equal(response.status, 423);
        assert.equal(
          response.body.error.code,
          AUTH_APPLICATION_ERROR_CODES.ACCOUNT_LOCKED,
        );
      });
    },
  },
  {
    name: "login rate limit returns 429 after 10 attempts per minute per IP",
    run: async () => {
      const harness = createHttpHarness();

      await withServer(harness.app, async (baseUrl) => {
        for (let attempt = 1; attempt <= 10; attempt += 1) {
          const response = await jsonRequest(baseUrl, "/api/v1/auth/login", {
            method: "POST",
            body: {
              username: "analyst",
              password: "CorrectHorseBatteryStaple!123",
            },
          });
          assert.equal(response.status, 200);
        }

        const limitedResponse = await jsonRequest(baseUrl, "/api/v1/auth/login", {
          method: "POST",
          body: {
            username: "analyst",
            password: "CorrectHorseBatteryStaple!123",
          },
        });

        assert.equal(limitedResponse.status, 429);
        assert.equal(limitedResponse.body.error.code, "RATE_LIMITED");
        assert.equal(limitedResponse.headers.get("retry-after"), "60");
      });
    },
  },
  {
    name: "GET /api/v1/auth/me rejects missing token",
    run: async () => {
      const harness = createHttpHarness();

      await withServer(harness.app, async (baseUrl) => {
        const response = await jsonRequest(baseUrl, "/api/v1/auth/me", {
          method: "GET",
        });

        assert.equal(response.status, 401);
        assert.equal(response.body.error.code, "UNAUTHORIZED");
      });
    },
  },
  {
    name: "GET /api/v1/auth/me accepts Authorization Bearer token",
    run: async () => {
      const harness = createHttpHarness();
      harness.addActiveToken("bearer-token", "bearer-jti");

      await withServer(harness.app, async (baseUrl) => {
        const response = await jsonRequest(baseUrl, "/api/v1/auth/me", {
          method: "GET",
          headers: {
            authorization: "Bearer bearer-token",
          },
        });

        assert.equal(response.status, 200);
        assert.equal(response.body.user.id, "user-1");
        assert.equal(response.body.user.username, "analyst");
        assert.equal(Object.hasOwn(response.body.user, "passwordHash"), false);
      });
    },
  },
  {
    name: "GET /api/v1/auth/me rejects revoked cookie session and clears cookie",
    run: async () => {
      const harness = createHttpHarness();
      harness.addActiveToken("revoked-token", "revoked-jti", {
        revokedAt: new Date(),
      });

      await withServer(harness.app, async (baseUrl) => {
        const response = await jsonRequest(baseUrl, "/api/v1/auth/me", {
          method: "GET",
          headers: {
            cookie: "siem_token=revoked-token",
          },
        });

        assert.equal(response.status, 401);
        assert.match(getSetCookieHeader(response.headers), /siem_token=;/u);
      });
    },
  },
  {
    name: "POST /api/v1/auth/refresh accepts Bearer client without CSRF",
    run: async () => {
      const harness = createHttpHarness();
      harness.addActiveToken("refresh-token", "refresh-jti");

      await withServer(harness.app, async (baseUrl) => {
        const response = await jsonRequest(baseUrl, "/api/v1/auth/refresh", {
          method: "POST",
          headers: {
            authorization: "Bearer refresh-token",
          },
        });

        assert.equal(response.status, 200);
        assert.equal(response.body.token, "rotated-token");
        assert.equal(harness.authService.refreshRequests[0]?.token, "refresh-token");
        assert.match(getSetCookieHeader(response.headers), /siem_token=rotated-token/u);
      });
    },
  },
  {
    name: "POST /api/v1/auth/logout blocks cookie auth without CSRF token",
    run: async () => {
      const harness = createHttpHarness();
      harness.addActiveToken("cookie-token", "cookie-jti");

      await withServer(harness.app, async (baseUrl) => {
        const response = await jsonRequest(baseUrl, "/api/v1/auth/logout", {
          method: "POST",
          headers: {
            cookie: "siem_token=cookie-token",
          },
        });

        assert.equal(response.status, 403);
        assert.equal(response.body.error.code, "FORBIDDEN");
        assert.equal(harness.authService.logoutRequests.length, 0);
      });
    },
  },
  {
    name: "POST /api/v1/auth/logout with CSRF revokes session and clears cookie",
    run: async () => {
      const harness = createHttpHarness();
      harness.addActiveToken("cookie-token", "cookie-jti");

      await withServer(harness.app, async (baseUrl) => {
        const response = await jsonRequest(baseUrl, "/api/v1/auth/logout", {
          method: "POST",
          headers: {
            cookie: "siem_token=cookie-token; siem_csrf=csrf-123",
            "x-csrf-token": "csrf-123",
          },
        });

        assert.equal(response.status, 200);
        assert.equal(response.body.message, "Logged out successfully");
        assert.equal(harness.authService.logoutRequests[0]?.session.jwtId, "cookie-jti");
        const cookies = getSetCookieHeader(response.headers);
        assert.match(cookies, /siem_token=;/u);
        assert.match(cookies, /siem_csrf=;/u);
      });
    },
  },
  {
    name: "RBAC middleware returns 403 for insufficient role or permission",
    run: async () => {
      const app = express();
      app.get(
        "/requires-admin",
        attachPrincipal("soc_analyst"),
        requireRole("admin"),
        (_request, response) => response.status(204).send(),
      );
      app.get(
        "/requires-audit",
        attachPrincipal("soc_analyst"),
        requirePermission("audit.view"),
        (_request, response) => response.status(204).send(),
      );
      app.get(
        "/engineer-audit",
        attachPrincipal("security_engineer"),
        requirePermission("audit.view"),
        (_request, response) => response.status(204).send(),
      );

      await withServer(app, async (baseUrl) => {
        assert.equal(
          (await jsonRequest(baseUrl, "/requires-admin", { method: "GET" })).status,
          403,
        );
        assert.equal(
          (await jsonRequest(baseUrl, "/requires-audit", { method: "GET" })).status,
          403,
        );
        assert.equal(
          (await jsonRequest(baseUrl, "/engineer-audit", { method: "GET" })).status,
          204,
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

function createHttpHarness(): {
  readonly app: Express;
  readonly authService: FakeAuthService;
  readonly addActiveToken: (
    token: string,
    jwtId: string,
    overrides?: Partial<SessionRecord>,
  ) => void;
} {
  const app = express();
  const authService = new FakeAuthService();
  const jwtService = new FakeJwtService();
  const sessionRepository = new FakeSessionRepository();
  const userRepository = new FakeUserRepository();

  userRepository.add(makeUser());

  app.use(express.json({ limit: "1mb" }));
  app.use(
    csrfProtection({
      config: TEST_CONFIG,
      exemptPaths: [`${TEST_CONFIG.server.apiPrefix}/auth/login`],
    }),
  );
  app.use(
    `${TEST_CONFIG.server.apiPrefix}/auth`,
    createAuthRouter({
      authService: authService as unknown as AuthService,
      jwtService,
      sessionRepository: sessionRepository as unknown as Pick<
        ISessionRepository,
        "findByJwtId"
      >,
      userRepository: userRepository as unknown as Pick<IUserRepository, "findById">,
      redisClient: new FakeRedisClient() as unknown as RedisClient,
      config: TEST_CONFIG,
    }),
  );

  return {
    app,
    authService,
    addActiveToken(
      token: string,
      jwtId: string,
      overrides: Partial<SessionRecord> = {},
    ): void {
      jwtService.claimsByToken.set(token, makeClaims({ jti: jwtId }));
      sessionRepository.add({
        id: `session-${jwtId}`,
        userId: "user-1",
        jwtId,
        ipAddress: null,
        userAgent: null,
        expiresAt: addSeconds(new Date(), 3600),
        createdAt: new Date(),
        revokedAt: null,
        ...overrides,
      });
    },
  };
}

function attachPrincipal(role: AuthRole) {
  return (request: Request, _response: Response, next: () => void): void => {
    request.user = {
      userId: "user-1",
      username: "analyst",
      role,
      orgId: "default",
      sessionId: "session-1",
      jwtId: "jti-1",
      issuedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-08-01T01:00:00.000Z",
      issuer: "ai-siem",
      tokenSource: "bearer",
    } satisfies AuthenticatedPrincipal;
    next();
  };
}

async function withServer(
  app: Express,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = await listen(app);
  const address = server.address();

  if (typeof address === "string" || address === null) {
    server.close();
    throw new Error("Expected TCP test server address.");
  }

  try {
    await run(`http://127.0.0.1:${(address as AddressInfo).port}`);
  } finally {
    await closeServer(server);
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

async function jsonRequest(
  baseUrl: string,
  path: string,
  options: {
    readonly method: "GET" | "POST";
    readonly headers?: Record<string, string>;
    readonly body?: Record<string, unknown>;
  },
): Promise<{
  readonly status: number;
  readonly headers: Headers;
  readonly body: Record<string, any>;
}> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method,
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();

  return {
    status: response.status,
    headers: response.headers,
    body: text.length === 0 ? {} : JSON.parse(text),
  };
}

function getSetCookieHeader(headers: Headers): string {
  const withSetCookie = headers as Headers & {
    readonly getSetCookie?: () => string[];
  };

  if (typeof withSetCookie.getSetCookie === "function") {
    return withSetCookie.getSetCookie().join("\n");
  }

  return headers.get("set-cookie") ?? "";
}

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "user-1",
    username: "analyst",
    email: "analyst@example.test",
    passwordHash: "$2b$12$testhashplaceholder",
    role: "soc_analyst",
    displayName: "SOC Analyst",
    isActive: true,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    createdAt: new Date("2026-07-31T00:00:00.000Z"),
    updatedAt: new Date("2026-07-31T00:00:00.000Z"),
    orgId: "default",
    ...overrides,
  };
}

function makeClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  const now = Math.floor(Date.now() / 1000);

  return {
    sub: "user-1",
    username: "analyst",
    role: "soc_analyst",
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

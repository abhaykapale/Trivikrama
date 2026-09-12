import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import express, { type Express } from "express";

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

test("GET /collector/quarantine requires authentication", async () => {
  const harness = createHarness();
  const response = await call(harness.app);

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "UNAUTHORIZED");
  assert.equal(harness.inputs.length, 0);
});

test("GET /collector/quarantine rejects a SOC analyst", async () => {
  const harness = createHarness();
  harness.addToken("analyst", "soc_analyst");
  const response = await call(harness.app, "analyst");

  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, "FORBIDDEN");
  assert.equal(harness.inputs.length, 0);
});

for (const role of ["admin", "security_engineer"] as const) {
  test(`GET /collector/quarantine allows ${role} with pagination`, async () => {
    const harness = createHarness();
    harness.addToken(role, role);
    const response = await call(harness.app, role, "?page=2&limit=10");

    assert.equal(response.status, 200);
    assert.deepEqual(harness.inputs, [{ page: 2, limit: 10 }]);
    assert.deepEqual(response.body, {
      data: [],
      pagination: { page: 2, limit: 10, total: 0, totalPages: 0 },
    });
  });
}

test("GET /collector/quarantine applies documented pagination defaults", async () => {
  const harness = createHarness();
  harness.addToken("admin", "admin");
  const response = await call(harness.app, "admin");

  assert.equal(response.status, 200);
  assert.deepEqual(harness.inputs, [{ page: 1, limit: 25 }]);
});

test("GET /collector/quarantine rejects invalid pagination", async () => {
  const harness = createHarness();
  harness.addToken("engineer", "security_engineer");
  const response = await call(harness.app, "engineer", "?page=0&limit=101");

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
  assert.equal(harness.inputs.length, 0);
});

interface Harness {
  readonly app: Express;
  readonly inputs: Array<{ readonly page: number; readonly limit: number }>;
  addToken(token: string, role: AuthRole): void;
}

function createHarness(): Harness {
  const roles = new Map<string, AuthRole>();
  const inputs: Array<{ readonly page: number; readonly limit: number }> = [];
  const jwtService: IJwtService = {
    async sign(claims: JwtClaims) {
      return claims.jti;
    },
    async verify(token: string) {
      const role = roles.get(token);

      if (role === undefined) {
        throw new Error("Unknown token.");
      }

      const now = Math.floor(Date.now() / 1000);
      return {
        sub: USER_ID,
        username: "monitor-user",
        role,
        jti: token,
        iat: now,
        exp: now + 3600,
        iss: "ai-siem",
      };
    },
  };
  const app = express();

  app.use(
    "/api/v1/collector",
    createCollectorMonitoringRouter({
      authentication: {
        jwtService,
        sessionRepository: {
          async findByJwtId(jwtId: string): Promise<SessionRecord | null> {
            return roles.has(jwtId) ? createSession(jwtId) : null;
          },
        },
        userRepository: {
          async findById(): Promise<UserRecord | null> {
            const role = [...roles.values()][0];
            return role === undefined ? null : createUser(role);
          },
        },
        config: TEST_CONFIG,
      },
      getCollectorStatusUseCase: {
        async execute() {
          throw new Error("Status endpoint is not under test.");
        },
      },
      listQuarantinedFilesUseCase: {
        async execute(input) {
          inputs.push(input);
          return {
            data: [],
            pagination: {
              ...input,
              total: 0,
              totalPages: 0,
            },
          };
        },
      },
    }),
  );

  return {
    app,
    inputs,
    addToken(token, role) {
      roles.clear();
      roles.set(token, role);
    },
  };
}

function createSession(jwtId: string): SessionRecord {
  return {
    id: `session-${jwtId}`,
    userId: USER_ID,
    jwtId,
    ipAddress: "127.0.0.1",
    userAgent: "be-cmon-01d-test",
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    revokedAt: null,
  };
}

function createUser(role: AuthRole): UserRecord {
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
    createdAt: new Date(),
    updatedAt: new Date(),
    orgId: "org-alpha",
  };
}

async function call(app: Express, token?: string, query = "") {
  const server = await listen(app);
  const address = server.address() as AddressInfo;

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/collector/quarantine${query}`,
      { headers: token === undefined ? {} : { authorization: `Bearer ${token}` } },
    );

    return {
      status: response.status,
      body: (await response.json()) as Record<string, any>,
    };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function listen(app: Express): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const TEST_CONFIG = {
  jwt: {
    cookie: {
      name: "siem_token",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
    },
  },
} as AppConfig;

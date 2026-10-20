import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";

import type { AppConfig } from "../../../src/config/index.js";
import {
  closePostgres,
  createPostgresClient,
  pingPostgres,
} from "../../../src/database/postgres/client.js";
import { PostgresIncidentRepository } from "../../../src/database/repositories/incidents/postgres-incident.repository.js";
import type {
  IJwtService,
  JwtClaims,
  SessionRecord,
  UserRecord,
} from "../../../src/modules/auth/domain/index.js";
import { createIncidentQueryDependencies } from "../../../src/modules/incidents/composition/incident-query.dependencies.js";
import { createIncidentQueryRouter } from "../../../src/modules/incidents/http/incident-query.routes.js";

test("INC-02A HTTP queries filter, paginate, and isolate organizations in PostgreSQL", async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("INC-02A integration tests refuse to run in production.");
  }

  const visibleHighId = randomUUID();
  const visibleMediumId = randomUUID();
  const hiddenId = randomUUID();
  const userId = randomUUID();
  const visibleOrgId = `inc-02a-visible-${randomUUID()}`;
  const hiddenOrgId = `inc-02a-hidden-${randomUUID()}`;
  const postgres = createPostgresClient({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://trivikrama_app:trivikrama_app_password@localhost:5432/trivikrama",
    poolMin: 0,
    poolMax: 2,
    acquireConnectionTimeoutMs: 5_000,
  });
  let server: Server | null = null;

  try {
    await pingPostgres(postgres);
    const incidents = new PostgresIncidentRepository(postgres);
    await incidents.create({
      id: visibleHighId,
      orgId: visibleOrgId,
      title: "HIGH — SSH integration probe",
      description: "Visible incident",
      severity: "high",
      riskScore: 91,
      source: "both",
      primaryEntity: "192.0.2.10",
      entityType: "src_ip",
      entities: [{ type: "src_ip", value: "192.0.2.10" }],
      alertCount: 3,
      eventCount: 7,
    });
    await incidents.create({
      id: visibleMediumId,
      orgId: visibleOrgId,
      title: "Medium process anomaly",
      severity: "medium",
      riskScore: 50,
      source: "ai",
    });
    await incidents.create({
      id: hiddenId,
      orgId: hiddenOrgId,
      title: "HIGH — SSH hidden tenant",
      severity: "high",
      riskScore: 99,
      source: "both",
    });

    const jwtService = new StaticJwtService(userId);
    const dependencies = createIncidentQueryDependencies(postgres);
    const app = express();
    app.use(
      "/api/v1/incidents",
      createIncidentQueryRouter({
        authentication: {
          jwtService,
          sessionRepository: {
            async findByJwtId(): Promise<SessionRecord> {
              return createSession(userId, jwtService.claims.jti);
            },
          },
          userRepository: {
            async findById(): Promise<UserRecord> {
              return createUser(userId, visibleOrgId);
            },
          },
          config: TEST_CONFIG,
        },
        ...dependencies,
      }),
    );
    app.use(testErrorMiddleware);

    server = await listen(app);
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const headers = { authorization: "Bearer integration-token" };

    const listResponse = await fetch(
      `${baseUrl}/api/v1/incidents?severity=high&source=both&search=SSH&sort=riskScore&order=desc&page=1&limit=1`,
      { headers },
    );
    const listBody = (await listResponse.json()) as any;
    assert.equal(listResponse.status, 200);
    assert.equal(listBody.data.length, 1);
    assert.equal(listBody.data[0].id, visibleHighId);
    assert.equal(listBody.pagination.total, 1);
    assert.equal(listBody.pagination.totalPages, 1);
    assert.equal(JSON.stringify(listBody).includes(hiddenId), false);
    assert.equal(JSON.stringify(listBody).includes(hiddenOrgId), false);
    assert.equal("orgId" in listBody.data[0], false);

    const detailResponse = await fetch(
      `${baseUrl}/api/v1/incidents/${visibleHighId}`,
      { headers },
    );
    const detailBody = (await detailResponse.json()) as any;
    assert.equal(detailResponse.status, 200);
    assert.equal(detailBody.id, visibleHighId);
    assert.equal(detailBody.riskScore, 91);
    assert.equal("orgId" in detailBody, false);

    const hiddenResponse = await fetch(
      `${baseUrl}/api/v1/incidents/${hiddenId}`,
      { headers },
    );
    const hiddenBody = (await hiddenResponse.json()) as any;
    assert.equal(hiddenResponse.status, 404);
    assert.equal(hiddenBody.error.code, "RESOURCE_NOT_FOUND");
    assert.equal(JSON.stringify(hiddenBody).includes(hiddenOrgId), false);
  } finally {
    if (server !== null) {
      await close(server).catch(() => undefined);
    }
    await postgres("public.incidents")
      .whereIn("id", [visibleHighId, visibleMediumId, hiddenId])
      .delete()
      .catch(() => undefined);
    await closePostgres(postgres).catch(() => undefined);
  }
});

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

class StaticJwtService implements IJwtService {
  public readonly claims: JwtClaims;

  public constructor(userId: string) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    this.claims = {
      sub: userId,
      username: "inc-02a-reader",
      role: "soc_analyst",
      jti: `inc-02a-jwt-${randomUUID()}`,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
      iss: "ai-siem",
    };
  }

  public async sign(claims: JwtClaims): Promise<string> {
    return `signed:${claims.jti}`;
  }

  public async verify(): Promise<JwtClaims> {
    return this.claims;
  }
}

function createSession(userId: string, jwtId: string): SessionRecord {
  return {
    id: randomUUID(),
    userId,
    jwtId,
    ipAddress: "127.0.0.1",
    userAgent: "inc-02a-integration",
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    revokedAt: null,
  };
}

function createUser(userId: string, orgId: string): UserRecord {
  return {
    id: userId,
    username: "inc-02a-reader",
    email: "inc-02a-reader@example.test",
    passwordHash: "not-a-real-hash",
    role: "soc_analyst",
    displayName: "INC-02A Reader",
    isActive: true,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    orgId,
  };
}

function listen(app: express.Express): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
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
    secret: "test-jwt-secret-that-is-long-enough-for-inc-02a-integration",
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
    collectorHmacSecret: "collector-hmac-secret-for-inc-02a-integration",
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

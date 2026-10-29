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
import { PostgresAlertRepository } from "../../../src/database/repositories/alerts/postgres-alert.repository.js";
import { PostgresAssetRepository } from "../../../src/database/repositories/assets/postgres-asset.repository.js";
import { PostgresIncidentRepository } from "../../../src/database/repositories/incidents/postgres-incident.repository.js";
import type {
  IJwtService,
  JwtClaims,
  SessionRecord,
  UserRecord,
} from "../../../src/modules/auth/domain/index.js";
import { createIncidentQueryDependencies } from "../../../src/modules/incidents/composition/incident-query.dependencies.js";
import { createIncidentQueryRouter } from "../../../src/modules/incidents/http/incident-query.routes.js";

const ROLLBACK = new Error("INC-02D expected transaction rollback");

test("INC-02D returns tenant-safe 30-day incident, asset, and entity history", async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("INC-02D integration tests refuse to run in production.");
  }

  const currentId = randomUUID();
  const previousId = randomUUID();
  const oldId = randomUUID();
  const foreignId = randomUUID();
  const userId = randomUUID();
  const visibleOrgId = `inc-02d-visible-${randomUUID()}`;
  const foreignOrgId = `inc-02d-hidden-${randomUUID()}`;
  const host = `inc-02d-host-${randomUUID()}`;
  const sourceIp = "192.0.2.44";
  const now = new Date();
  const oneDayAgo = daysAgo(now, 1);
  const fiveDaysAgo = daysAgo(now, 5);
  const fortyDaysAgo = daysAgo(now, 40);
  const entities = [
    { type: "host" as const, value: host },
    { type: "user" as const, value: host },
    { type: "src_ip" as const, value: sourceIp },
  ];
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
    try {
      await postgres.transaction(async (transaction) => {
        const incidents = new PostgresIncidentRepository(transaction);
        const alerts = new PostgresAlertRepository(transaction);
        const assets = new PostgresAssetRepository(transaction);

        for (const input of [
          {
            id: currentId,
            orgId: visibleOrgId,
            title: "Current incident",
            createdAt: oneDayAgo,
          },
          {
            id: previousId,
            orgId: visibleOrgId,
            title: "Previous visible incident",
            createdAt: fiveDaysAgo,
          },
          {
            id: oldId,
            orgId: visibleOrgId,
            title: "Older than the context window",
            createdAt: fortyDaysAgo,
          },
          {
            id: foreignId,
            orgId: foreignOrgId,
            title: "Foreign tenant incident",
            createdAt: fiveDaysAgo,
          },
        ]) {
          await incidents.create({
            id: input.id,
            orgId: input.orgId,
            title: input.title,
            status: "closed",
            severity: "medium",
            riskScore: 40,
            source: "rule",
            primaryEntity: sourceIp,
            entityType: "src_ip",
            entities,
            firstEventAt: input.createdAt,
            lastEventAt: input.createdAt,
          });
          await transaction("public.incidents")
            .where("id", input.id)
            .update({ created_at: input.createdAt, updated_at: input.createdAt });
        }

        await assets.create({
          name: host,
          hostname: host,
          ipAddress: "10.0.0.5",
          assetType: "server",
          criticality: 0.9,
          owner: "DevOps Team",
          department: "Engineering",
          tags: ["production", "web"],
          orgId: visibleOrgId,
        });
        await assets.create({
          name: host,
          hostname: host,
          ipAddress: "10.0.0.99",
          assetType: "server",
          criticality: 1,
          owner: "Foreign Owner",
          orgId: foreignOrgId,
        });

        for (const [incidentId, orgId, createdAt] of [
          [currentId, visibleOrgId, oneDayAgo],
          [previousId, visibleOrgId, fiveDaysAgo],
          [oldId, visibleOrgId, fortyDaysAgo],
          [foreignId, foreignOrgId, fiveDaysAgo],
        ] as const) {
          const alert = await alerts.create({
            incidentId,
            orgId,
            alertType: "rule",
            ruleName: "Context integration alert",
            severity: "medium",
          });
          await transaction("public.alerts")
            .where("id", alert.id)
            .update({ created_at: createdAt });
        }

        const jwtService = new StaticJwtService(userId);
        const dependencies = createIncidentQueryDependencies(transaction);
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
            listIncidentsUseCase: dependencies.listIncidentsUseCase,
            getIncidentDetailUseCase: dependencies.getIncidentDetailUseCase,
            getIncidentContextUseCase: dependencies.getIncidentContextUseCase,
          }),
        );
        app.use(testErrorMiddleware);
        server = await listen(app);
        const address = server.address() as AddressInfo;
        const baseUrl = `http://127.0.0.1:${address.port}`;
        const headers = { authorization: "Bearer integration-token" };

        const response = await fetch(
          `${baseUrl}/api/v1/incidents/${currentId}/context`,
          { headers },
        );
        const body = (await response.json()) as any;
        assert.equal(response.status, 200);
        assert.deepEqual(
          body.previousIncidents.map((item: any) => item.id),
          [previousId],
        );
        assert.equal(body.assets.length, 1);
        assert.equal(body.assets[0].name, host);
        assert.equal(body.assets[0].owner, "DevOps Team");
        assert.equal(JSON.stringify(body).includes("Foreign Owner"), false);
        assert.equal(JSON.stringify(body).includes(foreignId), false);
        assert.equal(JSON.stringify(body).includes(oldId), false);
        for (const entity of [host, sourceIp]) {
          assert.equal(body.entityHistory[entity].incidentCount30d, 2);
          assert.equal(body.entityHistory[entity].alertCount30d, 2);
          assert.equal(
            new Date(body.entityHistory[entity].firstSeenAt).getTime(),
            fortyDaysAgo.getTime(),
          );
        }

        const hidden = await fetch(
          `${baseUrl}/api/v1/incidents/${foreignId}/context`,
          { headers },
        );
        const hiddenBody = (await hidden.json()) as any;
        assert.equal(hidden.status, 404);
        assert.equal(hiddenBody.error.code, "RESOURCE_NOT_FOUND");
        assert.equal(JSON.stringify(hiddenBody).includes(foreignOrgId), false);

        await close(server);
        server = null;
        throw ROLLBACK;
      });
    } catch (error: unknown) {
      assert.equal(error, ROLLBACK);
    }
  } finally {
    if (server !== null) await close(server).catch(() => undefined);
    await closePostgres(postgres);
  }
});

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1_000);
}

class StaticJwtService implements IJwtService {
  public readonly claims: JwtClaims;
  public constructor(userId: string) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    this.claims = {
      sub: userId,
      username: "inc-02d-reader",
      role: "soc_analyst",
      jti: `inc-02d-jwt-${randomUUID()}`,
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
    userAgent: "inc-02d-integration",
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    revokedAt: null,
  };
}

function createUser(userId: string, orgId: string): UserRecord {
  return {
    id: userId,
    username: "inc-02d-reader",
    email: "inc-02d-reader@example.test",
    passwordHash: "not-a-real-hash",
    role: "soc_analyst",
    displayName: "INC-02D Reader",
    isActive: true,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    orgId,
  };
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
    secret: "test-jwt-secret-that-is-long-enough-for-inc-02d-integration",
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
    collectorHmacSecret: "collector-hmac-secret-for-inc-02d-integration",
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

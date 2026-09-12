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
import { PostgresCollectorStatusRepository } from "../../../src/database/repositories/collector-status/postgres-collector-status.repository.js";
import type {
  IJwtService,
  JwtClaims,
  SessionRecord,
  UserRecord,
} from "../../../src/modules/auth/domain/index.js";
import { createCollectorMonitoringDependencies } from "../../../src/modules/collector-monitoring/composition/collector-monitoring.dependencies.js";
import type { CollectorMonitoringDependencies } from "../../../src/modules/collector-monitoring/composition/collector-monitoring.dependencies.js";
import { createCollectorMonitoringRouter } from "../../../src/modules/collector-monitoring/http/collector-monitoring.routes.js";

test("GET /collector/status returns only the authenticated organization", async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("BE-CMON-01A integration tests refuse to run in production.");
  }

  const suffix = randomUUID();
  const visibleCollectorId = `be-cmon-01a-visible-${suffix}`;
  const hiddenCollectorId = `be-cmon-01a-hidden-${suffix}`;
  const visibleOrgId = `be-cmon-01a-org-${suffix}`;
  const hiddenOrgId = `be-cmon-01a-other-${suffix}`;
  const postgres = createPostgresClient({
    connectionString:
      process.env.TEST_DATABASE_URL ??
      process.env.DATABASE_URL ??
      "postgresql://trivikrama_app:trivikrama_app_password@localhost:5432/trivikrama",
    poolMin: 0,
    poolMax: 2,
    acquireConnectionTimeoutMs: 5_000,
  });
  let server: Server | null = null;
  let monitoring: CollectorMonitoringDependencies | null = null;

  try {
    await pingPostgres(postgres);

    const collectorStatuses = new PostgresCollectorStatusRepository(postgres);
    await collectorStatuses.upsertHeartbeat({
      collectorId: visibleCollectorId,
      status: "online",
      lastHeartbeatAt: new Date("2026-09-10T12:00:00.000Z"),
      heartbeatData: {
        canonical_unsigned_sha256: `sha256:${"a".repeat(64)}`,
        metrics: {
          disk_available_bytes: 8192,
          last_batch_id: "batch-visible",
        },
      },
      filesProcessed: 7,
      eventsCollected: 70,
      eventsDropped: 1,
      errorsCount: 2,
      cpuPercent: 12.5,
      memoryMb: 128,
      orgId: visibleOrgId,
    });
    await collectorStatuses.upsertHeartbeat({
      collectorId: hiddenCollectorId,
      status: "degraded",
      lastHeartbeatAt: new Date("2026-09-10T12:01:00.000Z"),
      orgId: hiddenOrgId,
    });

    monitoring = createCollectorMonitoringDependencies({
      collectorStatusRepository: collectorStatuses,
      redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
      collectorHandoffRoot: process.env.COLLECTOR_DIR ?? "./collector",
      queueName: `be-cmon-01a-${suffix}`,
    });
    const jwtService = new IntegrationJwtService();
    const jwtId = `be-cmon-jwt-${suffix}`;
    const nowSeconds = Math.floor(Date.now() / 1000);
    jwtService.claims = {
      sub: suffix,
      username: "monitor-integration-user",
      role: "soc_analyst",
      jti: jwtId,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
      iss: "ai-siem",
    };

    const app = express();
    app.use(
      "/api/v1/collector",
      createCollectorMonitoringRouter({
        authentication: {
          jwtService,
          sessionRepository: {
            async findByJwtId(): Promise<SessionRecord> {
              return {
                id: randomUUID(),
                userId: suffix,
                jwtId,
                ipAddress: "127.0.0.1",
                userAgent: "be-cmon-01a-integration",
                expiresAt: new Date(Date.now() + 60_000),
                createdAt: new Date(),
                revokedAt: null,
              };
            },
          },
          userRepository: {
            async findById(): Promise<UserRecord> {
              return createUser(suffix, visibleOrgId);
            },
          },
          config: TEST_CONFIG,
        },
        getCollectorStatusUseCase: monitoring.getCollectorStatusUseCase,
      }),
    );
    app.use(testErrorMiddleware);

    server = await listen(app);
    const address = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/collector/status`,
      { headers: { authorization: "Bearer integration-token" } },
    );
    const body = (await response.json()) as {
      collectors: Array<Record<string, unknown>>;
      queue: { name: string };
      quarantine: { count: number };
    };

    assert.equal(response.status, 200);
    assert.equal(body.collectors.length, 1);
    assert.equal(body.collectors[0]?.collectorId, visibleCollectorId);
    assert.equal(body.collectors[0]?.status, "online");
    assert.equal(body.collectors[0]?.diskAvailableBytes, 8192);
    assert.equal(body.collectors[0]?.lastBatchId, "batch-visible");
    assert.equal("heartbeatData" in body.collectors[0]!, false);
    assert.equal("orgId" in body.collectors[0]!, false);
    assert.equal(JSON.stringify(body).includes(hiddenCollectorId), false);
    assert.equal(JSON.stringify(body).includes("canonical_unsigned_sha256"), false);
    assert.equal(body.queue.name, `be-cmon-01a-${suffix}`);
    assert.equal(Number.isSafeInteger(body.quarantine.count), true);
  } finally {
    if (server !== null) {
      await close(server).catch(() => undefined);
    }

    if (monitoring !== null) {
      await monitoring.close().catch(() => undefined);
    }

    await postgres("monitor.collector_status")
      .whereIn("collector_id", [visibleCollectorId, hiddenCollectorId])
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
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Something went wrong.",
    },
  });
}

class IntegrationJwtService implements IJwtService {
  public claims: JwtClaims | null = null;

  public async sign(claims: JwtClaims): Promise<string> {
    return `signed:${claims.jti}`;
  }

  public async verify(): Promise<JwtClaims> {
    if (this.claims === null) {
      throw new Error("Token not configured.");
    }

    return this.claims;
  }
}

function createUser(id: string, orgId: string): UserRecord {
  return {
    id,
    username: "monitor-integration-user",
    email: "monitor-integration@example.test",
    passwordHash: "not-a-real-hash",
    role: "soc_analyst",
    displayName: "Monitor Integration User",
    isActive: true,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    orgId,
  };
}

function listen(app: express.Express): Promise<Server> {
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
    secret: "test-jwt-secret-that-is-long-enough-for-cmon-integration",
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
    collectorHmacSecret: "collector-hmac-secret-for-cmon-integration",
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

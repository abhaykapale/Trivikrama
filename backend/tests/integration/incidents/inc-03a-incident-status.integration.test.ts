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
import { createTransactionalPostgresRepositories } from "../../../src/database/repositories/postgres-repository.factory.js";
import type {
  IUnitOfWork,
  TransactionContext,
  TransactionOptions,
} from "../../../src/database/transactions/transaction.types.js";
import type {
  IJwtService,
  JwtClaims,
  SessionRecord,
  UserRecord,
} from "../../../src/modules/auth/domain/index.js";
import { createIncidentCommandDependencies } from "../../../src/modules/incidents/composition/incident-command.dependencies.js";
import { createIncidentQueryRouter } from "../../../src/modules/incidents/http/incident-query.routes.js";

const ROLLBACK = new Error("INC-03A expected transaction rollback");

test("INC-03A atomically changes tenant status and writes immutable audit", async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("INC-03A integration tests refuse to run in production.");
  }

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
        const repositories = createTransactionalPostgresRepositories(transaction);
        const orgId = `inc-03a-visible-${randomUUID()}`;
        const foreignOrgId = `inc-03a-hidden-${randomUUID()}`;
        const userId = randomUUID();
        const incidentId = randomUUID();
        const foreignIncidentId = randomUUID();

        const user = await repositories.users.create({
          id: userId,
          username: `inc-03a-${randomUUID()}`,
          email: `inc-03a-${randomUUID()}@example.test`,
          passwordHash: "not-a-real-password-hash",
          role: "soc_analyst",
          displayName: "INC-03A Analyst",
          orgId,
        });
        await repositories.incidents.create({
          id: incidentId,
          title: "Visible incident",
          status: "open",
          severity: "high",
          source: "rule",
          orgId,
        });
        await repositories.incidents.create({
          id: foreignIncidentId,
          title: "Foreign incident",
          status: "open",
          severity: "high",
          source: "rule",
          orgId: foreignOrgId,
        });

        const outerUnitOfWork: IUnitOfWork = {
          async execute<TResult>(
            operation: (context: TransactionContext) => Promise<TResult>,
            _options?: TransactionOptions,
          ): Promise<TResult> {
            return operation({ transaction, repositories, attempt: 1 });
          },
        };
        const commands = createIncidentCommandDependencies(outerUnitOfWork);
        const jwtService = new StaticJwtService(userId);
        const app = express();
        app.use(express.json());
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
                  return user;
                },
              },
              config: TEST_CONFIG,
            },
            listIncidentsUseCase: {
              async execute() {
                throw new Error("Outside INC-03A integration scope.");
              },
            },
            getIncidentDetailUseCase: {
              async execute() {
                throw new Error("Outside INC-03A integration scope.");
              },
            },
            transitionIncidentStatusUseCase:
              commands.transitionIncidentStatusUseCase,
          }),
        );
        app.use(testErrorMiddleware);
        server = await listen(app);
        const address = server.address() as AddressInfo;
        const baseUrl = `http://127.0.0.1:${address.port}`;
        const requestOptions = {
          method: "PUT",
          headers: {
            authorization: "Bearer integration-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ status: "investigating" }),
        };

        const response = await fetch(
          `${baseUrl}/api/v1/incidents/${incidentId}/status`,
          requestOptions,
        );
        const body = (await response.json()) as any;
        assert.equal(response.status, 200);
        assert.equal(body.id, incidentId);
        assert.equal(body.status, "investigating");
        assert.equal("orgId" in body, false);

        const stored = await repositories.incidents.findById(incidentId);
        assert.equal(stored?.status, "investigating");
        assert.equal(stored?.resolvedAt, null);
        assert.equal(stored?.closedAt, null);

        const audit = await repositories.audit.list({
          orgId,
          action: "incident_status_change",
          targetType: "incident",
          targetId: incidentId,
          limit: 10,
        });
        assert.equal(audit.items.length, 1);
        assert.equal(audit.items[0]?.actorId, userId);
        assert.equal(audit.items[0]?.previousState?.status, "open");
        assert.equal(audit.items[0]?.newState?.status, "investigating");

        const hidden = await fetch(
          `${baseUrl}/api/v1/incidents/${foreignIncidentId}/status`,
          requestOptions,
        );
        const hiddenBody = (await hidden.json()) as any;
        assert.equal(hidden.status, 404);
        assert.equal(hiddenBody.error.code, "RESOURCE_NOT_FOUND");
        assert.equal(JSON.stringify(hiddenBody).includes(foreignOrgId), false);

        const invalid = await fetch(
          `${baseUrl}/api/v1/incidents/${incidentId}/status`,
          {
            ...requestOptions,
            body: JSON.stringify({ status: "closed" }),
          },
        );
        const invalidBody = (await invalid.json()) as any;
        assert.equal(invalid.status, 422);
        assert.equal(
          invalidBody.error.code,
          "INVALID_STATUS_TRANSITION",
        );
        const unchanged = await repositories.incidents.findById(incidentId);
        assert.equal(unchanged?.status, "investigating");

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

class StaticJwtService implements IJwtService {
  public readonly claims: JwtClaims;
  public constructor(userId: string) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    this.claims = {
      sub: userId,
      username: "inc-03a-analyst",
      role: "soc_analyst",
      jti: `inc-03a-jwt-${randomUUID()}`,
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
    userAgent: "inc-03a-integration",
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    revokedAt: null,
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
    server.close((error) => error ? reject(error) : resolve());
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
    secret: "test-jwt-secret-that-is-long-enough-for-inc-03a-integration",
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
    collectorHmacSecret: "collector-hmac-secret-for-inc-03a-integration",
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

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
  closeMongoDb,
  connectMongoDb,
  createMongoDbClient,
} from "../../../src/database/mongodb/client.js";
import {
  closePostgres,
  createPostgresClient,
  pingPostgres,
} from "../../../src/database/postgres/client.js";
import { PostgresAlertRepository } from "../../../src/database/repositories/alerts/postgres-alert.repository.js";
import { PostgresAuditRepository } from "../../../src/database/repositories/audit/postgres-audit.repository.js";
import { PostgresIncidentEventRepository } from "../../../src/database/repositories/incident-events/postgres-incident-event.repository.js";
import { PostgresIncidentRepository } from "../../../src/database/repositories/incidents/postgres-incident.repository.js";
import { MongoNormalizedEventRepository } from "../../../src/database/repositories/mongodb/mongo-normalized-event.repository.js";
import type {
  IJwtService,
  JwtClaims,
  SessionRecord,
  UserRecord,
} from "../../../src/modules/auth/domain/index.js";
import { createIncidentQueryDependencies } from "../../../src/modules/incidents/composition/incident-query.dependencies.js";
import { createIncidentQueryRouter } from "../../../src/modules/incidents/http/incident-query.routes.js";

const ROLLBACK = new Error("INC-02B expected transaction rollback");

test("INC-02B/C serve tenant-safe timeline, alerts, and events from PostgreSQL and MongoDB", async () => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("INC-02B integration tests refuse to run in production.");
  }

  const incidentId = randomUUID();
  const hiddenIncidentId = randomUUID();
  const alertId = randomUUID();
  const auditId = randomUUID();
  const userId = randomUUID();
  const eventId = `inc-02b-event-${randomUUID()}`;
  const visibleOrgId = `inc-02b-visible-${randomUUID()}`;
  const hiddenOrgId = `inc-02b-hidden-${randomUUID()}`;
  const eventTime = new Date(Date.now() - 60_000);
  const postgres = createPostgresClient({
    connectionString:
      process.env.DATABASE_URL ??
      "postgresql://trivikrama_app:trivikrama_app_password@localhost:5432/trivikrama",
    poolMin: 0,
    poolMax: 2,
    acquireConnectionTimeoutMs: 5_000,
  });
  const mongo = createMongoDbClient();
  let server: Server | null = null;

  try {
    await Promise.all([
      pingPostgres(postgres),
      connectMongoDb(mongo, {
        uri:
          process.env.MONGODB_URI ??
          "mongodb://localhost:27017/trivikrama",
        minPoolSize: 0,
        maxPoolSize: 2,
        serverSelectionTimeoutMs: 5_000,
      }),
    ]);
    const normalizedEvents = new MongoNormalizedEventRepository(mongo);
    await normalizedEvents.create({
      event_id: eventId,
      class_uid: 3002,
      category_uid: 3,
      severity_id: 3,
      time: eventTime,
      message: "INC-02B failed password integration event",
      metadata: { version: "1.1.0" },
      ingestion: {
        batch_id: `batch-${eventId}`,
        collector_id: "collector-inc-02b",
        ingested_at: new Date(),
      },
      org_id: visibleOrgId,
    });

    try {
      await postgres.transaction(async (transaction) => {
        const incidents = new PostgresIncidentRepository(transaction);
        const alerts = new PostgresAlertRepository(transaction);
        const incidentEvents = new PostgresIncidentEventRepository(transaction);
        const audit = new PostgresAuditRepository(transaction);
        await incidents.create({
          id: incidentId,
          orgId: visibleOrgId,
          title: "HIGH — INC-02B timeline integration",
          severity: "high",
          riskScore: 82,
          source: "both",
        });
        await incidents.create({
          id: hiddenIncidentId,
          orgId: hiddenOrgId,
          title: "Hidden tenant incident",
          severity: "critical",
          riskScore: 99,
          source: "rule",
        });
        await incidentEvents.create({
          incidentId,
          eventId,
          eventTime,
          classUid: 3002,
          severityId: 3,
        });
        await alerts.create({
          id: alertId,
          incidentId,
          alertType: "rule",
          ruleName: "SSH Brute Force",
          severity: "high",
          matchedEventIds: [eventId],
          orgId: visibleOrgId,
        });
        await audit.create({
          id: auditId,
          action: "incident_create",
          targetType: "incident",
          targetId: incidentId,
          targetName: "HIGH — INC-02B timeline integration",
          newState: { status: "open" },
          orgId: visibleOrgId,
        });

        const jwtService = new StaticJwtService(userId);
        const dependencies = createIncidentQueryDependencies(
          transaction,
          normalizedEvents,
        );
        assert.ok(dependencies.getIncidentTimelineUseCase !== undefined);
        assert.ok(dependencies.listIncidentAlertsUseCase !== undefined);
        assert.ok(dependencies.listIncidentEventsUseCase !== undefined);
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
            getIncidentTimelineUseCase:
              dependencies.getIncidentTimelineUseCase,
            listIncidentAlertsUseCase:
              dependencies.listIncidentAlertsUseCase,
            listIncidentEventsUseCase:
              dependencies.listIncidentEventsUseCase,
          }),
        );
        app.use(testErrorMiddleware);
        server = await listen(app);
        const address = server.address() as AddressInfo;
        const baseUrl = `http://127.0.0.1:${address.port}`;
        const headers = { authorization: "Bearer integration-token" };

        const firstResponse = await fetch(
          `${baseUrl}/api/v1/incidents/${incidentId}/timeline?page=1&limit=2`,
          { headers },
        );
        const firstBody = (await firstResponse.json()) as any;
        assert.equal(firstResponse.status, 200);
        assert.equal(firstBody.data.length, 2);
        assert.equal(firstBody.data[0].type, "event");
        assert.equal(firstBody.data[0].eventId, eventId);
        assert.equal(
          firstBody.data[0].eventMessage,
          "INC-02B failed password integration event",
        );
        assert.equal(firstBody.data[1].type, "alert");
        assert.equal(firstBody.pagination.total, 3);
        assert.equal(firstBody.pagination.totalPages, 2);
        assert.equal(firstBody.pagination.hasNext, true);

        const secondResponse = await fetch(
          `${baseUrl}/api/v1/incidents/${incidentId}/timeline?page=2&limit=2`,
          { headers },
        );
        const secondBody = (await secondResponse.json()) as any;
        assert.equal(secondResponse.status, 200);
        assert.equal(secondBody.data.length, 1);
        assert.equal(secondBody.data[0].type, "action");
        assert.equal(secondBody.data[0].action, "created");
        assert.equal(secondBody.data[0].actorId, "system");
        assert.equal(secondBody.data[0].newValue, "open");

        const filteredResponse = await fetch(
          `${baseUrl}/api/v1/incidents/${incidentId}/timeline?type=event`,
          { headers },
        );
        const filteredBody = (await filteredResponse.json()) as any;
        assert.equal(filteredResponse.status, 200);
        assert.equal(filteredBody.data.length, 1);
        assert.equal(filteredBody.pagination.total, 1);

        const alertsResponse = await fetch(
          `${baseUrl}/api/v1/incidents/${incidentId}/alerts?type=rule&page=1&limit=10`,
          { headers },
        );
        const alertsBody = (await alertsResponse.json()) as any;
        assert.equal(alertsResponse.status, 200);
        assert.equal(alertsBody.data.length, 1);
        assert.equal(alertsBody.data[0].id, alertId);
        assert.equal(alertsBody.data[0].incidentId, incidentId);
        assert.equal(alertsBody.data[0].alertType, "rule");
        assert.equal(alertsBody.data[0].ruleName, "SSH Brute Force");
        assert.equal(alertsBody.pagination.total, 1);
        assert.equal("orgId" in alertsBody.data[0], false);

        const eventsResponse = await fetch(
          `${baseUrl}/api/v1/incidents/${incidentId}/events?page=1&limit=10`,
          { headers },
        );
        const eventsBody = (await eventsResponse.json()) as any;
        assert.equal(eventsResponse.status, 200);
        assert.equal(eventsBody.data.length, 1);
        assert.equal(eventsBody.data[0].eventId, eventId);
        assert.equal(eventsBody.data[0].classUid, 3002);
        assert.equal(
          eventsBody.data[0].message,
          "INC-02B failed password integration event",
        );
        assert.equal(eventsBody.data[0].ingestion.collectorId, "collector-inc-02b");
        assert.equal(eventsBody.pagination.total, 1);
        assert.equal("orgId" in eventsBody.data[0], false);

        const hiddenResponse = await fetch(
          `${baseUrl}/api/v1/incidents/${hiddenIncidentId}/timeline`,
          { headers },
        );
        const hiddenBody = (await hiddenResponse.json()) as any;
        assert.equal(hiddenResponse.status, 404);
        assert.equal(hiddenBody.error.code, "RESOURCE_NOT_FOUND");
        assert.equal(JSON.stringify(hiddenBody).includes(hiddenOrgId), false);

        for (const resource of ["alerts", "events"]) {
          const hiddenEvidenceResponse = await fetch(
            `${baseUrl}/api/v1/incidents/${hiddenIncidentId}/${resource}`,
            { headers },
          );
          const hiddenEvidenceBody = (await hiddenEvidenceResponse.json()) as any;
          assert.equal(hiddenEvidenceResponse.status, 404, resource);
          assert.equal(hiddenEvidenceBody.error.code, "RESOURCE_NOT_FOUND", resource);
          assert.equal(
            JSON.stringify(hiddenEvidenceBody).includes(hiddenOrgId),
            false,
            resource,
          );
        }

        await close(server);
        server = null;
        throw ROLLBACK;
      });
    } catch (error: unknown) {
      assert.equal(error, ROLLBACK);
    }
  } finally {
    if (server !== null) await close(server).catch(() => undefined);
    if (mongo.db !== undefined) {
      await mongo.db
        .collection("normalized_events")
        .deleteMany({ event_id: eventId })
        .catch(() => undefined);
    }
    await Promise.allSettled([closePostgres(postgres), closeMongoDb(mongo)]);
  }
});

class StaticJwtService implements IJwtService {
  public readonly claims: JwtClaims;
  public constructor(userId: string) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    this.claims = {
      sub: userId,
      username: "inc-02b-reader",
      role: "soc_analyst",
      jti: `inc-02b-jwt-${randomUUID()}`,
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
    userAgent: "inc-02b-integration",
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    revokedAt: null,
  };
}

function createUser(userId: string, orgId: string): UserRecord {
  return {
    id: userId,
    username: "inc-02b-reader",
    email: "inc-02b-reader@example.test",
    passwordHash: "not-a-real-hash",
    role: "soc_analyst",
    displayName: "INC-02B Reader",
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
  _error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction,
): Response {
  return response.status(500).json({
    error: { code: "INTERNAL_SERVER_ERROR", message: "Something went wrong." },
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
    secret: "test-jwt-secret-that-is-long-enough-for-inc-02b-integration",
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
    collectorHmacSecret: "collector-hmac-secret-for-inc-02b-integration",
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

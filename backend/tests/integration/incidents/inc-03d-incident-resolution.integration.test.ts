import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import express, { type NextFunction, type Request, type Response } from "express";
import type { AppConfig } from "../../../src/config/index.js";
import { closePostgres, createPostgresClient, pingPostgres } from "../../../src/database/postgres/client.js";
import { createTransactionalPostgresRepositories } from "../../../src/database/repositories/postgres-repository.factory.js";
import type { IUnitOfWork, TransactionContext, TransactionOptions } from "../../../src/database/transactions/transaction.types.js";
import type { IJwtService, JwtClaims, SessionRecord, UserRecord } from "../../../src/modules/auth/domain/index.js";
import { createIncidentCommandDependencies } from "../../../src/modules/incidents/composition/incident-command.dependencies.js";
import { createIncidentQueryRouter } from "../../../src/modules/incidents/http/incident-query.routes.js";
import { PostgresIncidentTimelineRepository } from "../../../src/modules/incidents/infrastructure/postgres-incident-timeline.repository.js";

const ROLLBACK = new Error("INC-03D expected transaction rollback");

test("INC-03D atomically resolves a tenant incident with reason, note, and audit", async () => {
  if (process.env.NODE_ENV === "production") throw new Error("INC-03D integration tests refuse to run in production.");
  const postgres = createPostgresClient({
    connectionString: process.env.DATABASE_URL ?? "postgresql://trivikrama_app:trivikrama_app_password@localhost:5432/trivikrama",
    poolMin: 0, poolMax: 2, acquireConnectionTimeoutMs: 5_000,
  });
  let server: Server | null = null;
  try {
    await pingPostgres(postgres);
    try {
      await postgres.transaction(async (transaction) => {
        const repositories = createTransactionalPostgresRepositories(transaction);
        const orgId = `inc-03d-visible-${randomUUID()}`;
        const foreignOrgId = `inc-03d-hidden-${randomUUID()}`;
        const actorId = randomUUID();
        const incidentId = randomUUID();
        const foreignIncidentId = randomUUID();
        const actor = await repositories.users.create({
          id: actorId, username: `inc-03d-analyst-${randomUUID()}`,
          email: `inc-03d-analyst-${randomUUID()}@example.test`, passwordHash: "not-a-real-password-hash",
          role: "soc_analyst", displayName: "INC-03D Analyst", orgId,
        });
        await repositories.incidents.create({ id: incidentId, title: "Visible incident", status: "investigating", severity: "high", source: "rule", orgId });
        await repositories.incidents.create({ id: foreignIncidentId, title: "Foreign incident", status: "investigating", severity: "high", source: "rule", orgId: foreignOrgId });

        const outerUnitOfWork: IUnitOfWork = {
          async execute<TResult>(operation: (context: TransactionContext) => Promise<TResult>, _options?: TransactionOptions): Promise<TResult> {
            return operation({ transaction, repositories, attempt: 1 });
          },
        };
        const commands = createIncidentCommandDependencies(outerUnitOfWork);
        const jwtService = new StaticJwtService(actorId);
        const app = express();
        app.use(express.json());
        app.use("/api/v1/incidents", createIncidentQueryRouter({
          authentication: {
            jwtService,
            sessionRepository: { async findByJwtId(): Promise<SessionRecord> { return createSession(actorId, jwtService.claims.jti); } },
            userRepository: { async findById(): Promise<UserRecord> { return actor; } },
            config: TEST_CONFIG,
          },
          listIncidentsUseCase: { async execute() { throw new Error("Outside INC-03D integration scope."); } },
          getIncidentDetailUseCase: { async execute() { throw new Error("Outside INC-03D integration scope."); } },
          resolveIncidentUseCase: commands.resolveIncidentUseCase,
        }));
        app.use(testErrorMiddleware);
        server = await listen(app);
        const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const note = "Host isolated and credentials rotated.";
        const options = {
          method: "PUT",
          headers: { authorization: "Bearer integration-token", "content-type": "application/json" },
          body: JSON.stringify({ resolution: "tp_mitigated", note }),
        };

        const response = await fetch(`${baseUrl}/api/v1/incidents/${incidentId}/resolve`, options);
        const body = (await response.json()) as any;
        assert.equal(response.status, 200);
        assert.equal(body.id, incidentId);
        assert.equal(body.status, "resolved");
        assert.equal(body.resolution, "tp_mitigated");
        assert.equal(typeof body.resolvedAt, "string");
        assert.equal("orgId" in body, false);

        const incident = await repositories.incidents.findById(incidentId);
        assert.equal(incident?.status, "resolved");
        assert.equal(incident?.resolvedAt?.toISOString(), body.resolvedAt);
        const notes = await repositories.incidentNotes.listByIncident(incidentId);
        assert.equal(notes.items.length, 1);
        assert.equal(notes.items[0]?.authorId, actorId);
        assert.equal(notes.items[0]?.content, note);

        const audit = await repositories.audit.list({ orgId, action: "incident_resolve", targetType: "incident", targetId: incidentId, limit: 10 });
        assert.equal(audit.items.length, 1);
        assert.equal(audit.items[0]?.actorId, actorId);
        assert.equal(audit.items[0]?.details.resolution, "tp_mitigated");
        assert.equal(audit.items[0]?.details.note, note);
        assert.equal(audit.items[0]?.details.noteId, notes.items[0]?.id);

        const timeline = await new PostgresIncidentTimelineRepository(transaction).list({ incidentId, orgId, type: "action", page: 1, limit: 20 });
        const resolution = timeline.items.find((entry) => entry.type === "action" && entry.action === "status_change");
        assert.equal(resolution?.type, "action");
        if (resolution?.type === "action") {
          assert.equal(resolution.previousValue, "investigating");
          assert.equal(resolution.newValue, "resolved");
          assert.equal(resolution.noteContent, note);
        }

        const repeated = await fetch(`${baseUrl}/api/v1/incidents/${incidentId}/resolve`, options);
        assert.equal(repeated.status, 422);
        assert.equal((await repeated.json() as any).error.code, "INVALID_STATUS_TRANSITION");
        assert.equal((await repositories.incidentNotes.listByIncident(incidentId)).items.length, 1);

        const hidden = await fetch(`${baseUrl}/api/v1/incidents/${foreignIncidentId}/resolve`, options);
        const hiddenBody = (await hidden.json()) as any;
        assert.equal(hidden.status, 404);
        assert.equal(hiddenBody.error.code, "RESOURCE_NOT_FOUND");
        assert.equal(JSON.stringify(hiddenBody).includes(foreignOrgId), false);
        assert.equal((await repositories.incidents.findById(foreignIncidentId))?.status, "investigating");

        await close(server);
        server = null;
        throw ROLLBACK;
      });
    } catch (error: unknown) { assert.equal(error, ROLLBACK); }
  } finally {
    if (server !== null) await close(server).catch(() => undefined);
    await closePostgres(postgres);
  }
});

class StaticJwtService implements IJwtService {
  public readonly claims: JwtClaims;
  public constructor(userId: string) {
    const now = Math.floor(Date.now() / 1000);
    this.claims = { sub: userId, username: "inc-03d-analyst", role: "soc_analyst", jti: `inc-03d-${randomUUID()}`, iat: now, exp: now + 3600, iss: "ai-siem" };
  }
  public async sign(claims: JwtClaims): Promise<string> { return `signed:${claims.jti}`; }
  public async verify(): Promise<JwtClaims> { return this.claims; }
}

function createSession(userId: string, jwtId: string): SessionRecord {
  return { id: randomUUID(), userId, jwtId, ipAddress: "127.0.0.1", userAgent: "inc-03d-integration", expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), revokedAt: null };
}

function testErrorMiddleware(error: unknown, _request: Request, response: Response, _next: NextFunction): Response {
  return response.status(500).json({ error: { code: "INTERNAL_SERVER_ERROR", message: error instanceof Error ? error.message : "Something went wrong." } });
}

function listen(app: express.Express): Promise<Server> {
  return new Promise((resolve, reject) => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); server.once("error", reject); });
}
function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => { server.close((error) => (error ? reject(error) : resolve())); });
}

const TEST_CONFIG = {
  jwt: {
    algorithm: "HS256", secret: "test-jwt-secret-that-is-long-enough-for-inc-03d-integration",
    accessTokenExpiry: "1h", refreshWindow: "5m", maxSessionDuration: "7d", issuer: "ai-siem",
    cookie: { name: "siem_token", httpOnly: true, secure: true, sameSite: "strict" },
  },
} as AppConfig;

import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";

import type { AppConfig } from "../../../src/config/index.js";
import type {
  AuthRole,
  IJwtService,
  JwtClaims,
  SessionRecord,
  UserRecord,
} from "../../../src/modules/auth/domain/index.js";
import type { ExportEventsInput } from "../../../src/modules/events/application/export-events.use-case.js";
import type {
  EventDetailView,
  EventSearchInput,
} from "../../../src/modules/events/domain/event-query.contracts.js";
import { createEventQueryRouter } from "../../../src/modules/events/http/event-query.routes.js";

const USER_ID = "550e8400-e29b-41d4-a716-446655440001";

test("event investigation endpoints require authentication", async () => {
  const harness = createHarness();
  await withServer(harness.app, async (baseUrl) => {
    for (const path of [
      "/api/v1/events/search",
      "/api/v1/events/event-1",
      "/api/v1/events/export",
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 401, path);
    }
  });
  assert.equal(harness.searchInputs.length, 0);
});

for (const role of ["admin", "security_engineer", "soc_analyst"] as const) {
  test(`event search allows authenticated ${role} with trusted tenant`, async () => {
    const harness = createHarness();
    harness.addActiveToken(`${role}-token`, role, `org-${role}`);

    await withServer(harness.app, async (baseUrl) => {
      const response = await requestJson(
        baseUrl,
        "/api/v1/events/search?query=failed%20password&classUid=3002&severityId=4&srcIp=192.0.2.10&dstIp=10.0.0.5&username=root&hostname=web-01&collectorId=collector-1&page=2&limit=20&sort=severityId&order=asc&orgId=forged",
        `${role}-token`,
      );
      assert.equal(response.status, 200);
    });

    assert.deepEqual(harness.searchInputs[0], {
      orgId: `org-${role}`,
      query: "failed password",
      classUid: 3002,
      severityId: 4,
      srcIp: "192.0.2.10",
      dstIp: "10.0.0.5",
      username: "root",
      hostname: "web-01",
      collectorId: "collector-1",
      page: 2,
      limit: 20,
      sort: "severityId",
      order: "asc",
    });
  });
}

test("event search rejects unsafe bounds, sorts, severities, and time ranges", async () => {
  const harness = createHarness();
  harness.addActiveToken("analyst-token", "soc_analyst", "org-alpha");

  await withServer(harness.app, async (baseUrl) => {
    const queries = [
      "limit=201",
      "severityId=7",
      "classUid=-1",
      "sort=time%3Bdrop%20database",
      "page=0",
      "query=",
      "from=2026-10-22T07%3A00%3A00Z&to=2026-10-22T06%3A00%3A00Z",
    ];
    for (const query of queries) {
      const response = await requestJson(
        baseUrl,
        `/api/v1/events/search?${query}`,
        "analyst-token",
      );
      assert.equal(response.status, 400, query);
      assert.equal(response.body.error.code, "VALIDATION_ERROR", query);
    }
  });
  assert.equal(harness.searchInputs.length, 0);
});

test("event detail validates IDs and conceals absent or cross-tenant events", async () => {
  const harness = createHarness();
  harness.addActiveToken("analyst-token", "soc_analyst", "org-alpha");

  await withServer(harness.app, async (baseUrl) => {
    const invalid = await requestJson(
      baseUrl,
      "/api/v1/events/not%20valid",
      "analyst-token",
    );
    assert.equal(invalid.status, 400);

    const absent = await requestJson(
      baseUrl,
      "/api/v1/events/event-404",
      "analyst-token",
    );
    assert.equal(absent.status, 404);
    assert.equal(absent.body.error.code, "RESOURCE_NOT_FOUND");
  });

  assert.deepEqual(harness.detailInputs, [
    { eventId: "event-404", orgId: "org-alpha" },
  ]);
});

test("event detail returns normalized evidence and AI explanation without org/raw fields", async () => {
  const harness = createHarness();
  harness.detailResult = eventDetail();
  harness.addActiveToken("analyst-token", "soc_analyst", "org-alpha");

  await withServer(harness.app, async (baseUrl) => {
    const response = await requestJson(
      baseUrl,
      "/api/v1/events/event-1",
      "analyst-token",
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.eventId, "event-1");
    assert.equal(response.body.aiAnalysis.shapExplanation.features.length, 1);
    assert.equal("orgId" in response.body, false);
    assert.equal("rawEvent" in response.body, false);
    assert.equal("raw_event" in response.body, false);
  });
});

test("event export is authenticated, bounded, tenant-scoped, and downloadable", async () => {
  const harness = createHarness();
  harness.addActiveToken("analyst-token", "soc_analyst", "org-alpha");

  await withServer(harness.app, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/v1/events/export?format=csv&maxResults=500&severityId=4&orgId=forged`,
      { headers: { authorization: "Bearer analyst-token" } },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/csv; charset=utf-8");
    assert.match(response.headers.get("content-disposition") ?? "", /events_export/u);
    assert.equal(response.headers.get("x-exported-count"), "1");
    assert.equal(await response.text(), "event_id\r\nevent-1\r\n");
  });

  assert.equal(harness.exportInputs[0]?.orgId, "org-alpha");
  assert.equal(harness.exportInputs[0]?.maxResults, 500);
  assert.equal(harness.exportInputs[0]?.severityId, 4);
});

interface Harness {
  readonly app: Express;
  readonly searchInputs: EventSearchInput[];
  readonly detailInputs: Array<{ eventId: string; orgId: string }>;
  readonly exportInputs: ExportEventsInput[];
  detailResult: EventDetailView | null;
  addActiveToken(token: string, role: AuthRole, orgId: string): void;
}

function createHarness(): Harness {
  const jwtService = new FakeJwtService();
  const sessions = new Map<string, SessionRecord>();
  const users = new Map<string, UserRecord>();
  const searchInputs: EventSearchInput[] = [];
  const detailInputs: Array<{ eventId: string; orgId: string }> = [];
  const exportInputs: ExportEventsInput[] = [];
  const harness: Harness = {
    app: express(),
    searchInputs,
    detailInputs,
    exportInputs,
    detailResult: null,
    addActiveToken(token, role, orgId) {
      const jwtId = `jwt-${token}`;
      const nowSeconds = Math.floor(Date.now() / 1_000);
      jwtService.claimsByToken.set(token, {
        sub: USER_ID,
        username: "event-reader",
        role,
        jti: jwtId,
        iat: nowSeconds,
        exp: nowSeconds + 3_600,
        iss: "ai-siem",
      });
      sessions.set(jwtId, session(jwtId));
      users.set(USER_ID, user(role, orgId));
    },
  };

  const authentication = {
    jwtService,
    sessionRepository: {
      async findByJwtId(jwtId: string) {
        return sessions.get(jwtId) ?? null;
      },
    },
    userRepository: {
      async findById(id: string) {
        return users.get(id) ?? null;
      },
    },
    config: TEST_CONFIG,
  };

  harness.app.use(
    "/api/v1/events",
    createEventQueryRouter({
      authentication,
      searchEventsUseCase: {
        async execute(input) {
          searchInputs.push(input);
          return {
            data: [],
            pagination: {
              page: input.page,
              limit: input.limit,
              total: 0,
              totalPages: 0,
              hasNext: false,
              hasPrev: input.page > 1,
            },
            window: {
              from: input.from ?? new Date("2026-10-21T00:00:00.000Z"),
              to: input.to ?? new Date("2026-10-22T00:00:00.000Z"),
            },
          };
        },
      },
      getEventDetailUseCase: {
        async execute(input) {
          detailInputs.push(input);
          return harness.detailResult;
        },
      },
      exportEventsUseCase: {
        async execute(input) {
          exportInputs.push(input);
          return {
            contentType: "text/csv; charset=utf-8",
            filename: "events_export_20261022.csv",
            body: "event_id\r\nevent-1\r\n",
            exportedCount: 1,
            truncated: false,
          };
        },
      },
    }),
  );
  harness.app.use(testErrorMiddleware);
  return harness;
}

class FakeJwtService implements IJwtService {
  public readonly claimsByToken = new Map<string, JwtClaims>();
  public async sign(claims: JwtClaims): Promise<string> {
    return `signed:${claims.jti}`;
  }
  public async verify(token: string): Promise<JwtClaims> {
    const claims = this.claimsByToken.get(token);
    if (claims === undefined) throw new Error("Unknown token.");
    return claims;
  }
}

function session(jwtId: string): SessionRecord {
  return {
    id: `session-${jwtId}`,
    userId: USER_ID,
    jwtId,
    ipAddress: "127.0.0.1",
    userAgent: "log-01a-test",
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    revokedAt: null,
  };
}

function user(role: AuthRole, orgId: string): UserRecord {
  return {
    id: USER_ID,
    username: "event-reader",
    email: "event-reader@example.test",
    passwordHash: "not-a-real-hash",
    role,
    displayName: "Event Reader",
    isActive: true,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    orgId,
  };
}

function eventDetail(): EventDetailView {
  return {
    eventId: "event-1",
    classUid: 3002,
    categoryUid: 3,
    severityId: 4,
    time: new Date("2026-10-22T05:50:00.000Z"),
    message: "Failed password for root",
    metadata: { version: "1.1.0" },
    ingestion: {
      batchId: "batch-1",
      collectorId: "collector-1",
      ingestedAt: new Date("2026-10-22T05:50:01.000Z"),
    },
    aiAnalysis: {
      modelName: "isolation_forest",
      modelVersion: "1.0.0",
      anomalyScore: 0.94,
      isAnomaly: true,
      usedFallback: false,
      createdAt: new Date("2026-10-22T05:50:02.000Z"),
      shapExplanation: {
        features: [{ name: "failed_login_count_10min", value: 38, shapValue: 0.4 }],
      },
    },
  };
}

function testErrorMiddleware(
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction,
): Response {
  return response.status(500).json({
    error: { code: "INTERNAL_SERVER_ERROR", message: "Something went wrong." },
  });
}

async function requestJson(baseUrl: string, path: string, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: (await response.json()) as any };
}

async function withServer(
  app: Express,
  callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  try {
    const { port } = server.address() as AddressInfo;
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }
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
      connectionTimeoutMs: 5_000,
      queryTimeoutMs: 30_000,
    },
    mongodb: { poolSize: 2, serverSelectionTimeoutMs: 5_000 },
    redis: { keyPrefix: "trivikrama-test" },
  },
  jwt: {
    algorithm: "HS256",
    secret: "test-jwt-secret-that-is-long-enough-for-event-query-tests",
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
    collectorHmacSecret: "collector-hmac-secret-for-event-query-tests",
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
    timeoutMs: 5_000,
    batchSize: 100,
    threshold: 0.65,
    circuitFailureThreshold: 5,
    circuitCooldownMs: 60_000,
    circuitSuccessThreshold: 2,
  },
  frontend: { url: "http://localhost:3001" },
  logging: { level: "debug", format: "pretty" },
};

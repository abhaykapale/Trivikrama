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
  IJwtService,
  JwtClaims,
  SessionRecord,
  UserRecord,
} from "../../../src/modules/auth/domain/index.js";
import type { GetIncidentTimelineQuery } from "../../../src/modules/incidents/domain/incident-timeline.contracts.js";
import type {
  ListIncidentAlertsQuery,
  ListIncidentEventsQuery,
} from "../../../src/modules/incidents/domain/incident-evidence.contracts.js";
import type { GetIncidentContextQuery } from "../../../src/modules/incidents/domain/incident-context.contracts.js";
import { createIncidentQueryRouter } from "../../../src/modules/incidents/http/incident-query.routes.js";

const USER_ID = "550e8400-e29b-41d4-a716-446655440001";
const INCIDENT_ID = "00000000-0000-4000-8000-000000000501";

test("GET /incidents/:id/timeline requires authentication", async () => {
  const harness = createHarness();

  await withServer(harness.app, async (baseUrl) => {
    const response = await requestJson(
      baseUrl,
      `/api/v1/incidents/${INCIDENT_ID}/timeline`,
    );
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, "UNAUTHORIZED");
  });

  assert.equal(harness.inputs.length, 0);
});

test("timeline query uses the authenticated tenant and documented filters", async () => {
  const harness = createHarness();
  harness.addActiveToken("analyst-token", "org-alpha");

  await withServer(harness.app, async (baseUrl) => {
    const response = await requestJson(
      baseUrl,
      `/api/v1/incidents/${INCIDENT_ID}/timeline?type=event&from=2026-10-18T01%3A00%3A00Z&to=2026-10-18T02%3A00%3A00Z&page=2&limit=10&orgId=forged-org`,
      "analyst-token",
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.data[0].eventMessage, "Failed login");
  });

  assert.equal(harness.inputs.length, 1);
  assert.deepEqual(harness.inputs[0], {
    incidentId: INCIDENT_ID,
    orgId: "org-alpha",
    type: "event",
    from: new Date("2026-10-18T01:00:00.000Z"),
    to: new Date("2026-10-18T02:00:00.000Z"),
    page: 2,
    limit: 10,
  });
});

test("timeline validates IDs, filters, bounds, and date order", async () => {
  const harness = createHarness();
  harness.addActiveToken("analyst-token", "org-alpha");

  await withServer(harness.app, async (baseUrl) => {
    const paths = [
      "/api/v1/incidents/not-a-uuid/timeline",
      `/api/v1/incidents/${INCIDENT_ID}/timeline?type=secret`,
      `/api/v1/incidents/${INCIDENT_ID}/timeline?limit=101`,
      `/api/v1/incidents/${INCIDENT_ID}/timeline?from=2026-10-19T00%3A00%3A00Z&to=2026-10-18T00%3A00%3A00Z`,
    ];

    for (const path of paths) {
      const response = await requestJson(baseUrl, path, "analyst-token");
      assert.equal(response.status, 400, path);
      assert.equal(response.body.error.code, "VALIDATION_ERROR", path);
    }
  });

  assert.equal(harness.inputs.length, 0);
});

test("timeline returns 404 for an absent or cross-tenant incident", async () => {
  const harness = createHarness();
  harness.result = null;
  harness.addActiveToken("analyst-token", "org-alpha");

  await withServer(harness.app, async (baseUrl) => {
    const response = await requestJson(
      baseUrl,
      `/api/v1/incidents/${INCIDENT_ID}/timeline`,
      "analyst-token",
    );
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, "RESOURCE_NOT_FOUND");
  });
});

test("incident alert and event endpoints require authentication", async () => {
  const harness = createHarness();

  await withServer(harness.app, async (baseUrl) => {
    for (const resource of ["alerts", "events", "context"]) {
      const response = await requestJson(
        baseUrl,
        `/api/v1/incidents/${INCIDENT_ID}/${resource}`,
      );
      assert.equal(response.status, 401, resource);
      assert.equal(response.body.error.code, "UNAUTHORIZED", resource);
    }
  });
  assert.equal(harness.alertInputs.length, 0);
  assert.equal(harness.eventInputs.length, 0);
  assert.equal(harness.contextInputs.length, 0);
});

test("incident evidence endpoints use trusted tenant and documented pagination", async () => {
  const harness = createHarness();
  harness.addActiveToken("analyst-token", "org-alpha");

  await withServer(harness.app, async (baseUrl) => {
    const alerts = await requestJson(
      baseUrl,
      `/api/v1/incidents/${INCIDENT_ID}/alerts?type=ai&page=2&limit=10&orgId=forged`,
      "analyst-token",
    );
    const events = await requestJson(
      baseUrl,
      `/api/v1/incidents/${INCIDENT_ID}/events?page=3&limit=5&orgId=forged`,
      "analyst-token",
    );
    assert.equal(alerts.status, 200);
    assert.equal(alerts.body.data[0].alertType, "ai");
    assert.equal(events.status, 200);
    assert.equal(events.body.data[0].eventId, "event-1");
  });

  assert.deepEqual(harness.alertInputs, [
    {
      incidentId: INCIDENT_ID,
      orgId: "org-alpha",
      type: "ai",
      page: 2,
      limit: 10,
    },
  ]);
  assert.deepEqual(harness.eventInputs, [
    {
      incidentId: INCIDENT_ID,
      orgId: "org-alpha",
      page: 3,
      limit: 5,
    },
  ]);
});

test("incident evidence endpoints validate IDs, types, and pagination bounds", async () => {
  const harness = createHarness();
  harness.addActiveToken("analyst-token", "org-alpha");

  await withServer(harness.app, async (baseUrl) => {
    const paths = [
      "/api/v1/incidents/not-a-uuid/alerts",
      `/api/v1/incidents/${INCIDENT_ID}/alerts?type=secret`,
      `/api/v1/incidents/${INCIDENT_ID}/alerts?limit=101`,
      `/api/v1/incidents/${INCIDENT_ID}/events?page=0`,
      `/api/v1/incidents/${INCIDENT_ID}/events?limit=101`,
    ];
    for (const path of paths) {
      const response = await requestJson(baseUrl, path, "analyst-token");
      assert.equal(response.status, 400, path);
      assert.equal(response.body.error.code, "VALIDATION_ERROR", path);
    }
  });
  assert.equal(harness.alertInputs.length, 0);
  assert.equal(harness.eventInputs.length, 0);
});

test("incident evidence endpoints conceal absent and cross-tenant incidents", async () => {
  const harness = createHarness();
  harness.alertResult = null;
  harness.eventResult = null;
  harness.addActiveToken("analyst-token", "org-alpha");

  await withServer(harness.app, async (baseUrl) => {
    for (const resource of ["alerts", "events"]) {
      const response = await requestJson(
        baseUrl,
        `/api/v1/incidents/${INCIDENT_ID}/${resource}`,
        "analyst-token",
      );
      assert.equal(response.status, 404, resource);
      assert.equal(response.body.error.code, "RESOURCE_NOT_FOUND", resource);
    }
  });
});

test("incident context uses the authenticated tenant and returns historical context", async () => {
  const harness = createHarness();
  harness.addActiveToken("analyst-token", "org-alpha");

  await withServer(harness.app, async (baseUrl) => {
    const response = await requestJson(
      baseUrl,
      `/api/v1/incidents/${INCIDENT_ID}/context?orgId=forged-org`,
      "analyst-token",
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.previousIncidents[0].title, "Earlier activity");
    assert.equal(response.body.assets[0].name, "web-server-01");
    assert.equal(response.body.entityHistory["192.168.1.100"].incidentCount30d, 2);
  });

  assert.deepEqual(harness.contextInputs, [
    { incidentId: INCIDENT_ID, orgId: "org-alpha" },
  ]);
});

test("incident context validates UUIDs and conceals cross-tenant absence", async () => {
  const harness = createHarness();
  harness.addActiveToken("analyst-token", "org-alpha");

  await withServer(harness.app, async (baseUrl) => {
    const invalid = await requestJson(
      baseUrl,
      "/api/v1/incidents/not-a-uuid/context",
      "analyst-token",
    );
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, "VALIDATION_ERROR");

    harness.contextResult = null;
    const hidden = await requestJson(
      baseUrl,
      `/api/v1/incidents/${INCIDENT_ID}/context`,
      "analyst-token",
    );
    assert.equal(hidden.status, 404);
    assert.equal(hidden.body.error.code, "RESOURCE_NOT_FOUND");
  });
});

function createHarness() {
  const jwtService = new FakeJwtService();
  const sessions = new Map<string, SessionRecord>();
  const users = new Map<string, UserRecord>();
  const inputs: GetIncidentTimelineQuery[] = [];
  const alertInputs: ListIncidentAlertsQuery[] = [];
  const eventInputs: ListIncidentEventsQuery[] = [];
  const contextInputs: GetIncidentContextQuery[] = [];
  const harness = {
    app: express(),
    inputs,
    alertInputs,
    eventInputs,
    contextInputs,
    result: timelineResult() as ReturnType<typeof timelineResult> | null,
    alertResult: alertResult() as ReturnType<typeof alertResult> | null,
    eventResult: eventResult() as ReturnType<typeof eventResult> | null,
    contextResult: contextResult() as ReturnType<typeof contextResult> | null,
    addActiveToken(token: string, orgId: string) {
      const jwtId = `jwt-${token}`;
      const nowSeconds = Math.floor(Date.now() / 1000);
      jwtService.claimsByToken.set(token, {
        sub: USER_ID,
        username: "timeline-reader",
        role: "soc_analyst",
        jti: jwtId,
        iat: nowSeconds,
        exp: nowSeconds + 3600,
        iss: "ai-siem",
      });
      sessions.set(jwtId, createSession(jwtId));
      users.set(USER_ID, createUser(orgId));
    },
  };

  harness.app.use(
    "/api/v1/incidents",
    createIncidentQueryRouter({
      authentication: {
        jwtService,
        sessionRepository: {
          async findByJwtId(jwtId) {
            return sessions.get(jwtId) ?? null;
          },
        },
        userRepository: {
          async findById(id) {
            return users.get(id) ?? null;
          },
        },
        config: TEST_CONFIG,
      },
      listIncidentsUseCase: {
        async execute() {
          throw new Error("Outside INC-02B test scope.");
        },
      },
      getIncidentDetailUseCase: {
        async execute() {
          throw new Error("Outside INC-02B test scope.");
        },
      },
      getIncidentContextUseCase: {
        async execute(input) {
          contextInputs.push(input);
          return harness.contextResult;
        },
      },
      getIncidentTimelineUseCase: {
        async execute(input) {
          inputs.push(input);
          return harness.result;
        },
      },
      listIncidentAlertsUseCase: {
        async execute(input) {
          alertInputs.push(input);
          return harness.alertResult;
        },
      },
      listIncidentEventsUseCase: {
        async execute(input) {
          eventInputs.push(input);
          return harness.eventResult;
        },
      },
    }),
  );
  harness.app.use(testErrorMiddleware);

  return harness;
}

function alertResult() {
  return {
    data: [
      {
        id: "00000000-0000-4000-8000-000000000601",
        incidentId: INCIDENT_ID,
        alertType: "ai" as const,
        ruleId: null,
        ruleName: null,
        matchedCondition: null,
        anomalyScore: 0.9,
        confidence: 0.85,
        threatCategory: "brute_force",
        modelVersion: "v1",
        shapValues: null,
        severity: "high" as const,
        weight: 0.9,
        tags: [],
        matchedEventIds: ["event-1"],
        createdAt: new Date("2026-10-18T01:00:00Z"),
      },
    ],
    pagination: {
      page: 2,
      limit: 10,
      total: 11,
      totalPages: 2,
      hasNext: false,
      hasPrev: true,
    },
  };
}

function eventResult() {
  return {
    data: [
      {
        eventId: "event-1",
        classUid: 3002,
        categoryUid: 3,
        severityId: 3,
        time: new Date("2026-10-18T01:00:00Z"),
        message: "Failed login",
        metadata: { version: "1.1.0" },
        ingestion: {
          batchId: "batch-1",
          collectorId: "collector-1",
          ingestedAt: new Date("2026-10-18T01:00:01Z"),
        },
      },
    ],
    pagination: {
      page: 3,
      limit: 5,
      total: 11,
      totalPages: 3,
      hasNext: false,
      hasPrev: true,
    },
  };
}

function contextResult() {
  return {
    previousIncidents: [
      {
        id: "00000000-0000-4000-8000-000000000502",
        title: "Earlier activity",
        severity: "medium" as const,
        status: "closed" as const,
        createdAt: new Date("2026-10-01T00:00:00Z"),
      },
    ],
    assets: [
      {
        name: "web-server-01",
        assetType: "server",
        ipAddress: "10.0.0.5",
        criticality: 0.9,
        owner: "DevOps Team",
        department: "Engineering",
        tags: ["production"],
      },
    ],
    entityHistory: {
      "192.168.1.100": {
        firstSeenAt: new Date("2026-09-20T00:00:00Z"),
        incidentCount30d: 2,
        alertCount30d: 5,
      },
    },
  };
}

function timelineResult() {
  return {
    data: [
      {
        id: "event:1",
        incidentId: INCIDENT_ID,
        type: "event" as const,
        timestamp: new Date("2026-10-18T01:00:00.000Z"),
        eventId: "event-1",
        eventClassUid: 3002,
        eventMessage: "Failed login",
        eventSeverity: 3,
      },
    ],
    pagination: {
      page: 2,
      limit: 10,
      total: 11,
      totalPages: 2,
      hasNext: false,
      hasPrev: true,
    },
  };
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

function createSession(jwtId: string): SessionRecord {
  return {
    id: `session-${jwtId}`,
    userId: USER_ID,
    jwtId,
    ipAddress: "127.0.0.1",
    userAgent: "inc-02b-test",
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    revokedAt: null,
  };
}

function createUser(orgId: string): UserRecord {
  return {
    id: USER_ID,
    username: "timeline-reader",
    email: "timeline-reader@example.test",
    passwordHash: "not-a-real-hash",
    role: "soc_analyst",
    displayName: "Timeline Reader",
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

async function requestJson(baseUrl: string, path: string, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: (await response.json()) as any };
}

async function withServer(
  app: Express,
  operation: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = await new Promise<Server>((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  try {
    await operation(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
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
      connectionTimeoutMs: 5000,
      queryTimeoutMs: 30000,
    },
    mongodb: { poolSize: 2, serverSelectionTimeoutMs: 5000 },
    redis: { keyPrefix: "trivikrama-test" },
  },
  jwt: {
    algorithm: "HS256",
    secret: "test-jwt-secret-that-is-long-enough-for-inc-02b-http",
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
    collectorHmacSecret: "collector-hmac-secret-for-inc-02b-http",
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

import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import express, { type Express } from "express";

import type { AppConfig } from "../../../src/config/index.js";
import type { AuthRole, IJwtService, JwtClaims, SessionRecord, UserRecord } from "../../../src/modules/auth/domain/index.js";
import type { CreateAssetCommand, DeactivateAssetCommand, GetAssetInput, ListAssetsInput, UpdateAssetCommand } from "../../../src/modules/assets/domain/asset.contracts.js";
import { createAssetRouter } from "../../../src/modules/assets/http/asset.routes.js";

const USER_ID = "550e8400-e29b-41d4-a716-446655440001";
const ASSET_ID = "550e8400-e29b-41d4-a716-446655440101";

test("ASSET-01A endpoints require authentication", async () => {
  const harness = createHarness();
  await withServer(harness.app, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/v1/assets`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/v1/assets/${ASSET_ID}`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/v1/assets`, { method: "POST" })).status, 401);
  });
});

for (const role of ["admin", "security_engineer", "soc_analyst"] as const) {
  test(`ASSET-01A allows ${role} to list and read only its trusted tenant`, async () => {
    const harness = createHarness();
    harness.addToken(role, role, `org-${role}`);
    await withServer(harness.app, async (baseUrl) => {
      assert.equal((await request(baseUrl, `/api/v1/assets?type=server&search=10.0.0.5&isActive=false&page=2&limit=10&orgId=forged`, role)).status, 200);
      assert.equal((await request(baseUrl, `/api/v1/assets/${ASSET_ID}?orgId=forged`, role)).status, 200);
    });
    assert.deepEqual(harness.listInputs[0], { orgId: `org-${role}`, assetType: "server", search: "10.0.0.5", isActive: false, page: 2, limit: 10 });
    assert.deepEqual(harness.detailInputs[0], { orgId: `org-${role}`, assetId: ASSET_ID });
  });
}

for (const role of ["admin", "security_engineer"] as const) {
  test(`ASSET-01A allows ${role} to create and update with trusted actor data`, async () => {
    const harness = createHarness();
    harness.addToken(role, role, `org-${role}`);
    await withServer(harness.app, async (baseUrl) => {
      const created = await request(baseUrl, "/api/v1/assets?orgId=forged", role, "POST", validAsset());
      assert.equal(created.status, 201);
      const updated = await request(baseUrl, `/api/v1/assets/${ASSET_ID}`, role, "PUT", { criticality: 1, tags: ["critical"] });
      assert.equal(updated.status, 200);
    });
    assert.equal(harness.createInputs[0]?.orgId, `org-${role}`);
    assert.equal(harness.createInputs[0]?.actor.role, role);
    assert.equal(harness.updateInputs[0]?.orgId, `org-${role}`);
  });
}

test("ASSET-01A denies analyst writes and restricts deactivation to admin", async () => {
  const analyst = createHarness();
  analyst.addToken("analyst", "soc_analyst", "org-a");
  await withServer(analyst.app, async (baseUrl) => {
    assert.equal((await request(baseUrl, "/api/v1/assets", "analyst", "POST", validAsset())).status, 403);
    assert.equal((await request(baseUrl, `/api/v1/assets/${ASSET_ID}`, "analyst", "PUT", { criticality: 1 })).status, 403);
  });
  const engineer = createHarness();
  engineer.addToken("engineer", "security_engineer", "org-a");
  assert.equal(await withServer(engineer.app, async (baseUrl) => (await request(baseUrl, `/api/v1/assets/${ASSET_ID}`, "engineer", "DELETE")).status), 403);
  const admin = createHarness();
  admin.addToken("admin", "admin", "org-a");
  assert.equal(await withServer(admin.app, async (baseUrl) => (await request(baseUrl, `/api/v1/assets/${ASSET_ID}`, "admin", "DELETE")).status), 200);
  assert.equal(admin.deactivateInputs.length, 1);
  assert.equal(admin.deactivateInputs[0]?.actor.role, "admin");
});

test("ASSET-01A rejects malformed requests before application execution", async () => {
  const harness = createHarness();
  harness.addToken("admin", "admin", "org-a");
  await withServer(harness.app, async (baseUrl) => {
    for (const path of ["?limit=101", "?page=0", "?isActive=1", "?type=database", "?search="]) {
      assert.equal((await request(baseUrl, `/api/v1/assets${path}`, "admin")).status, 400, path);
    }
    assert.equal((await request(baseUrl, "/api/v1/assets", "admin", "POST", { ...validAsset(), ipAddress: "999.1.1.1" })).status, 400);
    assert.equal((await request(baseUrl, "/api/v1/assets", "admin", "POST", { ...validAsset(), orgId: "forged" })).status, 400);
    assert.equal((await request(baseUrl, `/api/v1/assets/${ASSET_ID}`, "admin", "PUT", {})).status, 400);
    assert.equal((await request(baseUrl, "/api/v1/assets/not-a-uuid", "admin", "DELETE")).status, 400);
  });
  assert.equal(harness.createInputs.length, 0);
  assert.equal(harness.updateInputs.length, 0);
});

test("ASSET-01A conceals absent or cross-tenant assets with 404", async () => {
  const harness = createHarness();
  harness.addToken("admin", "admin", "org-a");
  harness.detail = null;
  harness.commandResult = null;
  await withServer(harness.app, async (baseUrl) => {
    assert.equal((await request(baseUrl, `/api/v1/assets/${ASSET_ID}`, "admin")).status, 404);
    assert.equal((await request(baseUrl, `/api/v1/assets/${ASSET_ID}`, "admin", "PUT", { criticality: 1 })).status, 404);
    assert.equal((await request(baseUrl, `/api/v1/assets/${ASSET_ID}`, "admin", "DELETE")).status, 404);
  });
});

interface Harness {
  readonly app: Express;
  readonly listInputs: ListAssetsInput[];
  readonly detailInputs: GetAssetInput[];
  readonly createInputs: CreateAssetCommand[];
  readonly updateInputs: UpdateAssetCommand[];
  readonly deactivateInputs: DeactivateAssetCommand[];
  detail: ReturnType<typeof assetView> | null;
  commandResult: ReturnType<typeof assetView> | null;
  addToken(token: string, role: AuthRole, orgId: string): void;
}

function createHarness(): Harness {
  const jwt = new FakeJwtService();
  const sessions = new Map<string, SessionRecord>();
  const users = new Map<string, UserRecord>();
  const harness: Harness = {
    app: express(), listInputs: [], detailInputs: [], createInputs: [], updateInputs: [], deactivateInputs: [],
    detail: assetView(), commandResult: assetView(),
    addToken(token, role, orgId) {
      const jti = `jwt-${token}`;
      const now = Math.floor(Date.now() / 1_000);
      jwt.tokens.set(token, { sub: USER_ID, username: token, role, jti, iat: now, exp: now + 3_600, iss: "ai-siem" });
      sessions.set(jti, session(jti));
      users.set(USER_ID, user(role, orgId, token));
    },
  };
  harness.app.use(express.json());
  harness.app.use("/api/v1/assets", createAssetRouter({
    authentication: {
      jwtService: jwt,
      sessionRepository: { async findByJwtId(id) { return sessions.get(id) ?? null; } },
      userRepository: { async findById(id) { return users.get(id) ?? null; } },
      config: TEST_CONFIG,
    },
    listAssetsUseCase: { async execute(input) { harness.listInputs.push(input); return { data: [], pagination: { page: input.page, limit: input.limit, total: 0, totalPages: 0, hasNext: false, hasPrev: input.page > 1 } }; } },
    getAssetUseCase: { async execute(input) { harness.detailInputs.push(input); return harness.detail; } },
    createAssetUseCase: { async execute(input) { harness.createInputs.push(input); return harness.commandResult ?? assetView(); } },
    updateAssetUseCase: { async execute(input) { harness.updateInputs.push(input); return harness.commandResult; } },
    deactivateAssetUseCase: { async execute(input) { harness.deactivateInputs.push(input); return harness.commandResult; } },
  }));
  return harness;
}

class FakeJwtService implements IJwtService {
  public readonly tokens = new Map<string, JwtClaims>();
  public async sign(claims: JwtClaims): Promise<string> { return `signed:${claims.jti}`; }
  public async verify(token: string): Promise<JwtClaims> { const claims = this.tokens.get(token); if (claims === undefined) throw new Error("Unknown token"); return claims; }
}

function validAsset() { return { name: "web-01", assetType: "server", ipAddress: "10.0.0.5", hostname: "web-01", criticality: 0.9, owner: "DevOps", department: "Engineering", tags: ["production"], metadata: { os: "linux" } }; }
function assetView() { return { id: ASSET_ID, ...validAsset(), isActive: true, createdAt: new Date("2026-10-27T00:00:00.000Z"), updatedAt: new Date("2026-10-27T00:00:00.000Z") }; }
function session(jwtId: string): SessionRecord { return { id: `session-${jwtId}`, userId: USER_ID, jwtId, ipAddress: null, userAgent: null, expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), revokedAt: null }; }
function user(role: AuthRole, orgId: string, username: string): UserRecord { return { id: USER_ID, username, email: `${username}@example.test`, passwordHash: "test", role, displayName: username, isActive: true, lastLoginAt: null, failedLoginCount: 0, lockedUntil: null, createdAt: new Date(), updatedAt: new Date(), orgId }; }

async function request(baseUrl: string, path: string, token: string, method = "GET", body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() as unknown };
}
async function withServer<TResult>(app: Express, callback: (baseUrl: string) => Promise<TResult>): Promise<TResult> {
  const server = await new Promise<Server>((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  try { return await callback(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))); }
}

const TEST_CONFIG: AppConfig = {
  server: { port: 3000, nodeEnv: "test", apiPrefix: "/api/v1" },
  database: { DATABASE_URL: "postgres://test", MONGODB_URI: "mongodb://test", REDIS_URL: "redis://test", postgres: { poolMin: 0, poolMax: 1, connectionTimeoutMs: 1000, queryTimeoutMs: 1000 }, mongodb: { poolSize: 1, serverSelectionTimeoutMs: 1000 }, redis: { keyPrefix: "test" } },
  jwt: { algorithm: "HS256", secret: "test-jwt-secret-that-is-long-enough-for-asset-tests", accessTokenExpiry: "1h", refreshWindow: "5m", maxSessionDuration: "7d", issuer: "ai-siem", cookie: { name: "siem_token", httpOnly: true, secure: true, sameSite: "strict" } },
  auth: { bcryptRounds: 12, lockoutAttempts: 5, lockoutMinutes: 15, rateLimitPerMinute: 10 }, security: { bcryptSaltRounds: 12, collectorHmacSecret: "collector-secret" },
  collector: { directory: "./collector", trust: { collectorId: "test", keyId: "test", secretBase64Url: "c8Wm1Qx4Ny7Rt2Ks5Vb9Lp3Hd6Fj0Za8Pe1Uy4Mi7Go2Cq5Xs9Dv3Ln6Ak0Jr8Tw" } },
  ai: { engineUrl: "http://localhost:8000", timeoutMs: 5000, batchSize: 100, threshold: 0.65, circuitFailureThreshold: 5, circuitCooldownMs: 60000, circuitSuccessThreshold: 2 },
  frontend: { url: "http://localhost:3001" }, logging: { level: "debug", format: "pretty" },
};

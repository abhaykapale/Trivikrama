import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import express, { type Express } from "express";

import type { AppConfig } from "../../../src/config/index.js";
import errorMiddleware from "../../../src/middleware/error.middleware.js";
import AppError from "../../../src/shared/errors/AppError.js";
import ErrorCodes from "../../../src/shared/errors/ErrorCodes.js";
import type { AuthRole, IJwtService, JwtClaims, SessionRecord, UserRecord } from "../../../src/modules/auth/domain/index.js";
import type { CreateUserCommand, CreateUserResult } from "../../../src/modules/users/application/use-case/create-user.use-case.js";
import type { ResetUserPasswordCommand, ResetUserPasswordResult } from "../../../src/modules/users/application/use-case/reset-user-password.use-case.js";
import type { UpdateUserCommand, UpdateUserResult } from "../../../src/modules/users/application/use-case/update-user.use-case.js";
import { DeactivateUserByIdUseCase } from "../../../src/modules/users/application/use-case/list-detactivate-user.use-case.js";
import { GetUserByIdUseCase } from "../../../src/modules/users/application/use-case/list-getuser.use-case.js";
import { ListUsersUseCase } from "../../../src/modules/users/application/use-case/list-users.use-case.js";
import type { DeactivatedUser, DeactivateUserByIdInput, GetManagedUserInput, IUserManagementRepository, ManagedUserFilters, ManagedUserRecord, PageResult } from "../../../src/modules/users/domain/user-management.contracts.js";
import { createUsersRouter } from "../../../src/modules/users/http/index.js";

const ADMIN_ID = "550e8400-e29b-41d4-a716-446655440001";
const USER_ID = "550e8400-e29b-41d4-a716-446655440002";
const MISSING_USER_ID = "550e8400-e29b-41d4-a716-446655440099";

const TEST_CONFIG: AppConfig = {
  server: { port: 3000, nodeEnv: "test", apiPrefix: "/api/v1" },
  database: {
    DATABASE_URL: "postgres://example.test/trivikrama", MONGODB_URI: "mongodb://example.test/trivikrama", REDIS_URL: "redis://example.test:6379",
    postgres: { poolMin: 1, poolMax: 2, connectionTimeoutMs: 5000, queryTimeoutMs: 30000 },
    mongodb: { poolSize: 2, serverSelectionTimeoutMs: 5000 }, redis: { keyPrefix: "trivikrama-test" },
  },
  jwt: { algorithm: "HS256", secret: "test-jwt-secret-that-is-long-enough-for-production-validation", accessTokenExpiry: "1h", refreshWindow: "5m", maxSessionDuration: "7d", issuer: "ai-siem", cookie: { name: "siem_token", httpOnly: true, secure: true, sameSite: "strict" } },
  auth: { bcryptRounds: 12, lockoutAttempts: 5, lockoutMinutes: 15, rateLimitPerMinute: 10 },
  security: { bcryptSaltRounds: 12, collectorHmacSecret: "collector-hmac-secret-for-user-mutation-test" },
  collector: {
    directory: "./collector",
    trust: {
        collectorId: "collector-test-01",
        keyId: "collector-key-test-01",
        secretBase64Url:
            "c8Wm1Qx4Ny7Rt2Ks5Vb9Lp3Hd6Fj0Za8Pe1Uy4Mi7Go2Cq5Xs9Dv3Ln6Ak0Jr8Tw",
    },
}, ai: { engineUrl: "http://localhost:8000", timeoutMs: 5000, batchSize: 100, threshold: 0.65 },
  frontend: { url: "http://localhost:3001" }, logging: { level: "debug", format: "pretty" },
};

class FakeJwtService implements IJwtService {
  public readonly claimsByToken = new Map<string, JwtClaims>();
  public async sign(claims: JwtClaims): Promise<string> { return `signed:${claims.jti}`; }
  public async verify(token: string): Promise<JwtClaims> {
    const claims = this.claimsByToken.get(token);
    if (claims === undefined) throw new Error("Unknown token");
    return claims;
  }
}
class FakeSessionRepository {
  public readonly sessions = new Map<string, SessionRecord>();
  public async findByJwtId(jwtId: string): Promise<SessionRecord | null> { return this.sessions.get(jwtId) ?? null; }
}
class FakeAuthenticationUserRepository {
  public readonly users = new Map<string, UserRecord>();
  public async findById(id: string): Promise<UserRecord | null> { return this.users.get(id) ?? null; }
}
class FakeManagementRepository implements IUserManagementRepository {
  public async list(_filters: ManagedUserFilters): Promise<PageResult<ManagedUserRecord>> { return { items: [], total: 0 }; }
  public async getById(_input: GetManagedUserInput): Promise<ManagedUserRecord | null> { return null; }
  public async deactivateUserById(_input: DeactivateUserByIdInput): Promise<DeactivatedUser | null> { return null; }
}
class FakeCreateUserUseCase {
  public async execute(_input: CreateUserCommand): Promise<CreateUserResult> { throw new Error("Not used by mutation HTTP tests"); }
}
class FakeUpdateUserUseCase {
  public readonly inputs: UpdateUserCommand[] = [];
  public error: Error | null = null;
  public result: UpdateUserResult = { id: USER_ID, role: "admin", displayName: "SOC Lead", updatedAt: "2026-08-26T10:00:00.000Z" };
  public async execute(input: UpdateUserCommand): Promise<UpdateUserResult> { this.inputs.push(input); if (this.error !== null) throw this.error; return this.result; }
}
class FakeResetUserPasswordUseCase {
  public readonly inputs: ResetUserPasswordCommand[] = [];
  public error: Error | null = null;
  public result: ResetUserPasswordResult = { message: "Password reset successfully", userId: USER_ID };
  public async execute(input: ResetUserPasswordCommand): Promise<ResetUserPasswordResult> { this.inputs.push(input); if (this.error !== null) throw this.error; return this.result; }
}

interface Harness {
  readonly app: Express;
  readonly update: FakeUpdateUserUseCase;
  readonly reset: FakeResetUserPasswordUseCase;
  addActiveToken(token: string, role: AuthRole, orgId?: string): void;
}

function createHarness(): Harness {
  const jwt = new FakeJwtService();
  const sessions = new FakeSessionRepository();
  const authUsers = new FakeAuthenticationUserRepository();
  const management = new FakeManagementRepository();
  const update = new FakeUpdateUserUseCase();
  const reset = new FakeResetUserPasswordUseCase();
  const app = express();
  app.use(express.json());
  app.use("/api/v1/users", createUsersRouter({
    authentication: { jwtService: jwt, sessionRepository: sessions, userRepository: authUsers, config: TEST_CONFIG },
    listUsersUseCase: new ListUsersUseCase(management), getUserByIdUseCase: new GetUserByIdUseCase(management),
    deactivateUserByIdUseCase: new DeactivateUserByIdUseCase(management), createUserUseCase: new FakeCreateUserUseCase(),
    updateUserUseCase: update, resetUserPasswordUseCase: reset,
  }));
  app.use(errorMiddleware);

  return { app, update, reset, addActiveToken(token, role, orgId = "org-123") {
    const jwtId = `jwt-${token}`;
    const now = Math.floor(Date.now() / 1000);
    jwt.claimsByToken.set(token, { sub: ADMIN_ID, username: "request-admin", role, jti: jwtId, iat: now, exp: now + 3600, iss: "ai-siem" });
    sessions.sessions.set(jwtId, { id: `session-${token}`, userId: ADMIN_ID, jwtId, ipAddress: "127.0.0.1", userAgent: "mutation-http-test", expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), revokedAt: null });
    authUsers.users.set(ADMIN_ID, { id: ADMIN_ID, username: "request-admin", email: "admin@example.test", passwordHash: "not-a-real-hash", role, displayName: "Request Admin", isActive: true, lastLoginAt: null, failedLoginCount: 0, lockedUntil: null, createdAt: new Date("2026-08-01T00:00:00.000Z"), updatedAt: new Date("2026-08-01T00:00:00.000Z"), orgId });
  }};
}

const updatePath = `/api/v1/users/${USER_ID}`;
const resetPath = `/api/v1/users/${USER_ID}/reset-password`;
const adminHeader = { authorization: "Bearer admin-token" };

test("PUT /users/:id returns 401 without authentication", async () => { const h = createHarness(); const r = await request(h.app, "PUT", updatePath, { role: "admin" }); assert.equal(r.status, 401); assert.equal(h.update.inputs.length, 0); });
test("PUT /users/:id returns 401 for an invalid token", async () => { const h = createHarness(); const r = await request(h.app, "PUT", updatePath, { role: "admin" }, { authorization: "Bearer invalid" }); assert.equal(r.status, 401); assert.equal(h.update.inputs.length, 0); });
test("PUT /users/:id returns 403 for a SOC analyst", async () => { const h = createHarness(); h.addActiveToken("analyst", "soc_analyst"); const r = await request(h.app, "PUT", updatePath, { role: "admin" }, { authorization: "Bearer analyst" }); assert.equal(r.status, 403); assert.equal(h.update.inputs.length, 0); });
test("PUT /users/:id returns 403 for a security engineer", async () => { const h = createHarness(); h.addActiveToken("engineer", "security_engineer"); const r = await request(h.app, "PUT", updatePath, { role: "admin" }, { authorization: "Bearer engineer" }); assert.equal(r.status, 403); assert.equal(h.update.inputs.length, 0); });
test("PUT /users/:id returns 400 for an invalid UUID", async () => { const h = createHarness(); h.addActiveToken("admin-token", "admin"); const r = await request(h.app, "PUT", "/api/v1/users/not-a-uuid", { role: "admin" }, adminHeader); assert.equal(r.status, 400); });
test("PUT /users/:id rejects empty and unexpected bodies", async () => { const h = createHarness(); h.addActiveToken("admin-token", "admin"); assert.equal((await request(h.app, "PUT", updatePath, {}, adminHeader)).status, 400); assert.equal((await request(h.app, "PUT", updatePath, { isActive: false }, adminHeader)).status, 400); assert.equal(h.update.inputs.length, 0); });
test("PUT /users/:id returns the safe response and principal organization", async () => { const h = createHarness(); h.addActiveToken("admin-token", "admin", "tenant-a"); const r = await request(h.app, "PUT", updatePath, { role: "admin", displayName: " SOC Lead " }, adminHeader); assert.equal(r.status, 200); assert.deepEqual(r.body, h.update.result); assert.equal(h.update.inputs[0]?.orgId, "tenant-a"); assert.equal(h.update.inputs[0]?.userId, USER_ID); assert.equal(h.update.inputs[0]?.displayName, "SOC Lead"); assert.equal("passwordHash" in r.body, false); });
test("PUT /users/:id returns 404 without disclosing another organization", async () => { const h = createHarness(); h.addActiveToken("admin-token", "admin"); h.update.error = new AppError("User not found.", 404, ErrorCodes.NOT_FOUND); const r = await request(h.app, "PUT", `/api/v1/users/${MISSING_USER_ID}`, { role: "admin" }, adminHeader); assert.equal(r.status, 404); assert.equal(r.body.error.code, "NOT_FOUND"); });
test("PUT /users/:id hides unexpected failures", async () => { const h = createHarness(); h.addActiveToken("admin-token", "admin"); h.update.error = new Error("PostgreSQL connection details must stay private"); const r = await request(h.app, "PUT", updatePath, { role: "admin" }, adminHeader); assert.equal(r.status, 500); assert.equal(r.body.error.code, "INTERNAL_SERVER_ERROR"); assert.equal(JSON.stringify(r.body).includes("PostgreSQL connection"), false); });

test("PUT /users/:id/reset-password returns 401 without authentication", async () => { const h = createHarness(); const r = await request(h.app, "PUT", resetPath, { newPassword: "NewSecureP@ss456!" }); assert.equal(r.status, 401); assert.equal(h.reset.inputs.length, 0); });
test("PUT /users/:id/reset-password returns 401 for an invalid token", async () => { const h = createHarness(); const r = await request(h.app, "PUT", resetPath, { newPassword: "NewSecureP@ss456!" }, { authorization: "Bearer invalid" }); assert.equal(r.status, 401); });
test("PUT /users/:id/reset-password returns 403 for a SOC analyst", async () => { const h = createHarness(); h.addActiveToken("analyst", "soc_analyst"); const r = await request(h.app, "PUT", resetPath, { newPassword: "NewSecureP@ss456!" }, { authorization: "Bearer analyst" }); assert.equal(r.status, 403); });
test("PUT /users/:id/reset-password returns 403 for a security engineer", async () => { const h = createHarness(); h.addActiveToken("engineer", "security_engineer"); const r = await request(h.app, "PUT", resetPath, { newPassword: "NewSecureP@ss456!" }, { authorization: "Bearer engineer" }); assert.equal(r.status, 403); assert.equal(h.reset.inputs.length, 0); });
test("PUT /users/:id/reset-password returns 400 for an invalid UUID", async () => { const h = createHarness(); h.addActiveToken("admin-token", "admin"); const r = await request(h.app, "PUT", "/api/v1/users/not-a-uuid/reset-password", { newPassword: "NewSecureP@ss456!" }, adminHeader); assert.equal(r.status, 400); });
test("PUT /users/:id/reset-password rejects weak passwords and injected fields", async () => { const h = createHarness(); h.addActiveToken("admin-token", "admin"); assert.equal((await request(h.app, "PUT", resetPath, { newPassword: "weak" }, adminHeader)).status, 400); assert.equal((await request(h.app, "PUT", resetPath, { newPassword: "NewSecureP@ss456!", orgId: "attacker-org" }, adminHeader)).status, 400); assert.equal(h.reset.inputs.length, 0); });
test("PUT /users/:id/reset-password returns a safe response and principal organization", async () => { const h = createHarness(); h.addActiveToken("admin-token", "admin", "tenant-a"); const r = await request(h.app, "PUT", resetPath, { newPassword: "NewSecureP@ss456!" }, adminHeader); assert.equal(r.status, 200); assert.deepEqual(r.body, h.reset.result); assert.equal(h.reset.inputs[0]?.orgId, "tenant-a"); assert.equal(h.reset.inputs[0]?.newPassword, "NewSecureP@ss456!"); assert.equal(JSON.stringify(r.body).includes("NewSecureP@ss456!"), false); assert.equal("passwordHash" in r.body, false); });
test("PUT /users/:id/reset-password returns 404 for a missing or cross-organization user", async () => { const h = createHarness(); h.addActiveToken("admin-token", "admin"); h.reset.error = new AppError("User not found.", 404, ErrorCodes.NOT_FOUND); const r = await request(h.app, "PUT", `/api/v1/users/${MISSING_USER_ID}/reset-password`, { newPassword: "NewSecureP@ss456!" }, adminHeader); assert.equal(r.status, 404); assert.equal(r.body.error.code, "NOT_FOUND"); });
test("PUT /users/:id/reset-password hides unexpected failures", async () => { const h = createHarness(); h.addActiveToken("admin-token", "admin"); h.reset.error = new Error("PostgreSQL connection details must stay private"); const r = await request(h.app, "PUT", resetPath, { newPassword: "NewSecureP@ss456!" }, adminHeader); assert.equal(r.status, 500); assert.equal(r.body.error.code, "INTERNAL_SERVER_ERROR"); assert.equal(JSON.stringify(r.body).includes("PostgreSQL connection"), false); });

async function request(app: Express, method: "PUT", path: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, any> }> {
  return withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  });
}
async function withServer<TResult>(app: Express, run: (baseUrl: string) => Promise<TResult>): Promise<TResult> {
  const server = await new Promise<Server>((resolve, reject) => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); instance.once("error", reject); });
  try { const address = server.address() as AddressInfo; return await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error))); }
}

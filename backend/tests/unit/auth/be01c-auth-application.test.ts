import assert from "node:assert/strict";

import {
  AUTH_APPLICATION_ERROR_CODES,
  AuthAuditService,
  GetCurrentUserUseCase,
  LoginUseCase,
  LogoutUseCase,
  RefreshTokenUseCase,
} from "../../../src/modules/auth/application/index.js";
import type {
  IAuditRepository,
  IClock,
  IIdGenerator,
  IJwtService,
  IPasswordService,
  ISessionRepository,
  ISessionValidator,
  IUserRepository,
} from "../../../src/modules/auth/domain/auth.contracts.js";
import type {
  AuthRole,
  JwtClaims,
  SessionValidationResult,
} from "../../../src/modules/auth/domain/auth.types.js";
import { UuidIdGenerator } from "../../../src/modules/auth/infrastructure/index.js";

interface TestUserRecord {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: AuthRole;
  readonly displayName: string | null;
  readonly isActive: boolean;
  readonly failedLoginCount: number;
  readonly lockedUntil: Date | string | null;
  readonly lastLoginAt: Date | string | null;
  readonly createdAt: Date | string;
  readonly orgId: string;
}

interface TestSessionRecord {
  readonly userId: string;
  readonly jwtId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly expiresAt: Date;
  revokedAt: Date | null;
}

interface TestAuditRecord {
  readonly action: string;
  readonly actorId?: string | null;
  readonly actorUsername?: string | null;
  readonly actorRole?: AuthRole | null;
  readonly details?: Record<string, unknown>;
  readonly orgId?: string;
}

const FIXED_NOW = new Date("2026-08-01T00:00:00.000Z");
const DEFAULT_ORG_ID = "default";

class FixedClock implements IClock {
  public now(): Date {
    return new Date(FIXED_NOW);
  }
}


class AuthAuditRepositoryAdapter implements IAuditRepository {
  public constructor(
    private readonly auditRepository: {
      create(
        input: Parameters<IAuditRepository["create"]>[0],
      ): Promise<unknown>;
    },
  ) {}

  public async create(
    input: Parameters<IAuditRepository["create"]>[0],
  ): ReturnType<IAuditRepository["create"]> {
    const record = await this.auditRepository.create(input);

    return record as Awaited<ReturnType<IAuditRepository["create"]>>;
  }
}

class FakeIdGenerator implements IIdGenerator {
  private next = 1;

  public generate(): string {
    const value = `test-jti-${this.next}`;
    this.next += 1;
    return value;
  }
}

class FakePasswordService implements IPasswordService {
  public verifyCalls = 0;
  public shouldMatch = true;

  public async verify(): Promise<boolean> {
    this.verifyCalls += 1;
    return this.shouldMatch;
  }

  public async hash(plainTextPassword: string): Promise<string> {
    return `hashed:${plainTextPassword.length}`;
  }
}

class FakeJwtService implements IJwtService {
  public signedClaims: JwtClaims[] = [];
  public claimsToVerify: JwtClaims = makeClaims();
  public verifyError: unknown = null;

  public async sign(claims: JwtClaims): Promise<string> {
    this.signedClaims.push(claims);
    return `signed-token-${claims.jti}-${claims.exp}`;
  }

  public async verify(): Promise<JwtClaims> {
    if (this.verifyError !== null) {
      throw this.verifyError;
    }

    return this.claimsToVerify;
  }
}

class FakeSessionValidator implements ISessionValidator {
  public result: SessionValidationResult = {
    valid: true,
    session: {
      jwtId: "refresh-jti",
      userId: "user-1",
      expiresAt: addSeconds(FIXED_NOW, 3600),
      revokedAt: null,
    },
    reason: null,
  };

  public async validate(): Promise<SessionValidationResult> {
    return this.result;
  }
}

class FakeUserRepository {
  public readonly usersById = new Map<string, TestUserRecord>();
  public readonly updateCalls: Array<{
    readonly id: string;
    readonly input: Record<string, unknown>;
  }> = [];

  public add(user: TestUserRecord): void {
    this.usersById.set(user.id, user);
  }

  public async create(input: TestUserRecord): Promise<TestUserRecord> {
    this.add(input);
    return input;
  }

  public async findByUsername(
    username: string,
    orgId = DEFAULT_ORG_ID,
  ): Promise<TestUserRecord | null> {
    for (const user of this.usersById.values()) {
      if (user.username === username && user.orgId === orgId) {
        return user;
      }
    }

    return null;
  }

  public async findById(id: string): Promise<TestUserRecord | null> {
    return this.usersById.get(id) ?? null;
  }

  public async update(
    id: string,
    input: Partial<TestUserRecord>,
  ): Promise<TestUserRecord | null> {
    const existing = this.usersById.get(id);

    if (!existing) {
      return null;
    }

    this.updateCalls.push({ id, input: input as Record<string, unknown> });

    const updated: TestUserRecord = {
      ...existing,
      ...input,
    };

    this.usersById.set(id, updated);
    return updated;
  }
}

class FakeSessionRepository {
  public readonly sessions = new Map<string, TestSessionRecord>();
  public readonly revokedJwtIds: string[] = [];

  public async create(
    input: Omit<TestSessionRecord, "revokedAt">,
  ): Promise<TestSessionRecord> {
    const session: TestSessionRecord = {
      ...input,
      revokedAt: null,
    };
    this.sessions.set(session.jwtId, session);
    return session;
  }

  public async revokeByJwtId(
    jwtId: string,
    revokedAt: Date,
  ): Promise<TestSessionRecord | null> {
    this.revokedJwtIds.push(jwtId);
    const session = this.sessions.get(jwtId);

    if (!session) {
      return null;
    }

    session.revokedAt = revokedAt;
    return session;
  }
}

class FakeAuditRepository {
  public readonly records: TestAuditRecord[] = [];

  public withTransaction(): IAuditRepository {
    return this as unknown as IAuditRepository;
  }

  public async create(input: TestAuditRecord): Promise<TestAuditRecord> {
    this.records.push(input);
    return input;
  }

  public async list(): Promise<{
    readonly items: TestAuditRecord[];
    readonly total: number;
  }> {
    return { items: this.records, total: this.records.length };
  }

  public async findById(): Promise<TestAuditRecord | null> {
    return null;
  }
}

interface TestHarness {
  readonly users: FakeUserRepository;
  readonly sessions: FakeSessionRepository;
  readonly audit: FakeAuditRepository;
  readonly password: FakePasswordService;
  readonly jwt: FakeJwtService;
  readonly sessionValidator: FakeSessionValidator;
  readonly loginUseCase: LoginUseCase;
  readonly logoutUseCase: LogoutUseCase;
  readonly refreshTokenUseCase: RefreshTokenUseCase;
  readonly getCurrentUserUseCase: GetCurrentUserUseCase;
}

const tests: Array<{
  readonly name: string;
  readonly run: () => Promise<void>;
}> = [
  {
    name: "LoginUseCase valid credentials create session and return token/user/expiresAt",
    run: async () => {
      const harness = createHarness();
      harness.users.add(makeUser());

      const result = await harness.loginUseCase.execute({
        username: "analyst",
        password: "correct-password",
        ipAddress: "127.0.0.1",
        userAgent: "be01c-unit-test",
      });

      assert.equal(result.token.startsWith("signed-token-test-jti-1"), true);
      assert.equal(result.expiresAt, "2026-08-01T01:00:00.000Z");
      assert.equal(result.user.id, "user-1");
      assert.equal(result.user.username, "analyst");
      assert.equal(harness.sessions.sessions.size, 1);
      assert.equal(harness.jwt.signedClaims[0]?.jti, "test-jti-1");
      assertNoSensitiveUserFields(result.user);
    },
  },
  {
    name: "LoginUseCase invalid username returns INVALID_CREDENTIALS",
    run: async () => {
      const harness = createHarness();

      await assertRejectsWithCode(
        () =>
          harness.loginUseCase.execute({ username: "missing", password: "x" }),
        AUTH_APPLICATION_ERROR_CODES.INVALID_CREDENTIALS,
      );
    },
  },
  {
    name: "LoginUseCase invalid password increments failed_login_count",
    run: async () => {
      const harness = createHarness();
      harness.password.shouldMatch = false;
      harness.users.add(makeUser({ failedLoginCount: 1 }));

      await assertRejectsWithCode(
        () =>
          harness.loginUseCase.execute({
            username: "analyst",
            password: "bad",
          }),
        AUTH_APPLICATION_ERROR_CODES.INVALID_CREDENTIALS,
      );

      const user = await harness.users.findById("user-1");
      assert.equal(user?.failedLoginCount, 2);
      assert.equal(user?.lockedUntil, null);
    },
  },
  {
    name: "LoginUseCase fifth invalid password locks account",
    run: async () => {
      const harness = createHarness();
      harness.password.shouldMatch = false;
      harness.users.add(makeUser({ failedLoginCount: 4 }));

      await assertRejectsWithCode(
        () =>
          harness.loginUseCase.execute({
            username: "analyst",
            password: "bad",
          }),
        AUTH_APPLICATION_ERROR_CODES.ACCOUNT_LOCKED,
      );

      const user = await harness.users.findById("user-1");
      assert.equal(user?.failedLoginCount, 5);
      assert.equal(
        new Date(user?.lockedUntil as Date).toISOString(),
        "2026-08-01T00:15:00.000Z",
      );
    },
  },
  {
    name: "LoginUseCase locked account returns ACCOUNT_LOCKED",
    run: async () => {
      const harness = createHarness();
      harness.users.add(makeUser({ lockedUntil: addSeconds(FIXED_NOW, 60) }));

      await assertRejectsWithCode(
        () =>
          harness.loginUseCase.execute({
            username: "analyst",
            password: "correct-password",
          }),
        AUTH_APPLICATION_ERROR_CODES.ACCOUNT_LOCKED,
      );
      assert.equal(harness.password.verifyCalls, 0);
    },
  },
  {
    name: "LoginUseCase inactive user cannot log in",
    run: async () => {
      const harness = createHarness();
      harness.users.add(makeUser({ isActive: false }));

      await assertRejectsWithCode(
        () =>
          harness.loginUseCase.execute({
            username: "analyst",
            password: "correct-password",
          }),
        AUTH_APPLICATION_ERROR_CODES.USER_INACTIVE,
      );
    },
  },
  {
    name: "LoginUseCase successful login resets failed_login_count and locked_until",
    run: async () => {
      const harness = createHarness();
      harness.users.add(
        makeUser({
          failedLoginCount: 3,
          lockedUntil: addSeconds(FIXED_NOW, -60),
        }),
      );

      await harness.loginUseCase.execute({
        username: "analyst",
        password: "correct-password",
      });

      const user = await harness.users.findById("user-1");
      assert.equal(user?.failedLoginCount, 0);
      assert.equal(user?.lockedUntil, null);
      assert.equal(
        new Date(user?.lastLoginAt as Date).toISOString(),
        FIXED_NOW.toISOString(),
      );
    },
  },
  {
    name: "LoginUseCase successful login writes audit event",
    run: async () => {
      const harness = createHarness();
      harness.users.add(makeUser());

      await harness.loginUseCase.execute({
        username: "analyst",
        password: "correct-password",
      });

      assert.equal(harness.audit.records.length, 1);
      assert.equal(harness.audit.records[0]?.action, "login");
      assert.equal(harness.audit.records[0]?.details?.event, "login_success");
    },
  },
  {
    name: "LoginUseCase failed login writes audit event",
    run: async () => {
      const harness = createHarness();
      harness.password.shouldMatch = false;
      harness.users.add(makeUser());

      await assertRejectsWithCode(
        () =>
          harness.loginUseCase.execute({
            username: "analyst",
            password: "bad",
          }),
        AUTH_APPLICATION_ERROR_CODES.INVALID_CREDENTIALS,
      );

      assert.equal(harness.audit.records.length, 1);
      assert.equal(harness.audit.records[0]?.action, "login");
      assert.equal(harness.audit.records[0]?.details?.event, "login_failure");
    },
  },
  {
    name: "LoginUseCase password is never returned",
    run: async () => {
      const harness = createHarness();
      harness.users.add(makeUser());

      const result = await harness.loginUseCase.execute({
        username: "analyst",
        password: "correct-password",
      });

      assertNoSensitiveUserFields(result.user);
    },
  },
  {
    name: "LogoutUseCase active session is revoked",
    run: async () => {
      const harness = createHarness();
      await harness.sessions.create({
        userId: "user-1",
        jwtId: "logout-jti",
        ipAddress: null,
        userAgent: null,
        expiresAt: addSeconds(FIXED_NOW, 3600),
      });

      const result = await harness.logoutUseCase.execute({
        session: makeSessionContext("logout-jti"),
      });

      assert.equal(result.message, "Logged out successfully");
      assert.equal(
        harness.sessions.sessions.get("logout-jti")?.revokedAt?.toISOString(),
        FIXED_NOW.toISOString(),
      );
    },
  },
  {
    name: "LogoutUseCase repeated logout is safe/idempotent",
    run: async () => {
      const harness = createHarness();

      await harness.logoutUseCase.execute({
        session: makeSessionContext("missing-jti"),
      });
      await harness.logoutUseCase.execute({
        session: makeSessionContext("missing-jti"),
      });

      assert.deepEqual(harness.sessions.revokedJwtIds, [
        "missing-jti",
        "missing-jti",
      ]);
    },
  },
  {
    name: "LogoutUseCase logout writes audit event",
    run: async () => {
      const harness = createHarness();

      await harness.logoutUseCase.execute({
        session: makeSessionContext("logout-jti"),
      });

      assert.equal(harness.audit.records.length, 1);
      assert.equal(harness.audit.records[0]?.action, "logout");
      assert.equal(harness.audit.records[0]?.details?.event, "logout");
    },
  },
  {
    name: "RefreshTokenUseCase valid active session refreshes token",
    run: async () => {
      const harness = createHarness();
      harness.users.add(makeUser());
      harness.jwt.claimsToVerify = makeClaims({
        exp: toUnixSeconds(addSeconds(FIXED_NOW, 60)),
      });

      const result = await harness.refreshTokenUseCase.execute({
        token: "old-token",
      });

      assert.equal(result.token.startsWith("signed-token-refresh-jti"), true);
      assert.equal(result.expiresAt, "2026-08-01T01:00:00.000Z");
    },
  },
  {
    name: "RefreshTokenUseCase revoked session is rejected",
    run: async () => {
      const harness = createHarness();
      harness.users.add(makeUser());
      harness.sessionValidator.result = {
        valid: false,
        session: null,
        reason: "revoked",
      };

      await assertRejectsWithCode(
        () => harness.refreshTokenUseCase.execute({ token: "old-token" }),
        AUTH_APPLICATION_ERROR_CODES.SESSION_REVOKED,
      );
    },
  },
  {
    name: "RefreshTokenUseCase expired session is rejected",
    run: async () => {
      const harness = createHarness();
      harness.users.add(makeUser());
      harness.sessionValidator.result = {
        valid: false,
        session: null,
        reason: "expired",
      };

      await assertRejectsWithCode(
        () => harness.refreshTokenUseCase.execute({ token: "old-token" }),
        AUTH_APPLICATION_ERROR_CODES.SESSION_EXPIRED,
      );
    },
  },
  {
    name: "RefreshTokenUseCase inactive user is rejected",
    run: async () => {
      const harness = createHarness();
      harness.users.add(makeUser({ isActive: false }));
      harness.jwt.claimsToVerify = makeClaims({
        exp: toUnixSeconds(addSeconds(FIXED_NOW, 60)),
      });

      await assertRejectsWithCode(
        () => harness.refreshTokenUseCase.execute({ token: "old-token" }),
        AUTH_APPLICATION_ERROR_CODES.USER_INACTIVE,
      );
    },
  },
  {
    name: "RefreshTokenUseCase claims are preserved: sub, username, role, jti",
    run: async () => {
      const harness = createHarness();
      harness.users.add(makeUser());
      harness.jwt.claimsToVerify = makeClaims({
        exp: toUnixSeconds(addSeconds(FIXED_NOW, 60)),
      });

      await harness.refreshTokenUseCase.execute({ token: "old-token" });

      const signed = harness.jwt.signedClaims[0];
      assert.equal(signed?.sub, "user-1");
      assert.equal(signed?.username, "analyst");
      assert.equal(signed?.role, "soc_analyst");
      assert.equal(signed?.jti, "refresh-jti");
    },
  },
  {
    name: "GetCurrentUserUseCase returns safe DTO",
    run: async () => {
      const harness = createHarness();
      harness.users.add(makeUser());

      const result = await harness.getCurrentUserUseCase.execute({
        userId: "user-1",
      });

      assert.equal(result.id, "user-1");
      assert.equal(result.username, "analyst");
      assert.equal(result.createdAt, "2026-07-31T00:00:00.000Z");
      assertNoSensitiveUserFields(result);
    },
  },
  {
    name: "GetCurrentUserUseCase missing user rejected",
    run: async () => {
      const harness = createHarness();

      await assertRejectsWithCode(
        () => harness.getCurrentUserUseCase.execute({ userId: "missing" }),
        AUTH_APPLICATION_ERROR_CODES.USER_NOT_FOUND,
      );
    },
  },
  {
    name: "GetCurrentUserUseCase inactive user rejected",
    run: async () => {
      const harness = createHarness();
      harness.users.add(makeUser({ isActive: false }));

      await assertRejectsWithCode(
        () => harness.getCurrentUserUseCase.execute({ userId: "user-1" }),
        AUTH_APPLICATION_ERROR_CODES.USER_INACTIVE,
      );
    },
  },
  {
    name: "GetCurrentUserUseCase password_hash is never returned",
    run: async () => {
      const harness = createHarness();
      harness.users.add(makeUser());

      const result = await harness.getCurrentUserUseCase.execute({
        userId: "user-1",
      });

      assertNoSensitiveUserFields(result);
    },
  },
];

void main();

async function main(): Promise<void> {
  const startedAt = Date.now();
  const results: Array<{
    readonly name: string;
    readonly status: "pass" | "fail";
    readonly durationMs: number;
    readonly error?: string;
  }> = [];

  for (const test of tests) {
    const testStartedAt = Date.now();
    try {
      await test.run();
      results.push({
        name: test.name,
        status: "pass",
        durationMs: Date.now() - testStartedAt,
      });
    } catch (error) {
      results.push({
        name: test.name,
        status: "fail",
        durationMs: Date.now() - testStartedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const failed = results.filter((result) => result.status === "fail");
  console.log(
    JSON.stringify(
      {
        success: failed.length === 0,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        totals: {
          tests: results.length,
          passed: results.length - failed.length,
          failed: failed.length,
        },
        results,
      },
      null,
      2,
    ),
  );

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

function createHarness(): TestHarness {
  const users = new FakeUserRepository();
  const sessions = new FakeSessionRepository();
  const audit = new FakeAuditRepository();
  const password = new FakePasswordService();
  const jwt = new FakeJwtService();
 const sessionValidator = new FakeSessionValidator();
 const clock = new FixedClock();
 const idGenerator = new FakeIdGenerator();

 const authAuditService = new AuthAuditService(
   audit as unknown as IAuditRepository,
   idGenerator,
 );

  return {
    users,
    sessions,
    audit,
    password,
    jwt,
    sessionValidator,
    loginUseCase: new LoginUseCase(
      users as unknown as Pick<IUserRepository, "findByUsername" | "update">,
      sessions as unknown as Pick<ISessionRepository, "create">,
      password,
      jwt,
      new FakeIdGenerator(),
      clock,
      authAuditService,
      {
        accessTokenTtlSeconds: 3600,
        lockoutAttempts: 5,
        lockoutDurationMinutes: 15,
        orgId: DEFAULT_ORG_ID,
      },
    ),
    logoutUseCase: new LogoutUseCase(
  sessions as unknown as ISessionRepository,
  authAuditService,
  clock,
),
    refreshTokenUseCase: new RefreshTokenUseCase(
      jwt,
      sessionValidator,
      users as unknown as Pick<IUserRepository, "findById">,
      clock,
      {
        accessTokenTtlSeconds: 3600,
        refreshWindowSeconds: 300,
      },
    ),
    getCurrentUserUseCase: new GetCurrentUserUseCase(
      users as unknown as Pick<IUserRepository, "findById">,
    ),
  };
}

function makeUser(overrides: Partial<TestUserRecord> = {}): TestUserRecord {
  return {
    id: "user-1",
    username: "analyst",
    email: "analyst@example.test",
    passwordHash: "$2b$12$testhashplaceholder",
    role: "soc_analyst",
    displayName: "SOC Analyst",
    isActive: true,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: new Date("2026-07-31T00:00:00.000Z"),
    orgId: DEFAULT_ORG_ID,
    ...overrides,
  };
}

function makeClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: "user-1",
    username: "analyst",
    role: "soc_analyst",
    jti: "refresh-jti",
    iat: toUnixSeconds(addSeconds(FIXED_NOW, -3540)),
    exp: toUnixSeconds(addSeconds(FIXED_NOW, 60)),
    iss: "ai-siem",
    ...overrides,
  };
}

function makeSessionContext(jwtId: string) {
  return {
    userId: "user-1",
    username: "analyst",
    role: "soc_analyst" as const,
    jwtId,
    issuedAt: FIXED_NOW.toISOString(),
    expiresAt: addSeconds(FIXED_NOW, 3600).toISOString(),
    issuer: "ai-siem",
    orgId: DEFAULT_ORG_ID,
  };
}

async function assertRejectsWithCode(
  action: () => Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  let thrown: unknown = null;

  try {
    await action();
  } catch (error) {
    thrown = error;
  }

  assert.notEqual(thrown, null, `Expected error code ${expectedCode}`);
  assert.equal(getErrorCode(thrown), expectedCode);
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { readonly code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }

  return undefined;
}

function assertNoSensitiveUserFields(value: unknown): void {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  const record = value as Record<string, unknown>;

  assert.equal(
    Object.prototype.hasOwnProperty.call(record, "passwordHash"),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(record, "password_hash"),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(record, "failedLoginCount"),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(record, "failed_login_count"),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(record, "lockedUntil"),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(record, "locked_until"),
    false,
  );
  assert.equal(Object.prototype.hasOwnProperty.call(record, "token"), false);
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

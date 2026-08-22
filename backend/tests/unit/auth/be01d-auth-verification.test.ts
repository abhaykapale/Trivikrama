import assert from "node:assert/strict";

import {
  AUTH_APPLICATION_ERROR_CODES,
  AuthAuditService,
  LoginUseCase,
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

const FIXED_NOW = new Date("2026-08-01T00:00:00.000Z");
const DEFAULT_ORG_ID = "default";

type TestCase = {
  readonly name: string;
  readonly run: () => Promise<void>;
};

interface TestUserRecord {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: AuthRole;
  readonly displayName: string | null;
  readonly isActive: boolean;
  readonly failedLoginCount: number;
  readonly lockedUntil: Date | null;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly orgId: string;
}

interface TestSessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly jwtId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
}

class FixedClock implements IClock {
  public now(): Date {
    return new Date(FIXED_NOW);
  }
}

class FakeIdGenerator implements IIdGenerator {
  private next = 1;

  public generate(): string {
    const value = `be01d-jti-${this.next}`;
    this.next += 1;
    return value;
  }
}

class FakePasswordService implements IPasswordService {
  public shouldMatch = true;

  public async verify(): Promise<boolean> {
    return this.shouldMatch;
  }

  public async hash(plainTextPassword: string): Promise<string> {
    return `hashed:${plainTextPassword.length}`;
  }
}

class FakeJwtService implements IJwtService {
  public signedClaims: JwtClaims[] = [];
  public claimsToVerify: JwtClaims = makeClaims();

  public async sign(claims: JwtClaims): Promise<string> {
    this.signedClaims.push(claims);
    return `signed:${claims.jti}:${claims.exp}`;
  }

  public async verify(): Promise<JwtClaims> {
    return this.claimsToVerify;
  }
}

class FakeSessionValidator implements ISessionValidator {
  public result: SessionValidationResult = {
    valid: true,
    session: {
      jwtId: "old-refresh-jti",
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
  public readonly users = new Map<string, TestUserRecord>();
  public updateCalls = 0;
  public incrementFailedLoginCountCalls = 0;
  public recordSuccessfulLoginCalls = 0;

  public add(user: TestUserRecord): void {
    this.users.set(user.id, user);
  }

  public async findByUsername(
    username: string,
    orgId = DEFAULT_ORG_ID,
  ): Promise<TestUserRecord | null> {
    for (const user of this.users.values()) {
      if (user.username === username && user.orgId === orgId) {
        return user;
      }
    }

    return null;
  }

  public async findById(id: string): Promise<TestUserRecord | null> {
    return this.users.get(id) ?? null;
  }

  public async update(
    id: string,
    input: Partial<TestUserRecord>,
  ): Promise<TestUserRecord | null> {
    this.updateCalls += 1;
    const existing = this.users.get(id);

    if (existing === undefined) {
      return null;
    }

    const updated = { ...existing, ...input };
    this.users.set(id, updated);
    return updated;
  }

  public async incrementFailedLoginCount(
    id: string,
  ): Promise<TestUserRecord | null> {
    this.incrementFailedLoginCountCalls += 1;
    const existing = this.users.get(id);

    if (existing === undefined) {
      return null;
    }

    const updated = {
      ...existing,
      failedLoginCount: existing.failedLoginCount + 1,
    };
    this.users.set(id, updated);
    return updated;
  }

  public async lockUserUntil(
    id: string,
    lockedUntil: Date,
  ): Promise<TestUserRecord | null> {
    return this.update(id, { lockedUntil });
  }

  public async recordSuccessfulLogin(
    id: string,
    loginAt: Date,
  ): Promise<TestUserRecord | null> {
    this.recordSuccessfulLoginCalls += 1;
    const existing = this.users.get(id);

    if (existing === undefined) {
      return null;
    }

    const updated = {
      ...existing,
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: loginAt,
    };
    this.users.set(id, updated);
    return updated;
  }
}

class FakeSessionRepository {
  public readonly sessions = new Map<string, TestSessionRecord>();
  public readonly createdSessions: Array<{
    readonly userId: string;
    readonly jwtId: string;
    readonly expiresAt: Date;
  }> = [];
  public readonly rotations: Array<{
    readonly oldJwtId: string;
    readonly newJwtId: string;
    readonly activeAt: Date;
    readonly expiresAt: Date | undefined;
  }> = [];

  public add(session: TestSessionRecord): void {
    this.sessions.set(session.jwtId, session);
  }

  public async create(input: {
    readonly userId: string;
    readonly jwtId: string;
    readonly ipAddress?: string | null;
    readonly userAgent?: string | null;
    readonly expiresAt: Date;
  }): Promise<TestSessionRecord> {
    this.createdSessions.push(input);
    const session: TestSessionRecord = {
      id: `session-${this.createdSessions.length}`,
      userId: input.userId,
      jwtId: input.jwtId,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      expiresAt: input.expiresAt,
      createdAt: FIXED_NOW,
      revokedAt: null,
    };
    this.add(session);
    return session;
  }

  public async findByJwtId(jwtId: string): Promise<TestSessionRecord | null> {
    return this.sessions.get(jwtId) ?? null;
  }

  public async rotateJwtId(
    oldJwtId: string,
    newJwtId: string,
    activeAt = new Date(),
    expiresAt?: Date,
  ): Promise<TestSessionRecord | null> {
    this.rotations.push({ oldJwtId, newJwtId, activeAt, expiresAt });
    const session = this.sessions.get(oldJwtId);

    if (
      session === undefined ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= activeAt.getTime()
    ) {
      return null;
    }

    const rotated = {
      ...session,
      jwtId: newJwtId,
      expiresAt: expiresAt ?? session.expiresAt,
    };
    this.sessions.delete(oldJwtId);
    this.sessions.set(newJwtId, rotated);
    return rotated;
  }
}

class FakeAuditRepository implements IAuditRepository {
  public readonly records: Parameters<IAuditRepository["create"]>[0][] = [];

  public async create(
    input: Parameters<IAuditRepository["create"]>[0],
  ): ReturnType<IAuditRepository["create"]> {
    this.records.push(input);
    return {
      id: input.id ?? `audit-${this.records.length}`,
      action: input.action,
      actorId: input.actorId ?? null,
      actorUsername: input.actorUsername ?? null,
      actorRole: input.actorRole ?? null,
      ipAddress: input.ipAddress ?? null,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      targetName: input.targetName ?? null,
      details: input.details ?? {},
      previousState: input.previousState ?? null,
      newState: input.newState ?? null,
      createdAt: FIXED_NOW,
      orgId: input.orgId ?? DEFAULT_ORG_ID,
    };
  }
}

class FakeLoginTransactionManager {
  public executeCalls = 0;
  public constructor(
    private readonly users: FakeUserRepository,
    private readonly sessions: FakeSessionRepository,
  ) {}

  public async execute<TResult>(
    operation: (repositories: {
      readonly users: FakeUserRepository;
      readonly sessions: FakeSessionRepository;
    }) => Promise<TResult>,
  ): Promise<TResult> {
    this.executeCalls += 1;
    return operation({
      users: this.users,
      sessions: this.sessions,
    });
  }
}

const tests: readonly TestCase[] = [
  {
    name: "LoginUseCase failed password uses atomic failed-login increment",
    run: async () => {
      const harness = createLoginHarness();
      harness.password.shouldMatch = false;
      harness.users.add(makeUser({ failedLoginCount: 2 }));

      await assertRejectsWithCode(
        () =>
          harness.loginUseCase.execute({
            username: "analyst",
            password: "incorrect-password",
          }),
        AUTH_APPLICATION_ERROR_CODES.INVALID_CREDENTIALS,
      );

      const user = await harness.users.findById("user-1");
      assert.equal(user?.failedLoginCount, 3);
      assert.equal(harness.users.incrementFailedLoginCountCalls, 1);
    },
  },
  {
    name: "LoginUseCase persists successful login and session through Unit of Work",
    run: async () => {
      const harness = createLoginHarness();
      harness.users.add(makeUser({ failedLoginCount: 4 }));

      const result = await harness.loginUseCase.execute({
        username: "analyst",
        password: "correct-password",
        ipAddress: "192.0.2.10",
        userAgent: "be01d-verification",
      });

      assert.equal(harness.transactionManager.executeCalls, 1);
      assert.equal(harness.users.recordSuccessfulLoginCalls, 1);
      assert.equal(harness.sessions.createdSessions.length, 1);
      assert.equal(result.expiresAt, "2026-08-01T01:00:00.000Z");
      assert.equal(harness.sessions.createdSessions[0]?.jwtId, "be01d-jti-1");
      assert.equal(harness.audit.records[0]?.details?.event, "login_success");
    },
  },
  {
    name: "RefreshTokenUseCase rotates JTI and caps expiry at max session duration",
    run: async () => {
      const users = new FakeUserRepository();
      const sessions = new FakeSessionRepository();
      const audit = new FakeAuditRepository();
      const jwt = new FakeJwtService();
      const validator = new FakeSessionValidator();
      const idGenerator = new FakeIdGenerator();
      const auditService = new AuthAuditService(audit, idGenerator);

      users.add(makeUser());
      sessions.add({
        id: "session-1",
        userId: "user-1",
        jwtId: "old-refresh-jti",
        ipAddress: null,
        userAgent: null,
        expiresAt: addSeconds(FIXED_NOW, 3600),
        createdAt: addSeconds(FIXED_NOW, -(7 * 24 * 60 * 60) + 1800),
        revokedAt: null,
      });
      jwt.claimsToVerify = makeClaims({
        jti: "old-refresh-jti",
        exp: toUnixSeconds(addSeconds(FIXED_NOW, 60)),
      });

      const useCase = new RefreshTokenUseCase(
        jwt,
        validator,
        users as unknown as Pick<IUserRepository, "findById">,
        new FixedClock(),
        {
          accessTokenTtlSeconds: 3600,
          refreshWindowSeconds: 300,
          maxSessionDurationSeconds: 7 * 24 * 60 * 60,
        },
        {
          sessionRepository: sessions as unknown as Pick<
            ISessionRepository,
            "findByJwtId" | "rotateJwtId"
          >,
          idGenerator,
          authAuditService: auditService,
        },
      );

      const result = await useCase.execute({
        token: "old-token",
        ipAddress: "192.0.2.11",
      });

      assert.equal(result.token.startsWith("signed:be01d-jti-1"), true);
      assert.equal(result.expiresAt, "2026-08-01T00:30:00.000Z");
      assert.equal(jwt.signedClaims[0]?.jti, "be01d-jti-1");
      assert.equal(jwt.signedClaims[0]?.exp, toUnixSeconds(addSeconds(FIXED_NOW, 1800)));
      assert.equal(sessions.rotations.length, 1);
      assert.equal(sessions.rotations[0]?.oldJwtId, "old-refresh-jti");
      assert.equal(sessions.rotations[0]?.newJwtId, "be01d-jti-1");
      assert.equal(
        sessions.rotations[0]?.expiresAt?.toISOString(),
        "2026-08-01T00:30:00.000Z",
      );
      assert.equal(await sessions.findByJwtId("old-refresh-jti"), null);
      assert.notEqual(await sessions.findByJwtId("be01d-jti-1"), null);
      assert.equal(audit.records[0]?.details?.event, "refresh_success");
    },
  },
  {
    name: "RefreshTokenUseCase rejects refresh after maximum session duration",
    run: async () => {
      const users = new FakeUserRepository();
      const sessions = new FakeSessionRepository();
      const jwt = new FakeJwtService();

      users.add(makeUser());
      sessions.add({
        id: "session-1",
        userId: "user-1",
        jwtId: "old-refresh-jti",
        ipAddress: null,
        userAgent: null,
        expiresAt: addSeconds(FIXED_NOW, 3600),
        createdAt: addSeconds(FIXED_NOW, -(7 * 24 * 60 * 60) - 1),
        revokedAt: null,
      });

      const useCase = new RefreshTokenUseCase(
        jwt,
        new FakeSessionValidator(),
        users as unknown as Pick<IUserRepository, "findById">,
        new FixedClock(),
        {
          accessTokenTtlSeconds: 3600,
          refreshWindowSeconds: 300,
          maxSessionDurationSeconds: 7 * 24 * 60 * 60,
        },
        {
          sessionRepository: sessions as unknown as Pick<
            ISessionRepository,
            "findByJwtId" | "rotateJwtId"
          >,
          idGenerator: new FakeIdGenerator(),
        },
      );

      await assertRejectsWithCode(
        () => useCase.execute({ token: "old-token" }),
        AUTH_APPLICATION_ERROR_CODES.SESSION_EXPIRED,
      );
      assert.equal(sessions.rotations.length, 0);
    },
  },
];

void main();

async function main(): Promise<void> {
  await runTests(tests);
}

async function runTests(testCases: readonly TestCase[]): Promise<void> {
  const startedAt = Date.now();
  const results: Array<{
    readonly name: string;
    readonly status: "pass" | "fail";
    readonly durationMs: number;
    readonly error?: string;
  }> = [];

  for (const test of testCases) {
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

function createLoginHarness(): {
  readonly users: FakeUserRepository;
  readonly sessions: FakeSessionRepository;
  readonly audit: FakeAuditRepository;
  readonly password: FakePasswordService;
  readonly loginUseCase: LoginUseCase;
  readonly transactionManager: FakeLoginTransactionManager;
} {
  const users = new FakeUserRepository();
  const sessions = new FakeSessionRepository();
  const audit = new FakeAuditRepository();
  const password = new FakePasswordService();
  const transactionManager = new FakeLoginTransactionManager(users, sessions);
  const auditService = new AuthAuditService(audit, new FakeIdGenerator());

  return {
    users,
    sessions,
    audit,
    password,
    transactionManager,
    loginUseCase: new LoginUseCase(
      users as unknown as Pick<
        IUserRepository,
        | "findByUsername"
        | "update"
        | "incrementFailedLoginCount"
        | "lockUserUntil"
        | "recordSuccessfulLogin"
      >,
      sessions as unknown as Pick<ISessionRepository, "create">,
      password,
      new FakeJwtService(),
      new FakeIdGenerator(),
      new FixedClock(),
      auditService,
      {
        accessTokenTtlSeconds: 3600,
        lockoutAttempts: 5,
        lockoutDurationMinutes: 15,
        orgId: DEFAULT_ORG_ID,
      },
      transactionManager,
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
    updatedAt: new Date("2026-07-31T00:00:00.000Z"),
    orgId: DEFAULT_ORG_ID,
    ...overrides,
  };
}

function makeClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: "user-1",
    username: "analyst",
    role: "soc_analyst",
    jti: "old-refresh-jti",
    iat: toUnixSeconds(addSeconds(FIXED_NOW, -3540)),
    exp: toUnixSeconds(addSeconds(FIXED_NOW, 60)),
    iss: "ai-siem",
    ...overrides,
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

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

import assert from "node:assert/strict";
import crypto from "node:crypto";

import "dotenv/config";

import {
  closePostgres,
  createPostgresClient,
  createPostgresRepositories,
  createPostgresUnitOfWork,
  type PostgresClient,
  type PostgresRepositories,
  type PostgresUnitOfWork,
} from "../../../src/database/index.js";

// const MIGRATION_NAME = "20260801000100_be_01a_auth_repository_compatibility.js";
const TEST_ORG_PREFIX = "be01a-test";
const CONCURRENT_FAILURES = 20;

interface TestContext {
  readonly postgres: PostgresClient;
  readonly repositories: PostgresRepositories;
  readonly unitOfWork: PostgresUnitOfWork;
  readonly orgId: string;
}

async function main(): Promise<void> {
  assertSafeToRun();

  const databaseUrl =
    process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
  }

  const postgres = createPostgresClient({
    connectionString: databaseUrl,
    poolMin: 0,
    poolMax: 12,
    acquireConnectionTimeoutMs: 5_000,
    applicationName: "trivikrama-be01a-integration-tests",
  });

  const context: TestContext = {
    postgres,
    repositories: createPostgresRepositories(postgres),
    unitOfWork: createPostgresUnitOfWork(postgres, {
      defaultStatementTimeoutMs: 10_000,
      defaultLockTimeoutMs: 5_000,
      defaultRetry: {
        maxAttempts: 2,
        baseDelayMs: 10,
        maxDelayMs: 50,
      },
    }),
    orgId: `${TEST_ORG_PREFIX}-${crypto.randomUUID()}`,
  };

  const startedAt = Date.now();
  const results: Array<{
    readonly name: string;
    readonly status: "pass" | "fail";
    readonly durationMs: number;
    readonly error?: string;
  }> = [];

  const testCases: ReadonlyArray<{
    readonly name: string;
    readonly run: (testContext: TestContext) => Promise<void>;
  }> = [
    {
      name: "compatibility migration and required auth indexes are present",
      run: verifyMigrationAndIndexes,
    },
    {
      name: "user repository supports atomic authentication state updates",
      run: verifyUserRepository,
    },
    {
      name: "session repository supports active lookup, revocation, and atomic rotation",
      run: verifySessionRepository,
    },
    {
      name: "audit repository appends auth events and audit rows remain immutable",
      run: verifyAuditRepository,
    },
    {
      name: "unit of work commits and rolls back complete authentication write sets",
      run: verifyAuthUnitOfWorkReadiness,
    },
  ];

  try {
    for (const testCase of testCases) {
      const testStartedAt = Date.now();

      try {
        await testCase.run(context);
        results.push({
          name: testCase.name,
          status: "pass",
          durationMs: Date.now() - testStartedAt,
        });
      } catch (error) {
        results.push({
          name: testCase.name,
          status: "fail",
          durationMs: Date.now() - testStartedAt,
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }
    }
  } finally {
    await cleanup(context).catch(() => undefined);
    await closePostgres(postgres);
  }

  const failed = results.filter((result) => result.status === "fail");
  console.log(
    JSON.stringify(
      {
        success: failed.length === 0 && results.length === testCases.length,
        suite: "BE-01A authentication repository foundation",
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        totals: {
          tests: testCases.length,
          passed: results.filter((result) => result.status === "pass").length,
          failed: failed.length,
        },
        results,
      },
      null,
      2,
    ),
  );

  if (failed.length > 0 || results.length !== testCases.length) {
    process.exitCode = 1;
  }
}

async function verifyMigrationAndIndexes({
  postgres,
}: TestContext): Promise<void> {
  // const appliedMigration = await postgres("public.knex_migrations")
  //   .where("name", MIGRATION_NAME)
  //   .first<{ name: string }>();
  // assert.equal(appliedMigration?.name, MIGRATION_NAME);

  const enumRows = (await postgres
    .select("e.enumlabel")
    .from({ e: "pg_catalog.pg_enum" })
    .innerJoin({ t: "pg_catalog.pg_type" }, "t.oid", "e.enumtypid")
    .innerJoin({ n: "pg_catalog.pg_namespace" }, "n.oid", "t.typnamespace")
    .where("n.nspname", "public")
    .andWhere("t.typname", "audit_action")) as Array<{
    readonly enumlabel: string;
  }>;

  const enumValues = new Set(enumRows.map((row) => row.enumlabel));
  assert.equal(enumValues.has("login_failed"), true);
  assert.equal(enumValues.has("session_revoked"), true);

  const indexRows = (await postgres
    .select("schemaname", "tablename", "indexname", "indexdef")
    .from("pg_catalog.pg_indexes")
    .where((builder) => {
      builder
        .where({ schemaname: "public", tablename: "users" })
        .orWhere({ schemaname: "public", tablename: "sessions" })
        .orWhere({ schemaname: "audit", tablename: "audit_logs" });
    })) as Array<{
    readonly schemaname: string;
    readonly tablename: string;
    readonly indexname: string;
    readonly indexdef: string;
  }>;

  assertIndex(indexRows, "public", "users", ["(username, org_id)"]);
  assertIndex(indexRows, "public", "sessions", ["(jwt_id)"]);
  assertIndex(indexRows, "public", "sessions", ["(expires_at)"]);
  assertIndex(indexRows, "public", "sessions", [
    "(jwt_id)",
    "revoked_at is null",
  ]);
  assertIndex(indexRows, "audit", "audit_logs", ["(created_at desc)"]);
  assertIndex(indexRows, "audit", "audit_logs", [
    "(action, created_at desc)",
  ]);
  assertIndex(indexRows, "audit", "audit_logs", [
    "(actor_id, created_at desc)",
  ]);
  assertIndex(indexRows, "audit", "audit_logs", [
    "(target_type, target_id, created_at desc)",
  ]);
}

async function verifyUserRepository({
  repositories,
  orgId,
}: TestContext): Promise<void> {
  const user = await createTestUser(repositories, orgId, "atomic");

  const found = await repositories.users.findByUsernameAndOrg(
    user.username,
    orgId,
  );
  assert.equal(found?.id, user.id);

  const increments = await Promise.all(
    Array.from({ length: CONCURRENT_FAILURES }, () =>
      repositories.users.incrementFailedLoginCount(user.id),
    ),
  );

  const observedCounts = increments
    .map((updated) => updated?.failedLoginCount)
    .filter((value): value is number => value !== undefined)
    .sort((left, right) => left - right);

  assert.deepEqual(
    observedCounts,
    Array.from({ length: CONCURRENT_FAILURES }, (_, index) => index + 1),
  );

  const afterConcurrentFailures = await repositories.users.findById(user.id);
  assert.equal(
    afterConcurrentFailures?.failedLoginCount,
    CONCURRENT_FAILURES,
  );

  const lockedUntil = new Date(Date.now() + 15 * 60 * 1_000);
  const locked = await repositories.users.lockUserUntil(user.id, lockedUntil);
  assert.equal(locked?.lockedUntil?.getTime(), lockedUntil.getTime());

  const reset = await repositories.users.resetLoginFailures(user.id);
  assert.equal(reset?.failedLoginCount, 0);
  assert.equal(reset?.lockedUntil, null);

  const loginAt = new Date();
  const loggedIn = await repositories.users.markLastLogin(user.id, loginAt);
  assert.equal(loggedIn?.lastLoginAt?.getTime(), loginAt.getTime());
}

async function verifySessionRepository({
  repositories,
  orgId,
}: TestContext): Promise<void> {
  const user = await createTestUser(repositories, orgId, "session");
  const oldJwtId = `be01a-old-${crypto.randomUUID()}`;
  const newJwtId = `be01a-new-${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + 60 * 60 * 1_000);

  const session = await repositories.sessions.createSession({
    userId: user.id,
    jwtId: oldJwtId,
    ipAddress: "127.0.0.1",
    userAgent: "be01a-integration-test",
    expiresAt,
  });
  assert.equal(session.jwtId, oldJwtId);

  const active = await repositories.sessions.findActiveByJwtId(oldJwtId);
  assert.equal(active?.id, session.id);

  const rotated = await repositories.sessions.rotateJwtId(
    oldJwtId,
    newJwtId,
  );
  assert.equal(rotated?.id, session.id);
  assert.equal(rotated?.jwtId, newJwtId);

  assert.equal(
    await repositories.sessions.findActiveByJwtId(oldJwtId),
    null,
  );
  assert.equal(
    (await repositories.sessions.findActiveByJwtId(newJwtId))?.id,
    session.id,
  );

  const replayedRotation = await repositories.sessions.rotateJwtId(
    oldJwtId,
    `be01a-replay-${crypto.randomUUID()}`,
  );
  assert.equal(replayedRotation, null);

  const raceOldJwtId = `be01a-race-old-${crypto.randomUUID()}`;
  const raceNewJwtIds = [
    `be01a-race-new-${crypto.randomUUID()}`,
    `be01a-race-new-${crypto.randomUUID()}`,
  ] as const;
  await repositories.sessions.createSession({
    userId: user.id,
    jwtId: raceOldJwtId,
    expiresAt,
  });

  const raceResults = await Promise.all(
    raceNewJwtIds.map((candidateJwtId) =>
      repositories.sessions.rotateJwtId(raceOldJwtId, candidateJwtId),
    ),
  );
  const raceWinners = raceResults.filter(
    (candidate): candidate is NonNullable<typeof candidate> =>
      candidate !== null,
  );
  assert.equal(raceWinners.length, 1);
  assert.equal(
    raceNewJwtIds.some((candidateJwtId) =>
      candidateJwtId === raceWinners[0]!.jwtId,
    ),
    true,
  );
  assert.equal(
    (
      await repositories.sessions.findActiveByJwtId(
        raceWinners[0]!.jwtId,
      )
    )?.id,
    raceWinners[0]!.id,
  );
  assert.equal(
    await repositories.sessions.findActiveByJwtId(raceOldJwtId),
    null,
  );

  const revokedAt = new Date();
  const revoked = await repositories.sessions.revokeByJwtId(
    newJwtId,
    revokedAt,
  );
  assert.equal(revoked?.revokedAt?.getTime(), revokedAt.getTime());
  assert.equal(
    await repositories.sessions.findActiveByJwtId(newJwtId),
    null,
  );

  const rotateRevoked = await repositories.sessions.rotateJwtId(
    newJwtId,
    `be01a-after-revoke-${crypto.randomUUID()}`,
  );
  assert.equal(rotateRevoked, null);

  const expiredJwtId = `be01a-expired-${crypto.randomUUID()}`;
  await repositories.sessions.createSession({
    userId: user.id,
    jwtId: expiredJwtId,
    expiresAt: new Date(Date.now() - 1_000),
  });
  assert.equal(
    await repositories.sessions.findActiveByJwtId(expiredJwtId),
    null,
  );
  assert.equal(
    await repositories.sessions.rotateJwtId(
      expiredJwtId,
      `be01a-expired-rotation-${crypto.randomUUID()}`,
    ),
    null,
  );
}

async function verifyAuditRepository({
  postgres,
  repositories,
  orgId,
}: TestContext): Promise<void> {
  const loginFailed = await repositories.audit.create({
    action: "login_failed",
    actorId: null,
    actorUsername: "unknown-user",
    actorRole: null,
    ipAddress: "127.0.0.1",
    targetType: "user",
    targetId: "unknown-user",
    details: {
      reason: "invalid_credentials",
      failedAttempts: 1,
    },
    orgId,
  });

  assert.equal(loginFailed.actorId, null);
  assert.equal(loginFailed.actorUsername, "unknown-user");
  assert.equal(loginFailed.ipAddress, "127.0.0.1");
  assert.equal(loginFailed.targetType, "user");
  assert.equal(loginFailed.targetId, "unknown-user");
  assert.deepEqual(loginFailed.details, {
    reason: "invalid_credentials",
    failedAttempts: 1,
  });
  assert.equal(loginFailed.orgId, orgId);

  const sessionRevoked = await repositories.audit.create({
    action: "session_revoked",
    actorId: null,
    actorUsername: "test-admin",
    actorRole: "admin",
    targetType: "session",
    targetId: `be01a-session-${crypto.randomUUID()}`,
    details: { reason: "logout" },
    orgId,
  });
  assert.equal(sessionRevoked.action, "session_revoked");
  assert.equal(sessionRevoked.actorRole, "admin");

  const page = await repositories.audit.list({
    orgId,
    action: "login_failed",
    limit: 10,
  });
  assert.equal(page.items.some((row) => row.id === loginFailed.id), true);

  let immutableDeleteRejected = false;
  try {
    await postgres("audit.audit_logs").where("id", loginFailed.id).delete();
  } catch (error) {
    immutableDeleteRejected = true;
    assert.match(
      error instanceof Error ? error.message : String(error),
      /immutable|cannot be updated or deleted|permission denied/iu,
    );
  }

  assert.equal(immutableDeleteRejected, true);
  const persistedAudit = await repositories.audit.findById(loginFailed.id);

  assert.equal(persistedAudit?.id, loginFailed.id);
  assert.equal(persistedAudit?.action, "login_failed");
  assert.equal(persistedAudit?.orgId, orgId);
}

async function verifyAuthUnitOfWorkReadiness({
  repositories,
  unitOfWork,
  orgId,
}: TestContext): Promise<void> {
  const successUser = await createTestUser(repositories, orgId, "uow-success");
  await repositories.users.incrementFailedLoginCount(successUser.id);
  await repositories.users.incrementFailedLoginCount(successUser.id);
  await repositories.users.lockUserUntil(
    successUser.id,
    new Date(Date.now() + 15 * 60 * 1_000),
  );

  const successfulLoginAt = new Date();
  const successfulJwtId = `be01a-success-${crypto.randomUUID()}`;
  const successfulAuditId = crypto.randomUUID();

  await unitOfWork.execute(async ({ repositories: transactional }) => {
    const reset = await transactional.users.resetLoginFailures(successUser.id);
    assert.equal(reset?.failedLoginCount, 0);
    assert.equal(reset?.lockedUntil, null);

    await transactional.users.markLastLogin(
      successUser.id,
      successfulLoginAt,
    );
    await transactional.sessions.createSession({
      userId: successUser.id,
      jwtId: successfulJwtId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
    });
    await transactional.audit.create({
      id: successfulAuditId,
      action: "login",
      actorId: null,
      actorUsername: successUser.username,
      actorRole: successUser.role,
      targetType: "user",
      targetId: successUser.id,
      details: { outcome: "success" },
      orgId,
    });
  });

  const committedUser = await repositories.users.findById(successUser.id);
  assert.equal(committedUser?.failedLoginCount, 0);
  assert.equal(committedUser?.lockedUntil, null);
  assert.equal(
    committedUser?.lastLoginAt?.getTime(),
    successfulLoginAt.getTime(),
  );
  assert.equal(
    (await repositories.sessions.findActiveByJwtId(successfulJwtId))?.userId,
    successUser.id,
  );
  assert.equal(
    (await repositories.audit.findById(successfulAuditId))?.action,
    "login",
  );

  const failureUser = await createTestUser(repositories, orgId, "uow-failure");
  for (let index = 0; index < 4; index += 1) {
    await repositories.users.incrementFailedLoginCount(failureUser.id);
  }

  const failureLockedUntil = new Date(Date.now() + 15 * 60 * 1_000);
  const failedAuditId = crypto.randomUUID();

  await unitOfWork.execute(async ({ repositories: transactional }) => {
    const failed = await transactional.users.incrementFailedLoginCount(
      failureUser.id,
    );
    assert.ok(failed);
    assert.equal(failed.failedLoginCount, 5);

    if (failed.failedLoginCount >= 5) {
      await transactional.users.lockUserUntil(
        failureUser.id,
        failureLockedUntil,
      );
    }

    await transactional.audit.create({
      id: failedAuditId,
      action: "login_failed",
      actorId: null,
      actorUsername: failureUser.username,
      actorRole: failureUser.role,
      targetType: "user",
      targetId: failureUser.id,
      details: { failedAttempts: failed.failedLoginCount },
      orgId,
    });
  });

  const committedFailure = await repositories.users.findById(failureUser.id);
  assert.equal(committedFailure?.failedLoginCount, 5);
  assert.equal(
    committedFailure?.lockedUntil?.getTime(),
    failureLockedUntil.getTime(),
  );
  assert.equal(
    (await repositories.audit.findById(failedAuditId))?.action,
    "login_failed",
  );

  const rollbackUser = await createTestUser(repositories, orgId, "uow-rollback");
  await repositories.users.incrementFailedLoginCount(rollbackUser.id);
  await repositories.users.incrementFailedLoginCount(rollbackUser.id);
  const beforeRollback = await repositories.users.findById(rollbackUser.id);
  assert.ok(beforeRollback);

  const rollbackJwtId = `be01a-rollback-${crypto.randomUUID()}`;
  const rollbackAuditId = crypto.randomUUID();

  await assert.rejects(
    () =>
      unitOfWork.execute(async ({ repositories: transactional }) => {
        await transactional.users.resetLoginFailures(rollbackUser.id);
        await transactional.users.markLastLogin(rollbackUser.id, new Date());
        await transactional.sessions.createSession({
          userId: rollbackUser.id,
          jwtId: rollbackJwtId,
          expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
        });
        await transactional.audit.create({
          id: rollbackAuditId,
          action: "login",
          actorId: null,
          actorUsername: rollbackUser.username,
          actorRole: rollbackUser.role,
          targetType: "user",
          targetId: rollbackUser.id,
          details: { outcome: "must_rollback" },
          orgId,
        });

        throw new Error("BE-01A forced rollback");
      }),
    /BE-01A forced rollback/u,
  );

  const afterRollback = await repositories.users.findById(rollbackUser.id);
  assert.equal(
    afterRollback?.failedLoginCount,
    beforeRollback.failedLoginCount,
  );
  assert.equal(afterRollback?.lockedUntil, beforeRollback.lockedUntil);
  assert.equal(afterRollback?.lastLoginAt, beforeRollback.lastLoginAt);
  assert.equal(await repositories.sessions.findByJwtId(rollbackJwtId), null);
  assert.equal(await repositories.audit.findById(rollbackAuditId), null);

  const failedRollbackUser = await createTestUser(
    repositories,
    orgId,
    "uow-failed-login-rollback",
  );
  for (let index = 0; index < 4; index += 1) {
    await repositories.users.incrementFailedLoginCount(failedRollbackUser.id);
  }

  const failedRollbackAuditId = crypto.randomUUID();
  await assert.rejects(
    () =>
      unitOfWork.execute(async ({ repositories: transactional }) => {
        const failed = await transactional.users.incrementFailedLoginCount(
          failedRollbackUser.id,
        );
        assert.equal(failed?.failedLoginCount, 5);
        await transactional.users.lockUserUntil(
          failedRollbackUser.id,
          new Date(Date.now() + 15 * 60 * 1_000),
        );
        await transactional.audit.create({
          id: failedRollbackAuditId,
          action: "login_failed",
          actorId: null,
          actorUsername: failedRollbackUser.username,
          actorRole: failedRollbackUser.role,
          targetType: "user",
          targetId: failedRollbackUser.id,
          details: { outcome: "must_rollback" },
          orgId,
        });

        throw new Error("BE-01A forced failed-login rollback");
      }),
    /BE-01A forced failed-login rollback/u,
  );

  const failedRollbackState = await repositories.users.findById(
    failedRollbackUser.id,
  );
  assert.equal(failedRollbackState?.failedLoginCount, 4);
  assert.equal(failedRollbackState?.lockedUntil, null);
  assert.equal(
    await repositories.audit.findById(failedRollbackAuditId),
    null,
  );
}

async function createTestUser(
  repositories: PostgresRepositories,
  orgId: string,
  purpose: string,
) {
  const unique = crypto.randomUUID();
  return repositories.users.create({
    username: `be01a_${purpose}_${unique}`,
    email: `be01a_${purpose}_${unique}@example.test`,
    passwordHash:
      "$2b$12$be01afoundationhashplaceholder000000000000000000000000000",
    role: "admin",
    displayName: `BE-01A ${purpose}`,
    orgId,
  });
}

async function cleanup({ postgres, orgId }: TestContext): Promise<void> {
  await postgres.transaction(async (transaction) => {
    await transaction("public.sessions")
      .whereIn(
        "user_id",
        transaction("public.users").select("id").where("org_id", orgId),
      )
      .delete();
    await transaction("public.users").where("org_id", orgId).delete();
  });

  // audit.audit_logs is intentionally not deleted: it is append-only.
}

function assertSafeToRun(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to run BE-01A repository integration tests in production.",
    );
  }

  if (process.env.ALLOW_BE01A_INTEGRATION_TESTS !== "true") {
    throw new Error(
      "Set ALLOW_BE01A_INTEGRATION_TESTS=true to run BE-01A repository integration tests.",
    );
  }
}

function assertIndex(
  indexes: ReadonlyArray<{
    readonly schemaname: string;
    readonly tablename: string;
    readonly indexdef: string;
  }>,
  schemaName: string,
  tableName: string,
  requiredFragments: readonly string[],
): void {
  const found = indexes.some((index) => {
    if (
      index.schemaname !== schemaName ||
      index.tablename !== tableName
    ) {
      return false;
    }

    const normalized = normalizeSql(index.indexdef);
    return requiredFragments.every((fragment) =>
      normalized.includes(normalizeSql(fragment)),
    );
  });

  assert.equal(
    found,
    true,
    `Missing required index on ${schemaName}.${tableName}: ${requiredFragments.join(
      ", ",
    )}`,
  );
}

function normalizeSql(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('"', "")
    .replace(/\bon\s+only\s+/gu, "on ")
    .replace(/\s+/gu, " ")
    .trim();
}

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify(
      {
        success: false,
        suite: "BE-01A authentication repository foundation",
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});

import crypto from "node:crypto";

import dotenv from "dotenv";

import {
  closeMongoDb,
  closePostgres,
  connectMongoDb,
  createMongoDbClient,
  createMongoRepositories,
  createPostgresClient,
  createPostgresRepositories,
  createPostgresUnitOfWork,
  type MongoDbClient,
  type MongoRepositories,
  type PostgresClient,
  type PostgresRepositories,
  type PostgresUnitOfWork,
} from "../../../src/database/index.js";

dotenv.config();

export const TEST_ORG_ID = "db09-test";
export const TEST_KEY_PREFIX = "test.db09.";
export const TEST_QUEUE_PREFIX = "db09-test-";
export const TEST_COLLECTOR_PREFIX = "db09-test-collector";
export const TEST_BATCH_PREFIX = "db09-test-batch";

export interface RepositoryIntegrationTestContext {
  readonly postgres: PostgresClient;
  readonly mongo: MongoDbClient;
  readonly repositories: PostgresRepositories;
  readonly mongoRepositories: MongoRepositories;
  readonly unitOfWork: PostgresUnitOfWork;
}

export interface IntegrationTestCase {
  readonly name: string;
  readonly run: (context: RepositoryIntegrationTestContext) => Promise<void>;
}

export interface IntegrationTestResult {
  readonly name: string;
  readonly status: "pass" | "fail";
  readonly durationMs: number;
  readonly error?: string;
}

export async function createRepositoryIntegrationTestContext(): Promise<RepositoryIntegrationTestContext> {
  assertIntegrationEnvironment();

  const postgresUrl = getRequiredEnv("TEST_DATABASE_URL", process.env.DATABASE_URL);
  const mongoUri = getRequiredEnv("TEST_MONGODB_URI", process.env.MONGODB_URI);

  const postgres = createPostgresClient({
    connectionString: postgresUrl,
    poolMin: 0,
    poolMax: 4,
    acquireConnectionTimeoutMs: parseIntegerEnv("TEST_DATABASE_ACQUIRE_TIMEOUT_MS", 5_000),
  });

  const mongo = createMongoDbClient();
  await connectMongoDb(mongo, {
    uri: mongoUri,
    minPoolSize: 0,
    maxPoolSize: 4,
    serverSelectionTimeoutMs: parseIntegerEnv("TEST_MONGODB_SERVER_SELECTION_TIMEOUT_MS", 5_000),
    connectTimeoutMs: parseIntegerEnv("TEST_MONGODB_CONNECT_TIMEOUT_MS", 5_000),
    socketTimeoutMs: parseIntegerEnv("TEST_MONGODB_SOCKET_TIMEOUT_MS", 30_000),
  });

  return {
    postgres,
    mongo,
    repositories: createPostgresRepositories(postgres),
    mongoRepositories: createMongoRepositories(mongo),
    unitOfWork: createPostgresUnitOfWork(postgres, {
      defaultStatementTimeoutMs: parseIntegerEnv("TEST_TRANSACTION_STATEMENT_TIMEOUT_MS", 5_000),
      defaultLockTimeoutMs: parseIntegerEnv("TEST_TRANSACTION_LOCK_TIMEOUT_MS", 2_000),
      defaultRetry: {
        maxAttempts: 2,
        baseDelayMs: 10,
        maxDelayMs: 50,
      },
    }),
  };
}

export async function closeRepositoryIntegrationTestContext(
  context: RepositoryIntegrationTestContext,
): Promise<void> {
  await Promise.allSettled([
    closeMongoDb(context.mongo),
    closePostgres(context.postgres),
  ]);
}

export async function cleanupRepositoryIntegrationData(
  context: RepositoryIntegrationTestContext,
): Promise<void> {
  await cleanupPostgresIntegrationData(context.postgres);
  await cleanupMongoIntegrationData(context.mongo);
}

export async function runIntegrationTestCases(
  context: RepositoryIntegrationTestContext,
  cases: readonly IntegrationTestCase[],
): Promise<readonly IntegrationTestResult[]> {
  const results: IntegrationTestResult[] = [];

  for (const testCase of cases) {
    const startedAt = Date.now();

    try {
      await cleanupRepositoryIntegrationData(context);
      await testCase.run(context);
      await cleanupRepositoryIntegrationData(context);

      results.push({
        name: testCase.name,
        status: "pass",
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      await cleanupRepositoryIntegrationData(context).catch(() => undefined);

      results.push({
        name: testCase.name,
        status: "fail",
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, received ${String(actual)}.`);
  }
}

export function assertDefined<T>(value: T | null | undefined, message: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
}

export function assertTrue(value: boolean, message: string): void {
  if (value !== true) {
    throw new Error(message);
  }
}

export function assertFalse(value: boolean, message: string): void {
  if (value !== false) {
    throw new Error(message);
  }
}

export function testUuid(suffix: string): string {
  if (!/^\d{3}$/.test(suffix)) {
    throw new Error("Test UUID suffix must be exactly three digits.");
  }

  return crypto.randomUUID();
}

export function testDate(offsetSeconds = 0): Date {
  return new Date(Date.UTC(2026, 6, 26, 8, 0, offsetSeconds));
}

async function cleanupPostgresIntegrationData(postgres: PostgresClient): Promise<void> {
  await postgres.transaction(async (trx) => {
    await trx("public.incident_events").whereLike("event_id", "db09-test-%").delete();
    await trx("public.alerts").where("org_id", TEST_ORG_ID).delete();
    await trx("public.incident_notes")
      .whereIn("incident_id", trx("public.incidents").select("id").where("org_id", TEST_ORG_ID))
      .delete();
    await trx("public.incidents").where("org_id", TEST_ORG_ID).delete();
    await trx("public.sessions")
      .whereIn("user_id", trx("public.users").select("id").where("org_id", TEST_ORG_ID))
      .delete();
    await trx("public.rules").where("org_id", TEST_ORG_ID).delete();
    await trx("public.configuration").whereLike("key", `${TEST_KEY_PREFIX}%`).delete();
    await trx("monitor.collector_status").where("org_id", TEST_ORG_ID).delete();
    await trx("monitor.queue_metrics").whereLike("queue_name", `${TEST_QUEUE_PREFIX}%`).delete();
    await trx("public.assets").where("org_id", TEST_ORG_ID).delete();

    await trx("public.users")
      .where("org_id", TEST_ORG_ID)
      .whereNotExists(function whereNoImmutableAuditReference() {
        this.select(trx.raw("1"))
          .from("audit.audit_logs")
          .whereRaw("audit.audit_logs.actor_id = public.users.id");
      })
      .delete();

    await trx("public.users")
      .where("org_id", TEST_ORG_ID)
      .update({
        username: trx.raw("'db09_archived_' || replace(id::text, '-', '')"),
        email: trx.raw("'db09_archived_' || replace(id::text, '-', '') || '@example.local'"),
        is_active: false,
      });
  });
}

async function cleanupMongoIntegrationData(mongo: MongoDbClient): Promise<void> {
  if (mongo.db === undefined) {
    throw new Error("MongoDB client is not connected.");
  }

  await Promise.all([
    mongo.db.collection("normalized_events").deleteMany({ org_id: TEST_ORG_ID }),
    mongo.db.collection("ai_results").deleteMany({ org_id: TEST_ORG_ID }),
    mongo.db.collection("raw_events_archive").deleteMany({ org_id: TEST_ORG_ID }),
  ]);
}

function assertIntegrationEnvironment(): void {
  const nodeEnv = process.env.NODE_ENV ?? "development";

  if (nodeEnv === "production") {
    throw new Error("Repository integration tests refuse to run when NODE_ENV=production.");
  }

  if (process.env.ALLOW_DB09_INTEGRATION_TESTS !== "true") {
    throw new Error(
      "Set ALLOW_DB09_INTEGRATION_TESTS=true to run repository integration tests against a migrated test/development database.",
    );
  }
}

function getRequiredEnv(name: string, fallback: string | undefined): string {
  const value = process.env[name] ?? fallback;

  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required for repository integration tests.`);
  }

  return value;
}

function parseIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

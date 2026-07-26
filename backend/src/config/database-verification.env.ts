import "dotenv/config";

import path from "node:path";

import { z } from "zod";

import type { FullDatabaseVerificationConfig } from "../database/verification/verification.types.js";

const databaseVerificationEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  MIGRATION_DATABASE_URL: z.string().min(1).optional(),
  POSTGRES_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  POSTGRES_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  POSTGRES_RUNTIME_ROLE: z.string().trim().min(1).default("trivikrama_app"),
  DB_VERIFY_EXPECTED_CONFIGURATION_ENTRIES: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(28),
  DB_VERIFY_EXPECTED_BUILTIN_RULES: z.coerce.number().int().nonnegative().default(1),

  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_POOL_SIZE: z.coerce.number().int().positive().default(10),
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  MONGODB_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  MONGODB_SOCKET_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  REDIS_KEY_PREFIX: z.string().trim().min(1).default("trivikrama"),
  REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  REDIS_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(3_000),
  REDIS_MAX_RETRIES_PER_REQUEST: z.coerce.number().int().nonnegative().default(1),
  REDIS_VERIFY_SCAN_LIMIT: z.coerce.number().int().positive().max(10_000).default(1_000),
  REDIS_VERIFY_PUBSUB_TIMEOUT_MS: z.coerce.number().int().positive().default(3_000),
});

export function loadDatabaseVerificationConfig(
  backendRoot = process.cwd(),
): FullDatabaseVerificationConfig {
  const parsed = databaseVerificationEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    throw new Error(
      `Database verification environment validation failed: ${JSON.stringify(
        parsed.error.format(),
      )}`,
    );
  }

  const env = parsed.data;

  return {
    nodeEnv: env.NODE_ENV,
    postgres: {
      nodeEnv: env.NODE_ENV,
      connectionString: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL,
      migrationsDirectory: path.join(backendRoot, "migrations", "postgres"),
      connectionTimeoutMs: env.POSTGRES_CONNECTION_TIMEOUT_MS,
      statementTimeoutMs: env.POSTGRES_QUERY_TIMEOUT_MS,
      runtimeRole: env.POSTGRES_RUNTIME_ROLE,
      expectedConfigurationEntries: env.DB_VERIFY_EXPECTED_CONFIGURATION_ENTRIES,
      expectedBuiltinRules: env.DB_VERIFY_EXPECTED_BUILTIN_RULES,
    },
    mongo: {
      uri: env.MONGODB_URI,
      poolSize: env.MONGODB_POOL_SIZE,
      serverSelectionTimeoutMs: env.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
      connectTimeoutMs: env.MONGODB_CONNECT_TIMEOUT_MS,
      socketTimeoutMs: env.MONGODB_SOCKET_TIMEOUT_MS,
    },
    redis: {
      url: env.REDIS_URL,
      keyPrefix: normalizeRedisKeyPrefix(env.REDIS_KEY_PREFIX),
      connectTimeoutMs: env.REDIS_CONNECT_TIMEOUT_MS,
      commandTimeoutMs: env.REDIS_COMMAND_TIMEOUT_MS,
      maxRetriesPerRequest: env.REDIS_MAX_RETRIES_PER_REQUEST,
      scanLimit: env.REDIS_VERIFY_SCAN_LIMIT,
      pubSubTimeoutMs: env.REDIS_VERIFY_PUBSUB_TIMEOUT_MS,
    },
  };
}

function normalizeRedisKeyPrefix(value: string): string {
  return value.replace(/:+$/u, "");
}

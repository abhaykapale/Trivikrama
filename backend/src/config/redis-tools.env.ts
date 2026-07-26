import "dotenv/config";

import { z } from "zod";

const redisToolsEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  REDIS_KEY_PREFIX: z
    .string()
    .trim()
    .min(1, "REDIS_KEY_PREFIX cannot be empty")
    .default("trivikrama"),
  REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  REDIS_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(3_000),
  REDIS_MAX_RETRIES_PER_REQUEST: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(1),
  REDIS_VERIFY_SCAN_LIMIT: z.coerce.number().int().positive().max(10_000).default(1_000),
  REDIS_VERIFY_PUBSUB_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(3_000),
});

export interface RedisToolsConfig {
  readonly nodeEnv: "development" | "production" | "test";
  readonly redis: {
    readonly url: string;
    readonly keyPrefix: string;
    readonly connectTimeoutMs: number;
    readonly commandTimeoutMs: number;
    readonly maxRetriesPerRequest: number;
    readonly scanLimit: number;
    readonly pubSubTimeoutMs: number;
  };
}

export function loadRedisToolsConfig(): RedisToolsConfig {
  const parsed = redisToolsEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    throw new Error(
      `Redis tool environment validation failed: ${JSON.stringify(
        parsed.error.format(),
      )}`,
    );
  }

  const env = parsed.data;

  return {
    nodeEnv: env.NODE_ENV,
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

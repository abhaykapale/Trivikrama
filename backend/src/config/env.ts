import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  API_PREFIX: z.string().default("/api/v1"),

  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TOKEN_EXPIRY: z.string().default("1h"),
  JWT_MAX_SESSION_DURATION: z.string().default("7d"),

  DATABASE_URL: z.string().min(1),
  POSTGRES_POOL_MIN: z.coerce.number().int().nonnegative().default(2),
  POSTGRES_POOL_MAX: z.coerce.number().int().positive().default(10),
  POSTGRES_CONNECTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5000),
  POSTGRES_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  MONGODB_URI: z.string().min(1),
  MONGODB_POOL_SIZE: z.coerce.number().int().positive().default(10),
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5000),

  REDIS_URL: z.string().min(1),
  REDIS_KEY_PREFIX: z.string().default("trivikrama"),

  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  COLLECTOR_DIR: z.string().default("./collector"),
  COLLECTOR_HMAC_SECRET: z.string().min(32),

  AI_ENGINE_URL: z.string().url().default("http://localhost:8000"),
  AI_TIMEOUT: z.coerce.number().int().positive().default(5000),
  AI_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  AI_THRESHOLD: z.coerce.number().min(0).max(1).default(0.65),

  FRONTEND_URL: z.string().url().default("http://localhost:3001"),

  LOG_LEVEL: z
    .enum(["error", "warn", "info", "http", "verbose", "debug", "silly"])
    .default("debug"),
  LOG_FORMAT: z.enum(["pretty", "json"]).default("pretty"),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  // The application logger cannot be used here because it depends on config.
  console.error(
    "Environment validation failed:",
    JSON.stringify(parsedEnv.error.format(), null, 2),
  );

  process.exit(1);
}

const env = parsedEnv.data;

if (env.POSTGRES_POOL_MIN > env.POSTGRES_POOL_MAX) {
  console.error(
    "Environment validation failed: POSTGRES_POOL_MIN cannot exceed POSTGRES_POOL_MAX.",
  );

  process.exit(1);
}

const config = {
  server: {
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    apiPrefix: env.API_PREFIX,
  },

  database: {
    DATABASE_URL: env.DATABASE_URL,
    MONGODB_URI: env.MONGODB_URI,
    REDIS_URL: env.REDIS_URL,

    postgres: {
      poolMin: env.POSTGRES_POOL_MIN,
      poolMax: env.POSTGRES_POOL_MAX,
      connectionTimeoutMs: env.POSTGRES_CONNECTION_TIMEOUT_MS,
      queryTimeoutMs: env.POSTGRES_QUERY_TIMEOUT_MS,
    },

    mongodb: {
      poolSize: env.MONGODB_POOL_SIZE,
      serverSelectionTimeoutMs: env.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
    },

    redis: {
      keyPrefix: env.REDIS_KEY_PREFIX,
    },
  },

  jwt: {
    secret: env.JWT_SECRET,
    accessTokenExpiry: env.JWT_ACCESS_TOKEN_EXPIRY,
    maxSessionDuration: env.JWT_MAX_SESSION_DURATION,
  },

  security: {
    bcryptSaltRounds: env.BCRYPT_SALT_ROUNDS,
    collectorHmacSecret: env.COLLECTOR_HMAC_SECRET,
  },

  collector: {
    directory: env.COLLECTOR_DIR,
  },

  ai: {
    engineUrl: env.AI_ENGINE_URL,
    timeoutMs: env.AI_TIMEOUT,
    batchSize: env.AI_BATCH_SIZE,
    threshold: env.AI_THRESHOLD,
  },

  frontend: {
    url: env.FRONTEND_URL,
  },

  logging: {
    level: env.LOG_LEVEL,
    format: env.LOG_FORMAT,
  },
} as const;

export default config;

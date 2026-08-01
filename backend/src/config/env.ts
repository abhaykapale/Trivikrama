import "dotenv/config";
import { z } from "zod";

const durationSchema = z
  .string()
  .trim()
  .regex(
    /^[1-9]\d*(?:s|m|h|d)$/u,
    "must be a positive duration using s, m, h, or d (for example: 5m or 1h)",
  );

const booleanEnvironmentSchema = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized === "true") {
      return true;
    }

    if (normalized === "false") {
      return false;
    }
  }

  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  API_PREFIX: z.string().trim().min(1).default("/api/v1"),

  JWT_SECRET: z.string().trim().min(1, "is required"),
  JWT_ACCESS_TOKEN_EXPIRY: durationSchema.default("1h"),
  JWT_REFRESH_WINDOW: durationSchema.default("5m"),
  JWT_MAX_SESSION_DURATION: durationSchema.default("7d"),
  JWT_ISSUER: z.literal("ai-siem").default("ai-siem"),
  JWT_COOKIE_NAME: z.literal("siem_token").default("siem_token"),
  JWT_COOKIE_SECURE: booleanEnvironmentSchema.default(false),
  BCRYPT_ROUNDS: z.coerce.number().int().min(12).max(15).default(12),
  AUTH_LOCKOUT_ATTEMPTS: z.coerce.number().int().positive().default(5),
  AUTH_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce
    .number()
    .int()
    .positive()
    .default(10),

  DATABASE_URL: z.string().trim().min(1),
  POSTGRES_POOL_MIN: z.coerce.number().int().nonnegative().default(2),
  POSTGRES_POOL_MAX: z.coerce.number().int().positive().default(10),
  POSTGRES_CONNECTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5000),
  POSTGRES_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  MONGODB_URI: z.string().trim().min(1),
  MONGODB_POOL_SIZE: z.coerce.number().int().positive().default(10),
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5000),

  REDIS_URL: z.string().trim().min(1),
  REDIS_KEY_PREFIX: z.string().trim().min(1).default("trivikrama"),

  COLLECTOR_DIR: z.string().trim().min(1).default("./collector"),
  COLLECTOR_HMAC_SECRET: z.string().trim().min(32),

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

export class EnvironmentConfigurationError extends Error {
  public constructor(readonly violations: readonly string[]) {
    super(`Environment validation failed: ${violations.join("; ")}`);
    this.name = "EnvironmentConfigurationError";
  }
}

export function loadEnvironmentConfig(
  source: NodeJS.ProcessEnv = process.env,
) {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    throw new EnvironmentConfigurationError(
      parsed.error.issues.map(formatValidationIssue),
    );
  }

  const env = parsed.data;
  const violations: string[] = [];

  if (env.POSTGRES_POOL_MIN > env.POSTGRES_POOL_MAX) {
    violations.push(
      "POSTGRES_POOL_MIN cannot exceed POSTGRES_POOL_MAX",
    );
  }

  if (env.JWT_SECRET.length < 64) {
    violations.push("JWT_SECRET must be at least 64 characters long");
  }

  if (isPlaceholderSecret(env.JWT_SECRET)) {
    violations.push("JWT_SECRET must not contain a placeholder value");
  }

  if (env.NODE_ENV === "production" && env.JWT_COOKIE_SECURE !== true) {
    violations.push("JWT_COOKIE_SECURE must be true in production");
  }

  if (
    env.NODE_ENV === "production" &&
    !hasExplicitProductionCorsOrigin(source.FRONTEND_URL)
  ) {
    violations.push(
      "FRONTEND_URL must be an explicit CORS origin in production",
    );
  }

  if (violations.length > 0) {
    throw new EnvironmentConfigurationError(violations);
  }

  return {
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
      algorithm: "HS256" as const,
      secret: env.JWT_SECRET,
      accessTokenExpiry: env.JWT_ACCESS_TOKEN_EXPIRY,
      refreshWindow: env.JWT_REFRESH_WINDOW,
      maxSessionDuration: env.JWT_MAX_SESSION_DURATION,
      issuer: env.JWT_ISSUER,
      cookie: {
        name: env.JWT_COOKIE_NAME,
        httpOnly: true as const,
        secure: env.JWT_COOKIE_SECURE,
        sameSite: "strict" as const,
      },
    },

    auth: {
      bcryptRounds: env.BCRYPT_ROUNDS,
      lockoutAttempts: env.AUTH_LOCKOUT_ATTEMPTS,
      lockoutMinutes: env.AUTH_LOCKOUT_MINUTES,
      rateLimitPerMinute: env.AUTH_RATE_LIMIT_PER_MINUTE,
    },

    security: {
      // Backward-compatible read model; BCRYPT_ROUNDS is the single source.
      bcryptSaltRounds: env.BCRYPT_ROUNDS,
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
}

function formatValidationIssue(issue: { readonly path: readonly PropertyKey[]; readonly message: string }): string {
  const path =
    issue.path.length > 0
      ? issue.path.map((segment) => String(segment)).join(".")
      : "environment";
  return `${path} ${issue.message}`;
}

function isPlaceholderSecret(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  const alphanumeric = normalized.replace(/[^a-z0-9]/gu, "");

  return (
    /^\*+$/u.test(normalized) ||
    /^x+$/u.test(normalized) ||
    alphanumeric.startsWith("changeme") ||
    alphanumeric.startsWith("replaceme") ||
    alphanumeric.startsWith("yourjwtsecret") ||
    alphanumeric.includes("placeholder") ||
    alphanumeric.startsWith("devonlysecret")
  );
}

function hasExplicitProductionCorsOrigin(value: string | undefined): boolean {
  if (value === undefined || value.trim().length === 0 || value.trim() === "*") {
    return false;
  }

  try {
    const parsed = new URL(value.trim());
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.origin !== "null" &&
      parsed.username.length === 0 &&
      parsed.password.length === 0 &&
      parsed.pathname === "/" &&
      parsed.search.length === 0 &&
      parsed.hash.length === 0
    );
  } catch {
    return false;
  }
}

const config = loadEnvironmentConfig();

export type AppConfig = ReturnType<typeof loadEnvironmentConfig>;

export default config;

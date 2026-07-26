export type DatabaseVerificationCommand = "status" | "verify";

export type DatabaseComponentName = "postgresql" | "mongodb" | "redis";

export type DatabaseVerificationCheckStatus = "pass" | "warn" | "fail";

export interface DatabaseVerificationCheck {
  readonly name: string;
  readonly status: DatabaseVerificationCheckStatus;
  readonly message: string;
  readonly latencyMs?: number;
  readonly details?: Record<string, unknown>;
}

export interface DatabaseComponentVerificationResult {
  readonly component: DatabaseComponentName;
  readonly success: boolean;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly checks: readonly DatabaseVerificationCheck[];
  readonly summary?: Record<string, unknown>;
}

export interface DatabaseVerificationTotals {
  readonly components: number;
  readonly checks: number;
  readonly passed: number;
  readonly warnings: number;
  readonly failed: number;
}

export interface FullDatabaseVerificationResult {
  readonly command: DatabaseVerificationCommand;
  readonly nodeEnv: "development" | "production" | "test";
  readonly success: boolean;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly totals: DatabaseVerificationTotals;
  readonly components: readonly DatabaseComponentVerificationResult[];
}

export interface PostgresVerificationConfig {
  readonly nodeEnv: "development" | "production" | "test";
  readonly connectionString: string;
  readonly migrationsDirectory: string;
  readonly connectionTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly runtimeRole: string;
  readonly expectedConfigurationEntries: number;
  readonly expectedBuiltinRules: number;
}

export interface MongoVerificationConfig {
  readonly uri: string;
  readonly poolSize: number;
  readonly serverSelectionTimeoutMs: number;
  readonly connectTimeoutMs: number;
  readonly socketTimeoutMs: number;
}

export interface RedisVerifierConfig {
  readonly url: string;
  readonly keyPrefix: string;
  readonly connectTimeoutMs: number;
  readonly commandTimeoutMs: number;
  readonly maxRetriesPerRequest: number;
  readonly scanLimit: number;
  readonly pubSubTimeoutMs: number;
}

export interface FullDatabaseVerificationConfig {
  readonly nodeEnv: "development" | "production" | "test";
  readonly postgres: PostgresVerificationConfig;
  readonly mongo: MongoVerificationConfig;
  readonly redis: RedisVerifierConfig;
}

export type RedisVerificationCommand = "status" | "verify";

export type RedisCheckStatus = "pass" | "warn" | "fail";

export interface RedisVerificationConfig {
  readonly nodeEnv: "development" | "production" | "test";
  readonly url: string;
  readonly keyPrefix: string;
  readonly connectTimeoutMs: number;
  readonly commandTimeoutMs: number;
  readonly maxRetriesPerRequest: number;
  readonly scanLimit: number;
  readonly pubSubTimeoutMs: number;
}

export interface RedisCheckResult {
  readonly name: string;
  readonly status: RedisCheckStatus;
  readonly message: string;
  readonly latencyMs?: number;
  readonly details?: Record<string, unknown>;
}

export interface RedisKeyPatternStatus {
  readonly name: string;
  readonly pattern: string;
  readonly sampledKeys: number;
  readonly scanComplete: boolean;
}

export interface RedisRuntimeInfo {
  readonly url: string;
  readonly database: number | null;
  readonly keyPrefix: string;
  readonly serverVersion?: string;
  readonly role?: string;
  readonly connectedClients?: number;
  readonly usedMemoryHuman?: string;
  readonly maxMemoryPolicy?: string;
  readonly appendOnly?: string;
}

export interface RedisVerificationResult {
  readonly command: RedisVerificationCommand;
  readonly nodeEnv: "development" | "production" | "test";
  readonly success: boolean;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly redis: RedisRuntimeInfo;
  readonly checks: readonly RedisCheckResult[];
  readonly keyspace: readonly RedisKeyPatternStatus[];
}

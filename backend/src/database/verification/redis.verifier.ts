import { performance } from "node:perf_hooks";

import { runRedisVerification } from "../redis/verification.js";
import type {
  DatabaseComponentVerificationResult,
  DatabaseVerificationCheck,
  DatabaseVerificationCommand,
  RedisVerifierConfig,
} from "./verification.types.js";

export async function verifyRedis(
  command: DatabaseVerificationCommand,
  nodeEnv: "development" | "production" | "test",
  config: RedisVerifierConfig,
): Promise<DatabaseComponentVerificationResult> {
  const startedAtDate = new Date();
  const startedAt = performance.now();

  const result = await runRedisVerification(command, {
    nodeEnv,
    url: config.url,
    keyPrefix: config.keyPrefix,
    connectTimeoutMs: config.connectTimeoutMs,
    commandTimeoutMs: config.commandTimeoutMs,
    maxRetriesPerRequest: config.maxRetriesPerRequest,
    scanLimit: config.scanLimit,
    pubSubTimeoutMs: config.pubSubTimeoutMs,
  });

  const checks: DatabaseVerificationCheck[] = result.checks.map((check) => ({
    name: check.name,
    status: check.status,
    message: check.message,
    latencyMs: check.latencyMs,
    details: check.details,
  }));

  const finishedAt = new Date();

  return {
    component: "redis",
    success: result.success,
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    checks,
    summary: {
      database: result.redis.database,
      keyPrefix: result.redis.keyPrefix,
      serverVersion: result.redis.serverVersion,
      role: result.redis.role,
      keyPatternsSampled: result.keyspace.length,
    },
  };
}

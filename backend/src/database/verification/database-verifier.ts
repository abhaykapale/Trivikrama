import { performance } from "node:perf_hooks";

import { verifyMongoDb } from "./mongodb.verifier.js";
import { verifyPostgres } from "./postgres.verifier.js";
import { verifyRedis } from "./redis.verifier.js";
import type {
  DatabaseComponentVerificationResult,
  DatabaseVerificationCheckStatus,
  DatabaseVerificationCommand,
  DatabaseVerificationTotals,
  FullDatabaseVerificationConfig,
  FullDatabaseVerificationResult,
} from "./verification.types.js";

export async function runFullDatabaseVerification(
  command: DatabaseVerificationCommand,
  config: FullDatabaseVerificationConfig,
): Promise<FullDatabaseVerificationResult> {
  const startedAtDate = new Date();
  const startedAt = performance.now();

  const components = await Promise.all([
    verifyPostgres(config.postgres),
    verifyMongoDb(config.mongo),
    verifyRedis(command, config.nodeEnv, config.redis),
  ]);
  const totals = computeTotals(components);
  const finishedAt = new Date();

  return {
    command,
    nodeEnv: config.nodeEnv,
    success: totals.failed === 0,
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    totals,
    components,
  };
}

function computeTotals(
  components: readonly DatabaseComponentVerificationResult[],
): DatabaseVerificationTotals {
  const counts: Record<DatabaseVerificationCheckStatus, number> = {
    pass: 0,
    warn: 0,
    fail: 0,
  };

  for (const component of components) {
    for (const check of component.checks) {
      counts[check.status] += 1;
    }
  }

  return {
    components: components.length,
    checks: counts.pass + counts.warn + counts.fail,
    passed: counts.pass,
    warnings: counts.warn,
    failed: counts.fail,
  };
}

import {
  pingMongoDb,
  type MongoDbClient,
} from "./mongodb/index.js";
import {
  pingPostgres,
  type PostgresClient,
} from "./postgres/index.js";
import {
  pingRedis,
  type RedisClient,
} from "./redis/index.js";

export type DatabaseConnectionStatus = "connected" | "disconnected";

export interface DatabaseHealthCheck {
  readonly status: DatabaseConnectionStatus;
  readonly latencyMs: number | null;
}

export interface DatabaseHealthReport {
  readonly status: "healthy" | "unhealthy";
  readonly checks: {
    readonly postgres: DatabaseHealthCheck;
    readonly mongodb: DatabaseHealthCheck;
    readonly redis: DatabaseHealthCheck;
  };
}

export interface DatabaseHealthClients {
  readonly postgres: PostgresClient;
  readonly mongodb: MongoDbClient;
  readonly redis: RedisClient;
}

const DEFAULT_HEALTH_TIMEOUT_MS = 2_000;

/**
 * Runs independent, real round trips to all three stores.
 *
 * The function never throws. A health endpoint should return an unhealthy
 * report rather than converting an infrastructure outage into an unhandled 500.
 */
export async function checkDatabaseHealth(
  clients: DatabaseHealthClients,
  timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
): Promise<DatabaseHealthReport> {
  const [postgres, mongodb, redis] = await Promise.all([
    runCheck(() => pingPostgres(clients.postgres), timeoutMs),
    runCheck(() => pingMongoDb(clients.mongodb), timeoutMs),
    runCheck(() => pingRedis(clients.redis), timeoutMs),
  ]);

  const healthy = [postgres, mongodb, redis].every(
    (check) => check.status === "connected",
  );

  return {
    status: healthy ? "healthy" : "unhealthy",
    checks: {
      postgres,
      mongodb,
      redis,
    },
  };
}

async function runCheck(
  check: () => Promise<number>,
  timeoutMs: number,
): Promise<DatabaseHealthCheck> {
  try {
    const latencyMs = await withTimeout(check(), timeoutMs);

    return {
      status: "connected",
      latencyMs,
    };
  } catch {
    // Do not include driver messages here. Connection errors can contain host
    // names or connection details that should not be returned by the API.
    return {
      status: "disconnected",
      latencyMs: null,
    };
  }
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Database health check timed out")),
          timeoutMs,
        );
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

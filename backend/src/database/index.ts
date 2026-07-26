import {
  closeMongoDb,
  connectMongoDb,
  createMongoDbClient,
  type MongoDbClient,
  type MongoDbClientOptions,
} from "./mongodb/index.js";
import {
  closePostgres,
  createPostgresClient,
  pingPostgres,
  type PostgresClient,
  type PostgresClientOptions,
} from "./postgres/index.js";
import {
  closeRedis,
  connectRedis,
  createRedisClient,
  type RedisClient,
  type RedisClientOptions,
} from "./redis/index.js";

export * from "./health.js";
export * from "./maintenance/index.js";
export * from "./mongodb/index.js";
export * from "./postgres/index.js";
export * from "./redis/index.js";
export * from "./repositories/index.js";
export * from "./transactions/index.js";

export type DatabaseName = "postgres" | "mongodb" | "redis";

export interface DatabaseConfig {
  readonly postgres: PostgresClientOptions;
  readonly mongodb: MongoDbClientOptions;
  readonly redis: RedisClientOptions;
  readonly startupTimeoutMs?: number;
}

export interface DatabaseClients {
  readonly postgres: PostgresClient;
  readonly mongodb: MongoDbClient;
  readonly redis: RedisClient;
}

export interface DatabaseShutdownResult {
  readonly closed: readonly DatabaseName[];
  readonly failed: readonly DatabaseName[];
}

const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;

/**
 * Creates and verifies all database clients before the HTTP server starts.
 *
 * Startup checks run concurrently, but Promise.allSettled waits for every
 * attempt so partially opened clients can be closed deterministically.
 */
export async function initializeDatabases(
  config: DatabaseConfig,
): Promise<DatabaseClients> {
  const clients: DatabaseClients = {
    postgres: createPostgresClient(config.postgres),
    mongodb: createMongoDbClient(),
    redis: createRedisClient(config.redis),
  };

  const startupTimeoutMs =
    config.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;

  const operations: ReadonlyArray<{
    readonly name: DatabaseName;
    readonly operation: Promise<unknown>;
  }> = [
    {
      name: "postgres",
      operation: withTimeout(
        pingPostgres(clients.postgres),
        startupTimeoutMs,
        "postgres startup",
      ),
    },
    {
      name: "mongodb",
      operation: withTimeout(
        connectMongoDb(clients.mongodb, config.mongodb),
        startupTimeoutMs,
        "mongodb startup",
      ),
    },
    {
      name: "redis",
      operation: withTimeout(
        connectRedis(clients.redis),
        startupTimeoutMs,
        "redis startup",
      ),
    },
  ];

  const results = await Promise.allSettled(
    operations.map(({ operation }) => operation),
  );

  const failures = results.flatMap((result, index) => {
    if (result.status !== "rejected") {
      return [];
    }

    return [
      {
        name: operations[index]!.name,
        reason: result.reason,
      },
    ];
  });

  if (failures.length > 0) {
    await closeDatabases(clients);

    const failureMessage = failures
      .map(({ name, reason }) => {
        const message =
          reason instanceof Error ? reason.message : String(reason);

        return `${name}: ${message}`;
      })
      .join("; ");

    throw new Error(`Database startup failed: ${failureMessage}`);
  }

  return clients;
}

/**
 * Best-effort shutdown. Every client receives a close request even when another
 * close operation fails.
 */
/**
*/
export async function closeDatabases(
  clients: DatabaseClients,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
): Promise<DatabaseShutdownResult> {
  const operations: ReadonlyArray<{
    readonly name: DatabaseName;
    readonly operation: Promise<void>;
  }> = [
    {
      name: "redis",
      operation: withTimeout(
        closeRedis(clients.redis),
        timeoutMs,
        "redis shutdown",
      ),
    },
    {
      name: "mongodb",
      operation: withTimeout(
        closeMongoDb(clients.mongodb),
        timeoutMs,
        "mongodb shutdown",
      ),
    },
    {
      name: "postgres",
      operation: withTimeout(
        closePostgres(clients.postgres),
        timeoutMs,
        "postgres shutdown",
      ),
    },
  ];

  const results = await Promise.allSettled(
    operations.map(({ operation }) => operation),
  );

  const closed: DatabaseName[] = [];
  const failed: DatabaseName[] = [];

  results.forEach((result, index) => {
    const name = operations[index]!.name;

    if (result.status === "fulfilled") {
      closed.push(name);
    } else {
      failed.push(name);
    }
  });

  return {
    closed,
    failed,
  };
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  operationName: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${operationName} timed out`)),
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

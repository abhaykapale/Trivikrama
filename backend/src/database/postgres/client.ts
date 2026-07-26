import { performance } from "node:perf_hooks";

import { knex, type Knex } from "knex";

export type PostgresClient = Knex;

export interface PostgresClientOptions {
  readonly connectionString: string;
  readonly poolMin?: number;
  readonly poolMax?: number;
  readonly acquireConnectionTimeoutMs?: number;
  readonly applicationName?: string;
}

const DEFAULT_POOL_MIN = 0;
const DEFAULT_POOL_MAX = 10;
const DEFAULT_ACQUIRE_CONNECTION_TIMEOUT_MS = 5_000;

/**
 * Creates the single Knex instance used by one backend process.
 *
 * Knex creates its PostgreSQL pool lazily. The first real query is executed by
 * pingPostgres(), which is why application startup must call that function
 * before the HTTP server starts accepting traffic.
 */
export function createPostgresClient(
  options: PostgresClientOptions,
): PostgresClient {
  validateOptions(options);

  return knex({
    client: "pg",
    connection: {
      connectionString: options.connectionString,
      application_name: options.applicationName,
    },
    pool: {
      min: options.poolMin ?? DEFAULT_POOL_MIN,
      max: options.poolMax ?? DEFAULT_POOL_MAX,
    },
    acquireConnectionTimeout:
      options.acquireConnectionTimeoutMs ??
      DEFAULT_ACQUIRE_CONNECTION_TIMEOUT_MS,
  });
}

/**
 * Executes a real database round trip and returns its latency.
 */
export async function pingPostgres(client: PostgresClient): Promise<number> {
  const startedAt = performance.now();

  await client.raw("select 1 as health_check");

  return Math.max(0, Math.round(performance.now() - startedAt));
}

/**
 * Drains and destroys the Knex connection pool.
 */
export async function closePostgres(client: PostgresClient): Promise<void> {
  await client.destroy();
}

function validateOptions(options: PostgresClientOptions): void {
  if (options.connectionString.trim().length === 0) {
    throw new Error("PostgreSQL connection string is required");
  }

  const min = options.poolMin ?? DEFAULT_POOL_MIN;
  const max = options.poolMax ?? DEFAULT_POOL_MAX;

  if (!Number.isInteger(min) || min < 0) {
    throw new Error("PostgreSQL poolMin must be a non-negative integer");
  }

  if (!Number.isInteger(max) || max < 1) {
    throw new Error("PostgreSQL poolMax must be a positive integer");
  }

  if (min > max) {
    throw new Error("PostgreSQL poolMin cannot exceed poolMax");
  }
}

import { performance } from "node:perf_hooks";

import { Redis, type RedisOptions } from "ioredis";

export type RedisClient = Redis;

export interface RedisClientOptions {
  readonly url: string;
  readonly connectTimeoutMs?: number;
  readonly commandTimeoutMs?: number;
  readonly maxRetriesPerRequest?: number;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_RETRIES_PER_REQUEST = 1;
const MAX_RECONNECT_DELAY_MS = 2_000;

/**
 * Creates the base Redis client used for cache, health, and lightweight state.
 *
 * BullMQ workers should create their own dedicated Redis connections through
 * the ingestion infrastructure because BullMQ has different retry semantics.
 */
export function createRedisClient(
  options: RedisClientOptions,
): RedisClient {
  validateOptions(options);

  const redisOptions: RedisOptions = {
    lazyConnect: true,
    enableReadyCheck: true,
    connectTimeout:
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    commandTimeout:
      options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
    maxRetriesPerRequest:
      options.maxRetriesPerRequest ?? DEFAULT_MAX_RETRIES_PER_REQUEST,
    retryStrategy(attempt: number): number {
      return Math.min(attempt * 100, MAX_RECONNECT_DELAY_MS);
    },
  };

  const client = new Redis(options.url, redisOptions);

  // Prevent an unhandled EventEmitter "error" event before the application
  // logger is attached. Startup and health failures are still returned through
  // connectRedis() and pingRedis().
  client.on("error", () => undefined);

  return client;
}

/**
 * Explicitly connects the lazy Redis client and verifies it with PING.
 */
export async function connectRedis(client: RedisClient): Promise<void> {
  if (client.status === "wait") {
    await client.connect();
  }

  await pingRedis(client);
}

/**
 * Executes a real Redis PING and returns its latency.
 */
export async function pingRedis(client: RedisClient): Promise<number> {
  const startedAt = performance.now();
  const response = await client.ping();

  if (response !== "PONG") {
    throw new Error("Redis returned an unexpected PING response");
  }

  return Math.max(0, Math.round(performance.now() - startedAt));
}

/**
 * Attempts a graceful QUIT when Redis is ready, otherwise force-closes the
 * socket so shutdown cannot hang indefinitely.
 */
export async function closeRedis(client: RedisClient): Promise<void> {
  if (client.status === "end") {
    return;
  }

  if (client.status === "ready") {
    try {
      await client.quit();
      return;
    } catch {
      // Fall through to a forced disconnect. Shutdown should continue even if
      // Redis disappeared between the status check and QUIT.
    }
  }

  client.disconnect();
}

function validateOptions(options: RedisClientOptions): void {
  if (options.url.trim().length === 0) {
    throw new Error("Redis URL is required");
  }

  const maxRetries =
    options.maxRetriesPerRequest ?? DEFAULT_MAX_RETRIES_PER_REQUEST;

  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new Error("Redis maxRetriesPerRequest must be a non-negative integer");
  }
}

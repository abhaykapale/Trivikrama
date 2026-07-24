import { performance } from "node:perf_hooks";

import mongoose, { type Connection, type ConnectOptions } from "mongoose";

export type MongoDbClient = Connection;

export interface MongoDbClientOptions {
  readonly uri: string;
  readonly minPoolSize?: number;
  readonly maxPoolSize?: number;
  readonly serverSelectionTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  readonly socketTimeoutMs?: number;
}

const DEFAULT_MIN_POOL_SIZE = 0;
const DEFAULT_MAX_POOL_SIZE = 10;
const DEFAULT_SERVER_SELECTION_TIMEOUT_MS = 5_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_SOCKET_TIMEOUT_MS = 30_000;

/**
 * Creates a disconnected, connection-scoped Mongoose client.
 *
 * Models should be registered on this connection instead of Mongoose's global
 * default connection. That keeps infrastructure ownership explicit and makes
 * tests easier to isolate.
 */
export function createMongoDbClient(): MongoDbClient {
  const client = mongoose.createConnection();

  // Prevent an unhandled EventEmitter "error" event before the application
  // logger is attached. Startup and health failures are still returned through
  // connectMongoDb() and pingMongoDb().
  client.on("error", () => undefined);

  return client;
}

/**
 * Opens the MongoDB connection and verifies it with an admin ping.
 */
export async function connectMongoDb(
  client: MongoDbClient,
  options: MongoDbClientOptions,
): Promise<void> {
  validateOptions(options);

  if (client.readyState === 1) {
    await pingMongoDb(client);
    return;
  }

  if (client.readyState !== 0) {
    throw new Error("MongoDB client is already connecting or closing");
  }

  const connectOptions: ConnectOptions = {
    minPoolSize: options.minPoolSize ?? DEFAULT_MIN_POOL_SIZE,
    maxPoolSize: options.maxPoolSize ?? DEFAULT_MAX_POOL_SIZE,
    serverSelectionTimeoutMS:
      options.serverSelectionTimeoutMs ??
      DEFAULT_SERVER_SELECTION_TIMEOUT_MS,
    connectTimeoutMS:
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
    socketTimeoutMS: options.socketTimeoutMs ?? DEFAULT_SOCKET_TIMEOUT_MS,

    // Indexes are created by the controlled MongoDB bootstrap process, not by
    // every application process at startup.
    autoIndex: false,

    // Fail immediately when code uses a model before the database is ready.
    bufferCommands: false,
  };

  await client.openUri(options.uri, connectOptions);
  await pingMongoDb(client);
}

/**
 * Executes a real MongoDB admin ping and returns its latency.
 */
export async function pingMongoDb(client: MongoDbClient): Promise<number> {
  if (client.readyState !== 1 || client.db === undefined) {
    throw new Error("MongoDB client is not connected");
  }

  const startedAt = performance.now();

  await client.db.admin().command({ ping: 1 });

  return Math.max(0, Math.round(performance.now() - startedAt));
}

/**
 * Destroys the Mongoose connection pool and removes the connection from
 * Mongoose's internal connection registry. The client is intentionally
 * single-use for one backend process lifecycle.
 */
export async function closeMongoDb(client: MongoDbClient): Promise<void> {
  await client.destroy(false);
}

function validateOptions(options: MongoDbClientOptions): void {
  if (options.uri.trim().length === 0) {
    throw new Error("MongoDB URI is required");
  }

  const min = options.minPoolSize ?? DEFAULT_MIN_POOL_SIZE;
  const max = options.maxPoolSize ?? DEFAULT_MAX_POOL_SIZE;

  if (!Number.isInteger(min) || min < 0) {
    throw new Error("MongoDB minPoolSize must be a non-negative integer");
  }

  if (!Number.isInteger(max) || max < 1) {
    throw new Error("MongoDB maxPoolSize must be a positive integer");
  }

  if (min > max) {
    throw new Error("MongoDB minPoolSize cannot exceed maxPoolSize");
  }
}

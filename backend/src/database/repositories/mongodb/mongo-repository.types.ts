import type { MongoDbClient } from "../../mongodb/client.js";

export interface MongoPaginationOptions {
  readonly limit?: number;
  readonly offset?: number;
}

export interface MongoPageResult<TRecord> {
  readonly items: readonly TRecord[];
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}

export type MongoSortDirection = "asc" | "desc";

export interface MongoRepositoryClock {
  now(): Date;
}

export const mongoSystemClock: MongoRepositoryClock = {
  now: () => new Date(),
};

export type MongoDbHandle = NonNullable<MongoDbClient["db"]>;

export function requireMongoDatabase(client: MongoDbClient): MongoDbHandle {
  if (client.readyState !== 1 || client.db === undefined) {
    throw new Error("MongoDB client is not connected");
  }

  return client.db;
}

export function normalizeMongoPagination(
  options: MongoPaginationOptions | undefined,
): Required<MongoPaginationOptions> {
  const limit = options?.limit ?? 25;
  const offset = options?.offset ?? 0;

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("MongoDB repository limit must be an integer between 1 and 100");
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("MongoDB repository offset must be a non-negative integer");
  }

  return { limit, offset };
}

export function requireNonBlank(value: string, fieldName: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`${fieldName} is required`);
  }

  return trimmed;
}

export function assertNumberRange(
  value: number,
  fieldName: string,
  min: number,
  max: number,
): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max}`);
  }
}

export function assertNonNegativeInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
}

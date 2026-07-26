import type { Knex } from "knex";

export type TransactionClient = Knex.Transaction;
export type QueryExecutor = Knex | Knex.Transaction;

export type SortDirection = "asc" | "desc";

export interface PaginationOptions {
  readonly limit?: number;
  readonly offset?: number;
}

export interface PageResult<TRecord> {
  readonly items: readonly TRecord[];
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}

export interface RepositoryClock {
  now(): Date;
}

export const systemClock: RepositoryClock = {
  now: () => new Date(),
};

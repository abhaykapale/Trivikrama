import type { Knex } from "knex";

import type { TransactionClient } from "../repositories/common/index.js";
import type { PostgresRepositories } from "../repositories/index.js";

export type TransactionIsolationLevel =
  | "read committed"
  | "repeatable read"
  | "serializable";

export interface TransactionRetryOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
}

export interface TransactionOptions {
  readonly isolationLevel?: TransactionIsolationLevel;
  readonly readOnly?: boolean;
  readonly statementTimeoutMs?: number;
  readonly lockTimeoutMs?: number;
  readonly retry?: TransactionRetryOptions;
}

export interface TransactionContext {
  readonly transaction: TransactionClient;
  readonly repositories: PostgresRepositories;
  readonly attempt: number;
}

export interface IUnitOfWork {
  execute<TResult>(
    operation: (context: TransactionContext) => Promise<TResult>,
    options?: TransactionOptions,
  ): Promise<TResult>;
}

/** Existing name retained for backward compatibility. */
export type UnitOfWork = IUnitOfWork;

export interface PostgresUnitOfWorkOptions {
  readonly defaultIsolationLevel?: TransactionIsolationLevel;
  readonly defaultStatementTimeoutMs?: number;
  readonly defaultLockTimeoutMs?: number;
  readonly defaultRetry?: TransactionRetryOptions;
}

export type TransactionKnex = Knex;

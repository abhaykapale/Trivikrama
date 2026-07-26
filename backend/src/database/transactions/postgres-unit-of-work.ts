import type { Knex } from "knex";

import type { PostgresClient } from "../postgres/index.js";
import {
  createTransactionalPostgresRepositories,
} from "../repositories/index.js";
import { classifyTransactionError } from "./transaction-errors.js";
import type {
  PostgresUnitOfWorkOptions,
  TransactionContext,
  TransactionIsolationLevel,
  TransactionOptions,
  TransactionRetryOptions,
  UnitOfWork,
} from "./transaction.types.js";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 50;
const DEFAULT_MAX_DELAY_MS = 500;
const MAX_RETRY_ATTEMPTS = 5;

const ISOLATION_LEVEL_SQL: Record<TransactionIsolationLevel, string> = {
  "read committed": "READ COMMITTED",
  "repeatable read": "REPEATABLE READ",
  serializable: "SERIALIZABLE",
};

export class PostgresUnitOfWork implements UnitOfWork {
  constructor(
    private readonly client: PostgresClient,
    private readonly defaults: PostgresUnitOfWorkOptions = {},
  ) {
    validateDefaultOptions(defaults);
  }

  async execute<TResult>(
    operation: (context: TransactionContext) => Promise<TResult>,
    options: TransactionOptions = {},
  ): Promise<TResult> {
    validateTransactionOptions(options);

    const retry = mergeRetryOptions(this.defaults.defaultRetry, options.retry);
    let lastError: unknown;

    for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
      try {
        return await this.client.transaction(async (transaction) => {
          await configureTransaction(transaction, this.defaults, options);

          return operation({
            transaction,
            repositories: createTransactionalPostgresRepositories(transaction),
            attempt,
          });
        });
      } catch (error) {
        lastError = error;
        const classified = classifyTransactionError(error);

        if (!classified.retryable || attempt >= retry.maxAttempts) {
          throw error;
        }

        await delay(calculateBackoffMs(attempt, retry));
      }
    }

    throw lastError;
  }
}

export function createPostgresUnitOfWork(
  client: PostgresClient,
  options: PostgresUnitOfWorkOptions = {},
): PostgresUnitOfWork {
  return new PostgresUnitOfWork(client, options);
}

async function configureTransaction(
  transaction: Knex.Transaction,
  defaults: PostgresUnitOfWorkOptions,
  options: TransactionOptions,
): Promise<void> {
  const isolationLevel = options.isolationLevel ?? defaults.defaultIsolationLevel;
  const statementTimeoutMs =
    options.statementTimeoutMs ?? defaults.defaultStatementTimeoutMs;
  const lockTimeoutMs = options.lockTimeoutMs ?? defaults.defaultLockTimeoutMs;

  if (isolationLevel !== undefined) {
    await transaction.raw(
      `SET TRANSACTION ISOLATION LEVEL ${ISOLATION_LEVEL_SQL[isolationLevel]}`,
    );
  }

  if (options.readOnly === true) {
    await transaction.raw("SET TRANSACTION READ ONLY");
  }

  if (statementTimeoutMs !== undefined) {
    await transaction.raw("SELECT set_config('statement_timeout', ?, true)", [
      `${statementTimeoutMs}ms`,
    ]);
  }

  if (lockTimeoutMs !== undefined) {
    await transaction.raw("SELECT set_config('lock_timeout', ?, true)", [
      `${lockTimeoutMs}ms`,
    ]);
  }
}

function mergeRetryOptions(
  defaults: TransactionRetryOptions | undefined,
  override: TransactionRetryOptions | undefined,
): Required<TransactionRetryOptions> {
  const maxAttempts =
    override?.maxAttempts ?? defaults?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs =
    override?.baseDelayMs ?? defaults?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs =
    override?.maxDelayMs ?? defaults?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_RETRY_ATTEMPTS) {
    throw new Error(
      `Transaction retry maxAttempts must be an integer between 1 and ${MAX_RETRY_ATTEMPTS}.`,
    );
  }

  if (!Number.isInteger(baseDelayMs) || baseDelayMs < 0) {
    throw new Error("Transaction retry baseDelayMs must be a non-negative integer.");
  }

  if (!Number.isInteger(maxDelayMs) || maxDelayMs < 0) {
    throw new Error("Transaction retry maxDelayMs must be a non-negative integer.");
  }

  if (baseDelayMs > maxDelayMs) {
    throw new Error("Transaction retry baseDelayMs cannot exceed maxDelayMs.");
  }

  return {
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
  };
}

function calculateBackoffMs(
  failedAttempt: number,
  retry: Required<TransactionRetryOptions>,
): number {
  const exponentialDelay = retry.baseDelayMs * 2 ** (failedAttempt - 1);
  return Math.min(exponentialDelay, retry.maxDelayMs);
}

async function delay(durationMs: number): Promise<void> {
  if (durationMs <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, durationMs));
}

function validateDefaultOptions(options: PostgresUnitOfWorkOptions): void {
  if (options.defaultStatementTimeoutMs !== undefined) {
    validateTimeout("defaultStatementTimeoutMs", options.defaultStatementTimeoutMs);
  }

  if (options.defaultLockTimeoutMs !== undefined) {
    validateTimeout("defaultLockTimeoutMs", options.defaultLockTimeoutMs);
  }

  if (options.defaultIsolationLevel !== undefined) {
    validateIsolationLevel(options.defaultIsolationLevel);
  }
}

function validateTransactionOptions(options: TransactionOptions): void {
  if (options.statementTimeoutMs !== undefined) {
    validateTimeout("statementTimeoutMs", options.statementTimeoutMs);
  }

  if (options.lockTimeoutMs !== undefined) {
    validateTimeout("lockTimeoutMs", options.lockTimeoutMs);
  }

  if (options.isolationLevel !== undefined) {
    validateIsolationLevel(options.isolationLevel);
  }
}

function validateTimeout(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Transaction ${name} must be a positive integer in milliseconds.`);
  }
}

function validateIsolationLevel(value: TransactionIsolationLevel): void {
  if (!(value in ISOLATION_LEVEL_SQL)) {
    throw new Error(`Unsupported PostgreSQL isolation level: ${value}.`);
  }
}

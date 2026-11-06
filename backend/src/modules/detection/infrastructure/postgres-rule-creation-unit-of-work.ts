import type { IUnitOfWork } from "../../../database/transactions/transaction.types.js";
import type {
  RuleCommandTransaction,
  RuleCommandUnitOfWork,
  RuleCreationTransaction,
  RuleCreationUnitOfWork,
} from "../domain/rule-command.contracts.js";
import { RuleRepositoryUniqueConflictError } from "../domain/rule-command.contracts.js";

export class PostgresRuleCommandUnitOfWork implements RuleCommandUnitOfWork {
  public constructor(private readonly unitOfWork: IUnitOfWork) {}

  public async execute<TResult>(
    operation: (transaction: RuleCommandTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    try {
      return await this.unitOfWork.execute(
        ({ repositories }) =>
          operation({
            rules: repositories.rules,
            audit: repositories.audit,
          }),
        transactionOptions,
      );
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new RuleRepositoryUniqueConflictError(readConstraint(error));
      }
      throw error;
    }
  }
}

export class PostgresRuleCreationUnitOfWork implements RuleCreationUnitOfWork {
  public constructor(private readonly unitOfWork: IUnitOfWork) {}

  public async execute<TResult>(
    operation: (transaction: RuleCreationTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    try {
      return await this.unitOfWork.execute(
        ({ repositories }) =>
          operation({
            rules: repositories.rules,
            audit: repositories.audit,
          }),
        transactionOptions,
      );
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new RuleRepositoryUniqueConflictError(readConstraint(error));
      }
      throw error;
    }
  }
}

const transactionOptions = {
  isolationLevel: "serializable",
  statementTimeoutMs: 10_000,
  lockTimeoutMs: 5_000,
  retry: { maxAttempts: 3, baseDelayMs: 25, maxDelayMs: 200 },
} as const;

function isUniqueViolation(error: unknown): boolean {
  return isRecord(error) && error.code === "23505";
}

function readConstraint(error: unknown): string | null {
  if (!isRecord(error)) return null;
  return typeof error.constraint === "string" ? error.constraint : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

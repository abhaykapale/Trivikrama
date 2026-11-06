import type { IUnitOfWork } from "../../../database/transactions/transaction.types.js";
import type { ConfigurationCommandTransaction, ConfigurationCommandUnitOfWork } from "../domain/configuration.contracts.js";

export class PostgresConfigurationCommandUnitOfWork implements ConfigurationCommandUnitOfWork {
  public constructor(private readonly unitOfWork: IUnitOfWork) {}
  public execute<TResult>(operation: (transaction: ConfigurationCommandTransaction) => Promise<TResult>): Promise<TResult> {
    return this.unitOfWork.execute(
      ({ repositories }) => operation({ configuration: repositories.configuration, audit: repositories.audit }),
      { isolationLevel: "serializable", statementTimeoutMs: 10_000, lockTimeoutMs: 5_000, retry: { maxAttempts: 3, baseDelayMs: 25, maxDelayMs: 200 } },
    );
  }
}

import type { IUnitOfWork } from "../../../database/transactions/transaction.types.js";
import type {
  IncidentStatusTransaction,
  IncidentStatusUnitOfWork,
} from "../domain/incident-status.contracts.js";

export class PostgresIncidentStatusUnitOfWork
  implements IncidentStatusUnitOfWork
{
  public constructor(private readonly unitOfWork: IUnitOfWork) {}

  public execute<TResult>(
    operation: (transaction: IncidentStatusTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    return this.unitOfWork.execute(
      ({ repositories }) =>
        operation({
          incidents: repositories.incidents,
          audit: repositories.audit,
        }),
      {
        isolationLevel: "serializable",
        statementTimeoutMs: 10_000,
        lockTimeoutMs: 5_000,
        retry: { maxAttempts: 3, baseDelayMs: 25, maxDelayMs: 200 },
      },
    );
  }
}

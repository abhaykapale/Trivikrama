import type { IUnitOfWork } from "../../../database/transactions/transaction.types.js";
import type {
  IncidentResolutionTransaction,
  IncidentResolutionUnitOfWork,
} from "../domain/incident-resolution.contracts.js";

export class PostgresIncidentResolutionUnitOfWork
  implements IncidentResolutionUnitOfWork
{
  public constructor(private readonly unitOfWork: IUnitOfWork) {}

  public execute<TResult>(
    operation: (transaction: IncidentResolutionTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    return this.unitOfWork.execute(
      ({ repositories }) =>
        operation({
          incidents: repositories.incidents,
          notes: repositories.incidentNotes,
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

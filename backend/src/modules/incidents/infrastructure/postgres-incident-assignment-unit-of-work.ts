import type { IUnitOfWork } from "../../../database/transactions/transaction.types.js";
import type {
  IncidentAssignmentTransaction,
  IncidentAssignmentUnitOfWork,
} from "../domain/incident-assignment.contracts.js";

export class PostgresIncidentAssignmentUnitOfWork
  implements IncidentAssignmentUnitOfWork
{
  public constructor(private readonly unitOfWork: IUnitOfWork) {}

  public execute<TResult>(
    operation: (transaction: IncidentAssignmentTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    return this.unitOfWork.execute(
      ({ repositories }) =>
        operation({
          incidents: repositories.incidents,
          users: repositories.users,
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

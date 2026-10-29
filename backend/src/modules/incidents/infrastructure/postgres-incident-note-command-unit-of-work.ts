import type { IUnitOfWork } from "../../../database/transactions/transaction.types.js";
import type {
  IncidentNoteCommandTransaction,
  IncidentNoteCommandUnitOfWork,
} from "../domain/incident-note-command.contracts.js";

export class PostgresIncidentNoteCommandUnitOfWork
  implements IncidentNoteCommandUnitOfWork
{
  public constructor(private readonly unitOfWork: IUnitOfWork) {}

  public execute<TResult>(
    operation: (transaction: IncidentNoteCommandTransaction) => Promise<TResult>,
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

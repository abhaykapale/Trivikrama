import type { IUnitOfWork } from "../../../database/transactions/transaction.types.js";
import type {
  IncidentCorrelationTransaction,
  IncidentCorrelationUnitOfWork,
} from "../domain/incident-correlation.contracts.js";
import { RepositoryAssetCriticalityResolver } from "./repository-asset-criticality-resolver.js";

export class PostgresIncidentCorrelationUnitOfWork
  implements IncidentCorrelationUnitOfWork
{
  public constructor(private readonly unitOfWork: IUnitOfWork) {}

  public execute<TResult>(
    operation: (transaction: IncidentCorrelationTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    return this.unitOfWork.execute(
      ({ repositories }) =>
        operation({
          incidents: repositories.incidents,
          alerts: repositories.alerts,
          incidentEvents: repositories.incidentEvents,
          notifications: repositories.incidentNotificationOutbox,
          audit: repositories.audit,
          assetCriticality: new RepositoryAssetCriticalityResolver(
            repositories.assets,
          ),
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

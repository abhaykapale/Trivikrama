import type { IUnitOfWork } from "../../../database/transactions/transaction.types.js";
import type {
  AssetCommandTransaction,
  AssetCommandUnitOfWork,
} from "../domain/asset.contracts.js";

export class PostgresAssetCommandUnitOfWork implements AssetCommandUnitOfWork {
  public constructor(private readonly unitOfWork: IUnitOfWork) {}

  public execute<TResult>(
    operation: (transaction: AssetCommandTransaction) => Promise<TResult>,
  ): Promise<TResult> {
    return this.unitOfWork.execute(
      ({ repositories }) => operation({ assets: repositories.assets, audit: repositories.audit }),
      {
        isolationLevel: "serializable",
        statementTimeoutMs: 10_000,
        lockTimeoutMs: 5_000,
        retry: { maxAttempts: 3, baseDelayMs: 25, maxDelayMs: 200 },
      },
    );
  }
}

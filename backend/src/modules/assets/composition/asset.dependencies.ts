import type { IAssetRepository } from "../../../database/repositories/assets/asset.repository.js";
import type { IUnitOfWork } from "../../../database/transactions/transaction.types.js";
import { CreateAssetUseCase } from "../application/create-asset.use-case.js";
import { DeactivateAssetUseCase } from "../application/deactivate-asset.use-case.js";
import { GetAssetUseCase } from "../application/get-asset.use-case.js";
import { ListAssetsUseCase } from "../application/list-assets.use-case.js";
import { UpdateAssetUseCase } from "../application/update-asset.use-case.js";
import { PostgresAssetCommandUnitOfWork } from "../infrastructure/postgres-asset-command-unit-of-work.js";

export interface AssetDependencies {
  readonly listAssetsUseCase: ListAssetsUseCase;
  readonly getAssetUseCase: GetAssetUseCase;
  readonly createAssetUseCase: CreateAssetUseCase;
  readonly updateAssetUseCase: UpdateAssetUseCase;
  readonly deactivateAssetUseCase: DeactivateAssetUseCase;
}

export function createAssetDependencies(
  assets: IAssetRepository,
  unitOfWork: IUnitOfWork,
): AssetDependencies {
  const commands = new PostgresAssetCommandUnitOfWork(unitOfWork);
  return {
    listAssetsUseCase: new ListAssetsUseCase(assets),
    getAssetUseCase: new GetAssetUseCase(assets),
    createAssetUseCase: new CreateAssetUseCase(commands),
    updateAssetUseCase: new UpdateAssetUseCase(commands),
    deactivateAssetUseCase: new DeactivateAssetUseCase(commands),
  };
}

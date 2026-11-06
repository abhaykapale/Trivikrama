import {
  toAssetDetailView,
  type AssetCommandUnitOfWork,
  type AssetDetailView,
  type CreateAssetCommand,
} from "../domain/asset.contracts.js";
import { assetAuditState } from "./asset-audit-state.js";

export class CreateAssetUseCase {
  public constructor(private readonly unitOfWork: AssetCommandUnitOfWork) {}

  public execute(command: CreateAssetCommand): Promise<AssetDetailView> {
    return this.unitOfWork.execute(async (transaction) => {
      const created = await transaction.assets.create({
        ...command.asset,
        isActive: true,
        orgId: command.orgId,
      });
      await transaction.audit.create({
        action: "asset_create",
        actorId: command.actor.id,
        actorUsername: command.actor.username,
        actorRole: command.actor.role,
        ipAddress: command.actor.ipAddress,
        targetType: "asset",
        targetId: created.id,
        targetName: created.name,
        details: { assetType: created.assetType },
        newState: assetAuditState(created),
        orgId: command.orgId,
      });
      return toAssetDetailView(created);
    });
  }
}

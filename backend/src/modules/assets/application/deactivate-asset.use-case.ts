import {
  toAssetDetailView,
  type AssetCommandUnitOfWork,
  type AssetDetailView,
  type DeactivateAssetCommand,
} from "../domain/asset.contracts.js";
import { assetAuditState } from "./asset-audit-state.js";

export class DeactivateAssetUseCase {
  public constructor(private readonly unitOfWork: AssetCommandUnitOfWork) {}

  public execute(command: DeactivateAssetCommand): Promise<AssetDetailView | null> {
    return this.unitOfWork.execute(async (transaction) => {
      const current = await transaction.assets.findByIdForUpdate(command.assetId, command.orgId);
      if (current === null) return null;
      if (!current.isActive) return toAssetDetailView(current);
      const updated = await transaction.assets.deactivateForOrg(current.id, command.orgId);
      if (updated === null) throw new Error(`Asset ${current.id} disappeared during its locked deactivation.`);
      await transaction.audit.create({
        action: "asset_delete",
        actorId: command.actor.id,
        actorUsername: command.actor.username,
        actorRole: command.actor.role,
        ipAddress: command.actor.ipAddress,
        targetType: "asset",
        targetId: updated.id,
        targetName: updated.name,
        details: { softDelete: true },
        previousState: assetAuditState(current),
        newState: assetAuditState(updated),
        orgId: command.orgId,
      });
      return toAssetDetailView(updated);
    });
  }
}

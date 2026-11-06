import {
  toAssetDetailView,
  type AssetCommandUnitOfWork,
  type AssetDetailView,
  type UpdateAssetCommand,
} from "../domain/asset.contracts.js";
import { assetAuditState } from "./asset-audit-state.js";

export class UpdateAssetUseCase {
  public constructor(private readonly unitOfWork: AssetCommandUnitOfWork) {}

  public execute(command: UpdateAssetCommand): Promise<AssetDetailView | null> {
    return this.unitOfWork.execute(async (transaction) => {
      const current = await transaction.assets.findByIdForUpdate(command.assetId, command.orgId);
      if (current === null) return null;
      const updated = await transaction.assets.updateForOrg(
        current.id,
        command.orgId,
        command.changes,
      );
      if (updated === null) throw new Error(`Asset ${current.id} disappeared during its locked update.`);
      await transaction.audit.create({
        action: "asset_update",
        actorId: command.actor.id,
        actorUsername: command.actor.username,
        actorRole: command.actor.role,
        ipAddress: command.actor.ipAddress,
        targetType: "asset",
        targetId: updated.id,
        targetName: updated.name,
        details: { changedFields: Object.keys(command.changes).sort() },
        previousState: assetAuditState(current),
        newState: assetAuditState(updated),
        orgId: command.orgId,
      });
      return toAssetDetailView(updated);
    });
  }
}

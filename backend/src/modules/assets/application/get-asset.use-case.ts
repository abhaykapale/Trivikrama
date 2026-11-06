import {
  toAssetDetailView,
  type AssetDetailView,
  type AssetQueryRepository,
  type GetAssetInput,
} from "../domain/asset.contracts.js";

export class GetAssetUseCase {
  public constructor(private readonly assets: AssetQueryRepository) {}

  public async execute(input: GetAssetInput): Promise<AssetDetailView | null> {
    const asset = await this.assets.findByIdForOrg(input.assetId, input.orgId);
    return asset === null ? null : toAssetDetailView(asset);
  }
}

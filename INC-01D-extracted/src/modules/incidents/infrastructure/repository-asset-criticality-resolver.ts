import type { IAssetRepository } from "../../../database/repositories/assets/asset.repository.js";
import type { AssetCriticalityResolver } from "../domain/incident-risk.contracts.js";

export class RepositoryAssetCriticalityResolver
  implements AssetCriticalityResolver
{
  public constructor(private readonly assets: IAssetRepository) {}

  public async resolve(
    input: Parameters<AssetCriticalityResolver["resolve"]>[0],
  ): Promise<number | null> {
    const { entity, orgId } = input;
    const asset =
      entity.type === "host" || entity.type === "src_host"
        ? await this.assets.findByHostname(entity.value, orgId)
        : entity.type === "src_ip" || entity.type === "dst_ip"
          ? await this.assets.findByIpAddress(entity.value, orgId)
          : null;

    if (asset === null) return null;
    if (asset.orgId !== orgId) {
      throw new Error(`Asset ${asset.id} crossed the incident organization boundary.`);
    }
    return asset.criticality;
  }
}

import type { AssetRecord } from "../../../database/repositories/assets/asset.repository.js";

export function assetAuditState(asset: AssetRecord): Record<string, unknown> {
  return {
    id: asset.id,
    name: asset.name,
    assetType: asset.assetType,
    ipAddress: asset.ipAddress,
    hostname: asset.hostname,
    criticality: asset.criticality,
    owner: asset.owner,
    department: asset.department,
    tags: asset.tags,
    isActive: asset.isActive,
  };
}

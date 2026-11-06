import type {
  AssetListFilters,
  AssetRecord,
  CreateAssetInput,
  IAssetRepository,
  UpdateAssetInput,
} from "../../../database/repositories/assets/asset.repository.js";
import type { IAuditRepository } from "../../../database/repositories/audit/audit.repository.js";
import type { UserRole } from "../../../database/repositories/users/user.repository.js";

export const ASSET_TYPES = [
  "server",
  "workstation",
  "network_device",
  "application",
] as const;

export type AssetType = (typeof ASSET_TYPES)[number];

export interface AssetActor {
  readonly id: string;
  readonly username: string;
  readonly role: UserRole;
  readonly ipAddress: string | null;
}

export interface AssetView {
  readonly id: string;
  readonly name: string;
  readonly assetType: string;
  readonly ipAddress: string | null;
  readonly hostname: string | null;
  readonly criticality: number;
  readonly owner: string | null;
  readonly department: string | null;
  readonly tags: readonly string[];
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AssetDetailView extends AssetView {
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ListAssetsInput {
  readonly orgId: string;
  readonly assetType?: AssetType;
  readonly search?: string;
  readonly isActive: boolean;
  readonly page: number;
  readonly limit: number;
}

export interface AssetPaginationView {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
  readonly hasNext: boolean;
  readonly hasPrev: boolean;
}

export interface ListAssetsResult {
  readonly data: readonly AssetView[];
  readonly pagination: AssetPaginationView;
}

export interface GetAssetInput {
  readonly orgId: string;
  readonly assetId: string;
}

export interface CreateAssetCommand {
  readonly orgId: string;
  readonly asset: Omit<CreateAssetInput, "id" | "isActive" | "orgId">;
  readonly actor: AssetActor;
}

export interface UpdateAssetCommand {
  readonly orgId: string;
  readonly assetId: string;
  readonly changes: Omit<UpdateAssetInput, "isActive">;
  readonly actor: AssetActor;
}

export interface DeactivateAssetCommand {
  readonly orgId: string;
  readonly assetId: string;
  readonly actor: AssetActor;
}

export interface AssetCommandTransaction {
  readonly assets: Pick<
    IAssetRepository,
    "create" | "findByIdForUpdate" | "updateForOrg" | "deactivateForOrg"
  >;
  readonly audit: Pick<IAuditRepository, "create">;
}

export interface AssetCommandUnitOfWork {
  execute<TResult>(
    operation: (transaction: AssetCommandTransaction) => Promise<TResult>,
  ): Promise<TResult>;
}

export type AssetQueryRepository = Pick<
  IAssetRepository,
  "list" | "count" | "findByIdForOrg"
>;

export function toAssetView(record: AssetRecord): AssetView {
  return {
    id: record.id,
    name: record.name,
    assetType: record.assetType,
    ipAddress: record.ipAddress,
    hostname: record.hostname,
    criticality: record.criticality,
    owner: record.owner,
    department: record.department,
    tags: record.tags.filter((tag): tag is string => typeof tag === "string"),
    isActive: record.isActive,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function toAssetDetailView(record: AssetRecord): AssetDetailView {
  return { ...toAssetView(record), metadata: record.metadata };
}

export function toAssetListFilters(input: ListAssetsInput): AssetListFilters {
  return {
    orgId: input.orgId,
    assetType: input.assetType,
    search: input.search,
    isActive: input.isActive,
    limit: input.limit,
    offset: (input.page - 1) * input.limit,
  };
}

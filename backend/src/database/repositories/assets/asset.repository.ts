import type { PageResult, PaginationOptions, TransactionClient } from "../common/repository.types.js";

export interface AssetRecord {
  readonly id: string;
  readonly name: string;
  readonly assetType: string;
  readonly ipAddress: string | null;
  readonly hostname: string | null;
  readonly criticality: number;
  readonly owner: string | null;
  readonly department: string | null;
  readonly tags: readonly unknown[];
  readonly metadata: Record<string, unknown>;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly orgId: string;
}

export interface CreateAssetInput {
  readonly id?: string;
  readonly name: string;
  readonly assetType: string;
  readonly ipAddress?: string | null;
  readonly hostname?: string | null;
  readonly criticality?: number;
  readonly owner?: string | null;
  readonly department?: string | null;
  readonly tags?: readonly unknown[];
  readonly metadata?: Record<string, unknown>;
  readonly isActive?: boolean;
  readonly orgId?: string;
}

export interface UpdateAssetInput {
  readonly name?: string;
  readonly assetType?: string;
  readonly ipAddress?: string | null;
  readonly hostname?: string | null;
  readonly criticality?: number;
  readonly owner?: string | null;
  readonly department?: string | null;
  readonly tags?: readonly unknown[];
  readonly metadata?: Record<string, unknown>;
  readonly isActive?: boolean;
}

export interface AssetListFilters extends PaginationOptions {
  readonly orgId?: string;
  readonly assetType?: string;
  readonly isActive?: boolean;
  readonly owner?: string;
  readonly department?: string;
  readonly minCriticality?: number;
  readonly search?: string;
}

export interface IAssetRepository {
  withTransaction(transaction: TransactionClient): IAssetRepository;
  create(input: CreateAssetInput): Promise<AssetRecord>;
  findById(id: string): Promise<AssetRecord | null>;
  findByHostname(hostname: string, orgId?: string): Promise<AssetRecord | null>;
  findByIpAddress(ipAddress: string, orgId?: string): Promise<AssetRecord | null>;
  list(filters?: AssetListFilters): Promise<PageResult<AssetRecord>>;
  update(id: string, input: UpdateAssetInput): Promise<AssetRecord | null>;
  deactivate(id: string): Promise<AssetRecord | null>;
}

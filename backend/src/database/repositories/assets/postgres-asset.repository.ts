import {
  ensureNonBlank,
  pageByLimitOffset,
  parseJsonArray,
  parseJsonObject,
  toRequiredDate,
  type PageResult,
  type QueryExecutor,
  type TransactionClient,
} from "../common/index.js";
import type {
  AssetListFilters,
  AssetRecord,
  CreateAssetInput,
  IAssetRepository,
  UpdateAssetInput,
} from "./asset.repository.js";

interface AssetRow {
  readonly id: string;
  readonly name: string;
  readonly asset_type: string;
  readonly ip_address: string | null;
  readonly hostname: string | null;
  readonly criticality: number | string;
  readonly owner: string | null;
  readonly department: string | null;
  readonly tags: unknown;
  readonly metadata: unknown;
  readonly is_active: boolean;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly org_id: string;
}

const ASSETS_TABLE = "public.assets";
const DEFAULT_ORG_ID = "default";

export class PostgresAssetRepository implements IAssetRepository {
  public constructor(private readonly db: QueryExecutor) {}

  public withTransaction(transaction: TransactionClient): IAssetRepository {
    return new PostgresAssetRepository(transaction);
  }

  public async create(input: CreateAssetInput): Promise<AssetRecord> {
    validateCriticality(input.criticality ?? 0.5);

    const insertable = {
      ...(input.id ? { id: input.id } : {}),
      name: ensureNonBlank(input.name, "name"),
      asset_type: ensureNonBlank(input.assetType, "assetType"),
      ip_address: input.ipAddress ?? null,
      hostname: input.hostname ?? null,
      criticality: input.criticality ?? 0.5,
      owner: input.owner ?? null,
      department: input.department ?? null,
      tags: input.tags ?? [],
      metadata: input.metadata ?? {},
      is_active: input.isActive ?? true,
      org_id: input.orgId ? ensureNonBlank(input.orgId, "orgId") : DEFAULT_ORG_ID,
    };

    const [row] = await this.db<AssetRow>(ASSETS_TABLE).insert(insertable).returning("*");
    return mapAssetRow(row);
  }

  public async findById(id: string): Promise<AssetRecord | null> {
    const row = await this.baseQuery().where("id", ensureNonBlank(id, "id")).first<AssetRow>();
    return row ? mapAssetRow(row) : null;
  }

  public async findByHostname(hostname: string, orgId = DEFAULT_ORG_ID): Promise<AssetRecord | null> {
    const row = await this.baseQuery()
      .whereRaw("lower(hostname) = lower(?)", [ensureNonBlank(hostname, "hostname")])
      .andWhere("org_id", ensureNonBlank(orgId, "orgId"))
      .andWhere("is_active", true)
      .orderBy("criticality", "desc")
      .first<AssetRow>();

    return row ? mapAssetRow(row) : null;
  }

  public async findByIpAddress(ipAddress: string, orgId = DEFAULT_ORG_ID): Promise<AssetRecord | null> {
    const row = await this.baseQuery()
      .where("ip_address", ensureNonBlank(ipAddress, "ipAddress"))
      .andWhere("org_id", ensureNonBlank(orgId, "orgId"))
      .andWhere("is_active", true)
      .orderBy("criticality", "desc")
      .first<AssetRow>();

    return row ? mapAssetRow(row) : null;
  }

  public async list(filters: AssetListFilters = {}): Promise<PageResult<AssetRecord>> {
    const query = this.baseQuery().orderBy("criticality", "desc").orderBy("name", "asc").orderBy("id", "asc");

    if (filters.orgId !== undefined) {
      query.where("org_id", ensureNonBlank(filters.orgId, "orgId"));
    }

    if (filters.assetType !== undefined) {
      query.where("asset_type", ensureNonBlank(filters.assetType, "assetType"));
    }

    if (filters.isActive !== undefined) {
      query.where("is_active", filters.isActive);
    }

    if (filters.owner !== undefined) {
      query.where("owner", ensureNonBlank(filters.owner, "owner"));
    }

    if (filters.department !== undefined) {
      query.where("department", ensureNonBlank(filters.department, "department"));
    }

    if (filters.minCriticality !== undefined) {
      validateCriticality(filters.minCriticality);
      query.where("criticality", ">=", filters.minCriticality);
    }

    if (filters.search !== undefined) {
      const search = `%${ensureNonBlank(filters.search, "search")}%`;
      query.andWhere((builder) => {
        builder.whereILike("name", search).orWhereILike("hostname", search).orWhereILike("owner", search);
      });
    }

    return pageByLimitOffset<AssetRow, AssetRecord>(query, filters, mapAssetRow);
  }

  public async update(id: string, input: UpdateAssetInput): Promise<AssetRecord | null> {
    const updates: Record<string, unknown> = {};

    if (input.name !== undefined) updates.name = ensureNonBlank(input.name, "name");
    if (input.assetType !== undefined) updates.asset_type = ensureNonBlank(input.assetType, "assetType");
    if (input.ipAddress !== undefined) updates.ip_address = input.ipAddress;
    if (input.hostname !== undefined) updates.hostname = input.hostname;
    if (input.criticality !== undefined) {
      validateCriticality(input.criticality);
      updates.criticality = input.criticality;
    }
    if (input.owner !== undefined) updates.owner = input.owner;
    if (input.department !== undefined) updates.department = input.department;
    if (input.tags !== undefined) updates.tags = input.tags;
    if (input.metadata !== undefined) updates.metadata = input.metadata;
    if (input.isActive !== undefined) updates.is_active = input.isActive;

    if (Object.keys(updates).length === 0) {
      return this.findById(id);
    }

    const [row] = await this.db<AssetRow>(ASSETS_TABLE)
      .where("id", ensureNonBlank(id, "id"))
      .update(updates)
      .returning("*");

    return row ? mapAssetRow(row) : null;
  }

  public async deactivate(id: string): Promise<AssetRecord | null> {
    return this.update(id, { isActive: false });
  }

  private baseQuery() {
    return this.db<AssetRow>(ASSETS_TABLE).select("*");
  }
}

function validateCriticality(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("criticality must be between 0.00 and 1.00.");
  }
}

function mapAssetRow(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    name: row.name,
    assetType: row.asset_type,
    ipAddress: row.ip_address,
    hostname: row.hostname,
    criticality: Number(row.criticality),
    owner: row.owner,
    department: row.department,
    tags: parseJsonArray(row.tags),
    metadata: parseJsonObject(row.metadata),
    isActive: row.is_active,
    createdAt: toRequiredDate(row.created_at),
    updatedAt: toRequiredDate(row.updated_at),
    orgId: row.org_id,
  };
}

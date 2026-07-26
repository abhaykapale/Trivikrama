import type { Knex } from "knex";

import {
  ensureNonBlank,
  pageByLimitOffset,
  toNullableDate,
  toRequiredDate,
  type PageResult,
  type QueryExecutor,
  type TransactionClient,
} from "../common/index.js";
import type {
  ConfigurationListFilters,
  ConfigurationRecord,
  CreateConfigurationInput,
  IConfigurationRepository,
  UpdateConfigurationInput,
} from "./configuration.repository.js";

interface ConfigurationRow {
  readonly id: string;
  readonly key: string;
  readonly value: unknown;
  readonly description: string | null;
  readonly is_sensitive: boolean;
  readonly updated_by: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

const CONFIGURATION_TABLE = "public.configuration";

export class PostgresConfigurationRepository implements IConfigurationRepository {
  public constructor(private readonly db: QueryExecutor) {}

  public withTransaction(transaction: TransactionClient): IConfigurationRepository {
    return new PostgresConfigurationRepository(transaction);
  }

  public async findByKey<TValue = unknown>(key: string): Promise<ConfigurationRecord<TValue> | null> {
    const row = await this.baseQuery()
      .where("key", ensureNonBlank(key, "key"))
      .first<ConfigurationRow>();

    return row ? mapConfigurationRow<TValue>(row) : null;
  }

  public async getValue<TValue = unknown>(key: string): Promise<TValue | null> {
    const record = await this.findByKey<TValue>(key);
    return record ? record.value : null;
  }

  public async list(filters: ConfigurationListFilters = {}): Promise<PageResult<ConfigurationRecord>> {
    const query = this.baseQuery().orderBy("key", "asc");

    if (filters.keyPrefix !== undefined && filters.keyPrefix.trim().length > 0) {
      query.where("key", "like", `${filters.keyPrefix.trim()}%`);
    }

    if (filters.includeSensitive !== true) {
      query.where("is_sensitive", false);
    }

    return pageByLimitOffset<ConfigurationRow, ConfigurationRecord>(query, filters, mapConfigurationRow);
  }

  public async createIfMissing(input: CreateConfigurationInput): Promise<ConfigurationRecord> {
    const key = ensureNonBlank(input.key, "key");
    const existing = await this.findByKey(key);

    if (existing) {
      return existing;
    }

    const insertable = {
      ...(input.id ? { id: input.id } : {}),
      key,
      value: input.value,
      description: input.description ?? null,
      is_sensitive: input.isSensitive ?? false,
      updated_by: input.updatedBy ?? null,
    };

    const [row] = await this.db<ConfigurationRow>(CONFIGURATION_TABLE)
      .insert(insertable)
      .returning("*");

    return mapConfigurationRow(row);
  }

  public async updateValue(
    key: string,
    input: UpdateConfigurationInput,
  ): Promise<ConfigurationRecord | null> {
    const patch: Record<string, unknown> = {
      value: input.value,
    };

    if (input.description !== undefined) {
      patch.description = input.description;
    }

    if (input.isSensitive !== undefined) {
      patch.is_sensitive = input.isSensitive;
    }

    if (input.updatedBy !== undefined) {
      patch.updated_by = input.updatedBy;
    }

    const [row] = await this.db<ConfigurationRow>(CONFIGURATION_TABLE)
      .where("key", ensureNonBlank(key, "key"))
      .update(patch)
      .returning("*");

    return row ? mapConfigurationRow(row) : null;
  }

  private baseQuery(): Knex.QueryBuilder<ConfigurationRow, ConfigurationRow[]> {
    return this.db<ConfigurationRow>(CONFIGURATION_TABLE).select("*");
  }
}

function mapConfigurationRow<TValue = unknown>(row: ConfigurationRow): ConfigurationRecord<TValue> {
  return {
    id: row.id,
    key: row.key,
    value: row.value as TValue,
    description: row.description,
    isSensitive: row.is_sensitive,
    updatedBy: row.updated_by,
    createdAt: toRequiredDate(row.created_at),
    updatedAt: toRequiredDate(row.updated_at),
  };
}

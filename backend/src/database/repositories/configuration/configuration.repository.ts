import type { PageResult, PaginationOptions, TransactionClient } from "../common/repository.types.js";

export interface ConfigurationRecord<TValue = unknown> {
  readonly id: string;
  readonly key: string;
  readonly value: TValue;
  readonly description: string | null;
  readonly isSensitive: boolean;
  readonly updatedBy: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ConfigurationListFilters extends PaginationOptions {
  readonly keyPrefix?: string;
  readonly includeSensitive?: boolean;
}

export interface CreateConfigurationInput {
  readonly id?: string;
  readonly key: string;
  readonly value: unknown;
  readonly description?: string | null;
  readonly isSensitive?: boolean;
  readonly updatedBy?: string | null;
}

export interface UpdateConfigurationInput {
  readonly value: unknown;
  readonly description?: string | null;
  readonly isSensitive?: boolean;
  readonly updatedBy?: string | null;
}

export interface IConfigurationRepository {
  withTransaction(transaction: TransactionClient): IConfigurationRepository;
  findByKey<TValue = unknown>(key: string): Promise<ConfigurationRecord<TValue> | null>;
  getValue<TValue = unknown>(key: string): Promise<TValue | null>;
  list(filters?: ConfigurationListFilters): Promise<PageResult<ConfigurationRecord>>;
  createIfMissing(input: CreateConfigurationInput): Promise<ConfigurationRecord>;
  updateValue(key: string, input: UpdateConfigurationInput): Promise<ConfigurationRecord | null>;
}

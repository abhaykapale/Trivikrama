import type { MongoPageResult, MongoPaginationOptions, MongoSortDirection } from "./mongo-repository.types.js";

export interface RawEventArchiveDocument {
    readonly batch_id: string;
    readonly collector_id: string;
    readonly canonical_unsigned_sha256: string;
    readonly event_count?: number;
    readonly schema_version?: string;
    readonly events: readonly Record<string, unknown>[];
    readonly file_size_bytes?: number;
    readonly archived_at: Date;
    readonly org_id?: string;
}

export type CreateRawEventArchiveInput = RawEventArchiveDocument;

export type CreateRawEventArchiveIfAbsentResult =
    | {
          readonly status: "created";
          readonly document: RawEventArchiveDocument;
      }
    | {
          readonly status: "already_exists";
          readonly document: RawEventArchiveDocument;
      };

export interface RawEventArchiveListFilters extends MongoPaginationOptions {
  readonly orgId?: string;
  readonly collectorId?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly sortDirection?: MongoSortDirection;
}

export interface IRawEventArchiveRepository {
    create(input: CreateRawEventArchiveInput): Promise<RawEventArchiveDocument>;
    findByBatchId(batchId: string): Promise<RawEventArchiveDocument | null>;
    list(filters?: RawEventArchiveListFilters): Promise<MongoPageResult<RawEventArchiveDocument>>;
    listByCollectorId(
        collectorId: string,
        options?: MongoPaginationOptions,
    ): Promise<MongoPageResult<RawEventArchiveDocument>>;
    createIfAbsent(input: CreateRawEventArchiveInput): Promise<CreateRawEventArchiveIfAbsentResult>;
}

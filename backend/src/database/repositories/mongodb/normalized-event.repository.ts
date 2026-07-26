import type { MongoPageResult, MongoPaginationOptions, MongoSortDirection } from "./mongo-repository.types.js";

export interface OcsfEndpointDocument {
  readonly ip?: string;
  readonly hostname?: string;
  readonly port?: number;
  readonly mac?: string;
}

export interface OcsfActorDocument {
  readonly user?: {
    readonly name?: string;
    readonly uid?: string;
    readonly domain?: string;
    readonly type?: string;
  };
  readonly process?: {
    readonly name?: string;
    readonly pid?: number;
    readonly cmd_line?: string;
    readonly path?: string;
  };
  readonly session?: {
    readonly uid?: string;
    readonly type?: string;
  };
}

export interface OcsfDeviceDocument {
  readonly hostname?: string;
  readonly ip?: string;
  readonly os?: {
    readonly name?: string;
    readonly version?: string;
  };
  readonly type?: string;
}

export interface NormalizedEventDocument {
  readonly event_id: string;
  readonly dedup_hash?: string;
  readonly class_uid: number;
  readonly category_uid: number;
  readonly severity_id: number;
  readonly time: Date;
  readonly message: string;
  readonly src_endpoint?: OcsfEndpointDocument;
  readonly dst_endpoint?: OcsfEndpointDocument;
  readonly actor?: OcsfActorDocument;
  readonly device?: OcsfDeviceDocument;
  readonly metadata: {
    readonly version: string;
    readonly product?: Record<string, unknown>;
    readonly log_level?: string;
  };
  readonly enrichments?: Record<string, unknown>;
  readonly features?: Record<string, unknown>;
  readonly unmapped?: Record<string, unknown>;
  readonly schema_valid?: boolean;
  readonly validation_errors?: readonly string[];
  readonly ingestion: {
    readonly batch_id: string;
    readonly collector_id: string;
    readonly ingested_at: Date;
    readonly pipeline_duration_ms?: number;
  };
  readonly raw_event?: Record<string, unknown>;
  readonly org_id?: string;
}

export type CreateNormalizedEventInput = NormalizedEventDocument;

export interface NormalizedEventListFilters extends MongoPaginationOptions {
  readonly orgId?: string;
  readonly classUid?: number;
  readonly categoryUid?: number;
  readonly minSeverityId?: number;
  readonly srcIp?: string;
  readonly dstIp?: string;
  readonly username?: string;
  readonly hostname?: string;
  readonly collectorId?: string;
  readonly batchId?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly sortDirection?: MongoSortDirection;
}

export interface INormalizedEventRepository {
  create(input: CreateNormalizedEventInput): Promise<NormalizedEventDocument>;
  createMany(inputs: readonly CreateNormalizedEventInput[]): Promise<number>;
  findByEventId(eventId: string): Promise<NormalizedEventDocument | null>;
  findByDedupHash(dedupHash: string): Promise<NormalizedEventDocument | null>;
  list(filters?: NormalizedEventListFilters): Promise<MongoPageResult<NormalizedEventDocument>>;
  listByEventIds(eventIds: readonly string[]): Promise<readonly NormalizedEventDocument[]>;
  listByBatchId(batchId: string, options?: MongoPaginationOptions): Promise<MongoPageResult<NormalizedEventDocument>>;
  searchMessage(query: string, options?: MongoPaginationOptions): Promise<MongoPageResult<NormalizedEventDocument>>;
}
